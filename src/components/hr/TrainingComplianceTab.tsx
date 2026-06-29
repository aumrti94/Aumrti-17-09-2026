import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Download, CheckCircle2, AlertTriangle, XCircle, ExternalLink, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format, parseISO, addMonths, differenceInDays } from "date-fns";

// ─── Types ───────────────────────────────────────────────────────────────────

interface StaffRow {
  id: string;
  full_name: string;
  role: string;
  department_id: string | null;
  dept_name: string;
}

interface TrainingRecord {
  id: string;
  user_id: string;
  training_type: string | null;
  training_title: string;
  provider: string | null;
  end_date: string | null;
  certificate_url: string | null;
  assessment_score: number | null;
  hours: number | null;
  completed: boolean;
}

type CellStatus = "done" | "expiring" | "missing";

// ─── Compliance columns ───────────────────────────────────────────────────────

const COMPLIANCE_COLS = [
  { key: "orientation",  label: "Orientation",  shortLabel: "Orient.",    validityMonths: null as number | null, types: ["Orientation", "Induction"] },
  { key: "fire_safety",  label: "Fire Safety",  shortLabel: "Fire",       validityMonths: 12,                    types: ["Fire Safety"] },
  { key: "bls_als",      label: "BLS / ALS",    shortLabel: "BLS/ALS",   validityMonths: 24,                    types: ["BLS", "ALS", "CPR"] },
  { key: "ipc",          label: "IPC",          shortLabel: "IPC",        validityMonths: 12,                    types: ["Infection Control", "Waste Management"] },
  { key: "nabh",         label: "NABH Awareness", shortLabel: "NABH",    validityMonths: 24,                    types: ["NABH", "Patient Safety"] },
] as const;

type ColKey = typeof COMPLIANCE_COLS[number]["key"];

// ─── Cell helpers ─────────────────────────────────────────────────────────────

function computeStatus(
  record: TrainingRecord | undefined,
  col: typeof COMPLIANCE_COLS[number],
): CellStatus {
  if (!record) return "missing";
  if (col.validityMonths === null) return "done"; // orientation — one-time
  if (!record.end_date) return "missing";         // completed but no date — can't validate
  const expiry = addMonths(parseISO(record.end_date), col.validityMonths);
  const daysLeft = differenceInDays(expiry, new Date());
  if (daysLeft < 0) return "missing";
  if (daysLeft <= 90) return "expiring";
  return "done";
}

function cellTooltip(
  record: TrainingRecord | undefined,
  col: typeof COMPLIANCE_COLS[number],
  status: CellStatus,
): string {
  if (!record) return "No training record found";
  const dateStr = record.end_date ? format(parseISO(record.end_date), "dd MMM yyyy") : "—";
  if (col.validityMonths === null) return `Completed ${dateStr}`;
  if (!record.end_date) return "Completion date missing";
  const expiry = addMonths(parseISO(record.end_date), col.validityMonths);
  const daysLeft = differenceInDays(expiry, new Date());
  if (status === "missing") return `Expired — completed ${dateStr}`;
  if (status === "expiring") return `Expiring in ${daysLeft}d — due ${format(expiry, "dd MMM yyyy")}`;
  return `Valid until ${format(expiry, "dd MMM yyyy")}`;
}

// ─── Modal form default ───────────────────────────────────────────────────────

const EMPTY_MODAL_FORM = {
  training_title: "",
  provider: "",
  end_date: "",
  certificate_url: "",
  assessment_score: "",
  hours: "",
};

// ─── Component ────────────────────────────────────────────────────────────────

interface Props { hospitalId: string; }

const TrainingComplianceTab: React.FC<Props> = ({ hospitalId }) => {
  const { toast } = useToast();

  const [staffList, setStaffList]       = useState<StaffRow[]>([]);
  const [records, setRecords]           = useState<TrainingRecord[]>([]);
  const [departments, setDepartments]   = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState("");
  const [deptFilter, setDeptFilter]     = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "issues" | "expiring">("all");

  const [modal, setModal] = useState<{
    staffId: string;
    staffName: string;
    col: typeof COMPLIANCE_COLS[number];
    existing: TrainingRecord | undefined;
  } | null>(null);
  const [modalForm, setModalForm] = useState(EMPTY_MODAL_FORM);
  const [modalSaving, setModalSaving] = useState(false);

  // ── Load data ──────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    const allTypes = COMPLIANCE_COLS.flatMap(c => [...c.types]);

    const [usersRes, deptRes, recRes] = await Promise.all([
      supabase.from("users").select("id, full_name, role, department_id")
        .eq("hospital_id", hospitalId).eq("is_active", true).order("full_name"),
      supabase.from("departments").select("id, name")
        .eq("hospital_id", hospitalId).eq("is_active", true).order("name"),
      (supabase as any).from("staff_training_records")
        .select("id, user_id, training_type, training_title, provider, end_date, certificate_url, assessment_score, hours, completed")
        .eq("hospital_id", hospitalId)
        .eq("completed", true)
        .in("training_type", allTypes)
        .order("end_date", { ascending: false, nullsFirst: false }),
    ]);

    const deptMap = new Map((deptRes.data || []).map((d: any) => [d.id, d.name]));
    setDepartments(deptRes.data || []);
    setStaffList(
      (usersRes.data || []).map((u: any) => ({
        id: u.id,
        full_name: u.full_name,
        role: u.role,
        department_id: u.department_id,
        dept_name: deptMap.get(u.department_id) || "—",
      }))
    );
    setRecords(recRes.data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  // ── Record map: userId → colKey → latest record ────────────────────────────

  const recordMap = useMemo(() => {
    const map = new Map<string, Map<ColKey, TrainingRecord>>();
    for (const r of records) {
      if (!r.training_type) continue;
      const col = COMPLIANCE_COLS.find(c => (c.types as readonly string[]).includes(r.training_type!));
      if (!col) continue;
      if (!map.has(r.user_id)) map.set(r.user_id, new Map());
      const existing = map.get(r.user_id)!.get(col.key);
      if (!existing || (r.end_date && (!existing.end_date || r.end_date > existing.end_date))) {
        map.get(r.user_id)!.set(col.key, r);
      }
    }
    return map;
  }, [records]);

  const getRecord  = useCallback((userId: string, key: ColKey) => recordMap.get(userId)?.get(key), [recordMap]);
  const getStatus  = useCallback((userId: string, col: typeof COMPLIANCE_COLS[number]): CellStatus =>
    computeStatus(getRecord(userId, col.key), col), [getRecord]);
  const isFullyCompliant = useCallback((userId: string) =>
    COMPLIANCE_COLS.every(c => getStatus(userId, c) === "done"), [getStatus]);

  // ── Filtered staff ─────────────────────────────────────────────────────────

  const filtered = useMemo(() => staffList.filter(s => {
    if (search && !s.full_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (deptFilter !== "all" && s.department_id !== deptFilter) return false;
    if (statusFilter === "issues")   return COMPLIANCE_COLS.some(c => getStatus(s.id, c) === "missing");
    if (statusFilter === "expiring") return COMPLIANCE_COLS.some(c => getStatus(s.id, c) === "expiring");
    return true;
  }), [staffList, search, deptFilter, statusFilter, getStatus]);

  // ── Summary stats ──────────────────────────────────────────────────────────

  const fullyCompliantCount = useMemo(() =>
    staffList.filter(s => isFullyCompliant(s.id)).length, [staffList, isFullyCompliant]);
  const hasIssuesCount = staffList.length - fullyCompliantCount;

  // ── CSV export ─────────────────────────────────────────────────────────────

  const exportCSV = () => {
    const headers = ["Name", "Role", "Department",
      ...COMPLIANCE_COLS.map(c => c.label),
      ...COMPLIANCE_COLS.map(c => `${c.label} — Completion Date`),
    ];
    const rows = staffList.map(s => {
      const statuses = COMPLIANCE_COLS.map(c => {
        const st = getStatus(s.id, c);
        return st === "done" ? "Compliant" : st === "expiring" ? "Expiring" : "Not Done / Expired";
      });
      const dates = COMPLIANCE_COLS.map(c => {
        const r = getRecord(s.id, c.key);
        return r?.end_date ? format(parseISO(r.end_date), "dd MMM yyyy") : "";
      });
      return [s.full_name, s.role, s.dept_name, ...statuses, ...dates];
    });
    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `training-compliance-${format(new Date(), "yyyy-MM-dd")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "CSV downloaded", description: `${staffList.length} staff members exported` });
  };

  // ── Open modal ─────────────────────────────────────────────────────────────

  const openModal = (s: StaffRow, col: typeof COMPLIANCE_COLS[number]) => {
    const existing = getRecord(s.id, col.key);
    setModal({ staffId: s.id, staffName: s.full_name, col, existing });
    setModalForm(existing ? {
      training_title: existing.training_title || `${col.label} Training`,
      provider: existing.provider || "",
      end_date: existing.end_date || "",
      certificate_url: existing.certificate_url || "",
      assessment_score: existing.assessment_score?.toString() || "",
      hours: existing.hours?.toString() || "",
    } : {
      ...EMPTY_MODAL_FORM,
      training_title: `${col.label} Training`,
    });
  };

  // ── Save modal ─────────────────────────────────────────────────────────────

  const saveModal = async () => {
    if (!modal || !modalForm.end_date) return;
    setModalSaving(true);
    const { error } = await (supabase as any).from("staff_training_records").insert({
      hospital_id: hospitalId,
      user_id: modal.staffId,
      training_type: modal.col.types[0],
      training_title: modalForm.training_title || `${modal.col.label} Training`,
      provider: modalForm.provider || null,
      end_date: modalForm.end_date,
      certificate_url: modalForm.certificate_url || null,
      assessment_score: modalForm.assessment_score ? parseFloat(modalForm.assessment_score) : null,
      hours: modalForm.hours ? parseFloat(modalForm.hours) : null,
      completed: true,
    });
    setModalSaving(false);
    if (error) {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${modal.col.label} training recorded for ${modal.staffName}` });
    setModal(null);
    load();
  };

  // ── Render cell ────────────────────────────────────────────────────────────

  const renderCell = (s: StaffRow, col: typeof COMPLIANCE_COLS[number]) => {
    const record = getRecord(s.id, col.key);
    const status = computeStatus(record, col);
    const tip    = cellTooltip(record, col, status);

    const cfg = {
      done:     { cls: "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200", Icon: CheckCircle2 },
      expiring: { cls: "bg-amber-50 hover:bg-amber-100 text-amber-600 border-amber-200",         Icon: AlertTriangle },
      missing:  { cls: "bg-red-50 hover:bg-red-100 text-red-600 border-red-200",                 Icon: XCircle },
    }[status];

    return (
      <td key={col.key} className="px-2 py-1.5 text-center">
        <button
          title={tip}
          onClick={() => openModal(s, col)}
          className={cn(
            "w-full h-8 rounded border text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors",
            cfg.cls
          )}
        >
          <cfg.Icon className="h-3 w-3 shrink-0" />
          {record?.end_date ? format(parseISO(record.end_date), "MMM yy") : (status === "done" ? "Done" : "—")}
        </button>
      </td>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Header */}
      <div className="flex-shrink-0 px-5 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-semibold">Training Compliance Matrix</span>
          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[11px]">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {fullyCompliantCount} / {staffList.length} Fully Compliant
          </Badge>
          {hasIssuesCount > 0 && (
            <Badge className="bg-red-100 text-red-700 border-red-200 text-[11px]">
              <XCircle className="h-3 w-3 mr-1" />
              {hasIssuesCount} with Issues
            </Badge>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={exportCSV} disabled={loading || staffList.length === 0} className="h-7 text-xs gap-1.5">
          <Download className="h-3.5 w-3.5" /> Export Compliance Report
        </Button>
      </div>

      {/* Filters */}
      <div className="flex-shrink-0 px-5 py-2 border-b border-border flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search staff…"
            className="h-7 text-xs pl-7 w-44"
          />
        </div>
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="h-7 text-xs w-40"><SelectValue placeholder="All Departments" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex rounded border border-input overflow-hidden text-[11px]">
          {([
            { v: "all",      l: "All" },
            { v: "issues",   l: "Has Issues" },
            { v: "expiring", l: "Expiring" },
          ] as const).map(opt => (
            <button
              key={opt.v}
              onClick={() => setStatusFilter(opt.v)}
              className={cn(
                "px-2.5 py-1 capitalize",
                statusFilter === opt.v ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"
              )}
            >
              {opt.l}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground ml-auto">{filtered.length} staff</span>
      </div>

      {/* Legend */}
      <div className="flex-shrink-0 px-5 py-1.5 border-b border-border flex items-center gap-4 bg-muted/20">
        {[
          { Icon: CheckCircle2, cls: "text-emerald-600", label: "Compliant" },
          { Icon: AlertTriangle, cls: "text-amber-600",  label: "Expiring ≤ 90d" },
          { Icon: XCircle,       cls: "text-red-600",    label: "Expired / Not done" },
        ].map(({ Icon, cls, label }) => (
          <span key={label} className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Icon className={cn("h-3 w-3", cls)} /> {label}
          </span>
        ))}
        <span className="text-[10px] text-muted-foreground/60 ml-auto">Click any cell to add / update record</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading compliance data…
          </div>
        ) : staffList.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No active staff found.</div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap min-w-[160px]">Staff Member</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">Dept</th>
                {COMPLIANCE_COLS.map(col => (
                  <th key={col.key} className="px-2 py-2.5 text-center text-xs font-semibold text-muted-foreground whitespace-nowrap min-w-[90px]">
                    <div>{col.label}</div>
                    {col.validityMonths !== null && (
                      <div className="text-[9px] font-normal text-muted-foreground/60">renew {col.validityMonths}mo</div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id} className="border-t border-border/50 hover:bg-muted/20">
                  <td className="px-4 py-1.5">
                    <div className="font-medium text-sm">{s.full_name}</div>
                    <div className="text-[10px] text-muted-foreground capitalize">{s.role.replace(/_/g, " ")}</div>
                  </td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground whitespace-nowrap">{s.dept_name}</td>
                  {COMPLIANCE_COLS.map(col => renderCell(s, col))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit / Add modal */}
      <Dialog open={!!modal} onOpenChange={open => { if (!open) setModal(null); }}>
        <DialogContent className="max-w-sm">
          {modal && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base">
                  {modal.col.label} Training
                  <Badge className="text-[10px] font-normal">{modal.staffName}</Badge>
                </DialogTitle>
              </DialogHeader>

              {modal.existing && (
                <div className="rounded border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground space-y-0.5">
                  <p className="font-semibold text-foreground text-xs">Current record</p>
                  <p>Completed: {modal.existing.end_date ? format(parseISO(modal.existing.end_date), "dd MMM yyyy") : "—"}</p>
                  {modal.existing.provider && <p>Provider: {modal.existing.provider}</p>}
                  {modal.existing.certificate_url && (
                    <a href={modal.existing.certificate_url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline">
                      <ExternalLink className="h-3 w-3" /> View Certificate
                    </a>
                  )}
                </div>
              )}

              <div className="space-y-3 mt-1">
                <div>
                  <Label className="text-xs">Training Title</Label>
                  <Input value={modalForm.training_title}
                    onChange={e => setModalForm(f => ({ ...f, training_title: e.target.value }))}
                    className="h-8 text-sm mt-1" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Provider / Organiser</Label>
                    <Input value={modalForm.provider}
                      onChange={e => setModalForm(f => ({ ...f, provider: e.target.value }))}
                      placeholder="AHA, internal…" className="h-8 text-sm mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Completion Date *</Label>
                    <Input type="date" value={modalForm.end_date}
                      onChange={e => setModalForm(f => ({ ...f, end_date: e.target.value }))}
                      className="h-8 text-sm mt-1" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Certificate URL</Label>
                  <Input value={modalForm.certificate_url}
                    onChange={e => setModalForm(f => ({ ...f, certificate_url: e.target.value }))}
                    placeholder="https://drive.google.com/…" className="h-8 text-sm mt-1" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Assessment Score (%)</Label>
                    <Input type="number" min="0" max="100" value={modalForm.assessment_score}
                      onChange={e => setModalForm(f => ({ ...f, assessment_score: e.target.value }))}
                      placeholder="85" className="h-8 text-sm mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Hours</Label>
                    <Input type="number" min="0" step="0.5" value={modalForm.hours}
                      onChange={e => setModalForm(f => ({ ...f, hours: e.target.value }))}
                      placeholder="4" className="h-8 text-sm mt-1" />
                  </div>
                </div>
              </div>

              <div className="flex gap-2 mt-2">
                <Button variant="outline" size="sm" className="flex-1 h-9" onClick={() => setModal(null)}>
                  Cancel
                </Button>
                <Button size="sm" className="flex-[2] h-9" onClick={saveModal}
                  disabled={modalSaving || !modalForm.end_date}>
                  {modalSaving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                  {modal.existing ? "Add Renewed Record" : "Save Record"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TrainingComplianceTab;

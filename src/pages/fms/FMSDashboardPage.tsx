import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Wrench, ShieldAlert, Trash2, FlaskConical, Package, Plus,
  Loader2, X, AlertTriangle, CheckCircle2, ExternalLink, ChevronDown, ChevronRight, Printer,
  Flame, Wind, Zap,
} from "lucide-react";
import FireSafetyTab from "@/components/fms/FireSafetyTab";
import MedicalGasTab from "@/components/fms/MedicalGasTab";
import ElectricalSafetyTab from "@/components/fms/ElectricalSafetyTab";
import { cn } from "@/lib/utils";
import { format, parseISO, isPast, differenceInDays, startOfMonth, endOfMonth } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Asset {
  id: string;
  asset_tag: string;
  name: string;
  category: string | null;
  location: string | null;
  vendor: string | null;
  warranty_expiry: string | null;
  amc_provider: string | null;
  amc_expiry: string | null;
  is_active: boolean;
  _next_due?: string | null;
}

interface MaintenanceLog {
  id: string;
  asset_id: string | null;
  maintenance_date: string;
  type: string;
  description: string | null;
  performed_by: string | null;
  status: string;
  next_due_date: string | null;
  document_url: string | null;
  asset_name?: string;
  asset_tag?: string;
}

interface SafetyRound {
  id: string;
  round_date: string;
  area: string | null;
  conducted_by: string | null;
  findings: string | null;
  non_compliances: string[];
  corrective_actions: string | null;
  conductor_name?: string;
}

interface BmwManifest {
  id: string;
  manifest_date: string;
  vendor: string | null;
  yellow_bag_kg: number;
  red_bag_kg: number;
  blue_bag_kg: number;
  white_bag_kg: number;
  route_sheet_url: string | null;
  remarks: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ASSET_CATEGORIES = [
  "MRI", "CT Scanner", "X-Ray", "Ultrasound", "OT Table", "OT Light",
  "Anaesthesia Machine", "Ventilator", "Defibrillator", "ECG Machine",
  "Autoclave", "CSSD Equipment", "Lift", "DG Set", "AC Plant",
  "Fire Extinguisher", "Oxygen Plant", "Vacuum System", "Water Treatment",
  "Biomedical Equipment", "Other",
];

const MAINTENANCE_TYPES = [
  { value: "preventive",   label: "Preventive Maintenance" },
  { value: "breakdown",    label: "Breakdown Repair" },
  { value: "calibration",  label: "Calibration" },
  { value: "safety_check", label: "Safety Check" },
];

const STATUS_STYLES: Record<string, string> = {
  ok:          "bg-emerald-100 text-emerald-700 border-emerald-200",
  observation: "bg-amber-100 text-amber-700 border-amber-200",
  defect:      "bg-red-100 text-red-700 border-red-200",
};

const BMW_COLORS = [
  { key: "yellow_bag_kg", label: "Yellow",  color: "bg-yellow-400", desc: "Infectious / Pathological" },
  { key: "red_bag_kg",    label: "Red",     color: "bg-red-400",    desc: "Contaminated / Recyclable" },
  { key: "blue_bag_kg",   label: "Blue",    color: "bg-blue-400",   desc: "Glass Waste" },
  { key: "white_bag_kg",  label: "White",   color: "bg-slate-200",  desc: "Sharps / Metallic" },
];

const today = new Date().toISOString().split("T")[0];

// ─── Sub-components ───────────────────────────────────────────────────────────

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="text-[11px] font-medium text-muted-foreground block mb-1">{children}</label>
);

const SectionHeader: React.FC<{ icon: React.ElementType; title: string; children?: React.ReactNode }> = ({ icon: Icon, title, children }) => (
  <div className="p-4 border-b flex items-center justify-between gap-3 shrink-0 flex-wrap">
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-primary shrink-0" />
      <span className="text-sm font-semibold">{title}</span>
      {children}
    </div>
  </div>
);

// ─── Due-soon row ─────────────────────────────────────────────────────────────

interface DueSoonRow {
  assetId: string;
  assetName: string;
  assetTag: string;
  location: string | null;
  type: string;
  nextDue: string;
  daysRemaining: number;
}

// ─── Assets Tab ───────────────────────────────────────────────────────────────

const AssetsTab: React.FC<{ hospitalId: string }> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState({
    asset_tag: "", name: "", category: "", location: "", vendor: "",
    warranty_expiry: "", amc_provider: "", amc_expiry: "",
  });
  const [saving, setSaving] = useState(false);
  const [dueSoon, setDueSoon] = useState<DueSoonRow[]>([]);
  const [logTarget, setLogTarget] = useState<DueSoonRow | null>(null);
  const [logForm, setLogForm] = useState({ description: "", performed_by: "", status: "ok", next_due_date: "", document_url: "" });
  const [savingLog, setSavingLog] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const todayStr = new Date().toISOString().split("T")[0];
    const in30Days = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

    const [assetsRes, logsRes, dueSoonRes] = await Promise.all([
      (supabase as any).from("facility_assets").select("*")
        .eq("hospital_id", hospitalId).eq("is_active", true).order("name"),
      (supabase as any).from("facility_maintenance_logs")
        .select("asset_id, next_due_date")
        .eq("hospital_id", hospitalId)
        .not("next_due_date", "is", null)
        .order("next_due_date", { ascending: true }),
      (supabase as any).from("facility_maintenance_logs")
        .select("asset_id, next_due_date, type")
        .eq("hospital_id", hospitalId)
        .gte("next_due_date", todayStr)
        .lte("next_due_date", in30Days)
        .order("next_due_date", { ascending: true }),
    ]);

    const nextDueMap: Record<string, string> = {};
    for (const log of (logsRes.data || [])) {
      if (!nextDueMap[log.asset_id]) nextDueMap[log.asset_id] = log.next_due_date;
    }
    const assetList: Asset[] = (assetsRes.data || []).map((a: Asset) => ({
      ...a, _next_due: nextDueMap[a.id] || null,
    }));
    setAssets(assetList);

    // Build due-soon rows — deduplicated by asset+type, keeping earliest per combo
    const assetMap = new Map(assetList.map(a => [a.id, a]));
    const seen = new Set<string>();
    const dueSoonRows: DueSoonRow[] = [];
    for (const log of (dueSoonRes.data || [])) {
      const key = `${log.asset_id}:${log.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const asset = assetMap.get(log.asset_id);
      if (!asset) continue;
      dueSoonRows.push({
        assetId: log.asset_id,
        assetName: asset.name,
        assetTag: asset.asset_tag,
        location: asset.location,
        type: log.type,
        nextDue: log.next_due_date,
        daysRemaining: Math.max(0, differenceInDays(parseISO(log.next_due_date), new Date())),
      });
    }
    setDueSoon(dueSoonRows);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.asset_tag || !form.name) return;
    setSaving(true);
    const { error } = await (supabase as any).from("facility_assets").insert({
      hospital_id: hospitalId,
      asset_tag: form.asset_tag,
      name: form.name,
      category: form.category || null,
      location: form.location || null,
      vendor: form.vendor || null,
      warranty_expiry: form.warranty_expiry || null,
      amc_provider: form.amc_provider || null,
      amc_expiry: form.amc_expiry || null,
    });
    if (error) toast({ title: "Failed to add asset", description: error.message, variant: "destructive" });
    else { toast({ title: "Asset added" }); setShowAdd(false); setForm({ asset_tag: "", name: "", category: "", location: "", vendor: "", warranty_expiry: "", amc_provider: "", amc_expiry: "" }); load(); }
    setSaving(false);
  };

  const handleDeactivate = async (id: string) => {
    await (supabase as any).from("facility_assets").update({ is_active: false }).eq("id", id);
    toast({ title: "Asset removed" });
    load();
  };

  const handleLogSave = async () => {
    if (!logTarget) return;
    setSavingLog(true);
    const todayStr = new Date().toISOString().split("T")[0];
    const { data: newLog, error } = await (supabase as any)
      .from("facility_maintenance_logs")
      .insert({
        hospital_id: hospitalId,
        asset_id: logTarget.assetId,
        maintenance_date: todayStr,
        type: logTarget.type,
        description: logForm.description || null,
        performed_by: logForm.performed_by || null,
        status: logForm.status,
        next_due_date: logForm.next_due_date || null,
        document_url: logForm.document_url || null,
      })
      .select("id")
      .single();

    if (error) {
      toast({ title: "Failed to save log", description: error.message, variant: "destructive" });
    } else {
      // Clear next_due_date on all prior logs for this asset+type so it leaves the due-soon list
      if (newLog?.id) {
        await (supabase as any)
          .from("facility_maintenance_logs")
          .update({ next_due_date: null })
          .eq("hospital_id", hospitalId)
          .eq("asset_id", logTarget.assetId)
          .eq("type", logTarget.type)
          .neq("id", newLog.id);
      }
      toast({
        title: "Maintenance logged",
        description: `${logTarget.assetName} · ${MAINTENANCE_TYPES.find(t => t.value === logTarget.type)?.label || logTarget.type}`,
      });
      setLogTarget(null);
      setLogForm({ description: "", performed_by: "", status: "ok", next_due_date: "", document_url: "" });
      load();
    }
    setSavingLog(false);
  };

  const amcStatus = (expiry: string | null) => {
    if (!expiry) return "none";
    if (isPast(parseISO(expiry))) return "expired";
    if (differenceInDays(parseISO(expiry), new Date()) <= 30) return "expiring";
    return "valid";
  };

  const filtered = assets.filter(a => {
    if (filterCat !== "all" && a.category !== filterCat) return false;
    if (search) {
      const q = search.toLowerCase();
      return (a.name || "").toLowerCase().includes(q) || (a.asset_tag || "").toLowerCase().includes(q) || (a.location || "").toLowerCase().includes(q);
    }
    return true;
  });

  const overdueMaint = assets.filter(a => a._next_due && isPast(parseISO(a._next_due)));
  const amcExpiring  = assets.filter(a => amcStatus(a.amc_expiry) === "expiring" || amcStatus(a.amc_expiry) === "expired");

  const dayChip = (days: number) => {
    if (days === 0) return "bg-red-100 text-red-700 border-red-200";
    if (days <= 7)  return "bg-red-100 text-red-700 border-red-200";
    if (days <= 14) return "bg-orange-100 text-orange-700 border-orange-200";
    return "bg-amber-100 text-amber-700 border-amber-200";
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <SectionHeader icon={Package} title="Facility Assets">
        {overdueMaint.length > 0 && <Badge className="bg-red-100 text-red-700 border-red-200">{overdueMaint.length} Maintenance Overdue</Badge>}
        {amcExpiring.length > 0  && <Badge className="bg-amber-100 text-amber-700 border-amber-200">{amcExpiring.length} AMC Expiring</Badge>}
        <Button size="sm" onClick={() => setShowAdd(s => !s)} className="h-7 text-xs gap-1 ml-auto">
          <Plus className="h-3 w-3" /> Add Asset
        </Button>
      </SectionHeader>

      {showAdd && (
        <div className="border-b p-4 bg-muted/40 space-y-3 shrink-0">
          <p className="text-[11px] text-muted-foreground bg-blue-50 border border-blue-200 rounded px-3 py-1.5">
            Register facility infrastructure here (HVAC, DG Set, Fire suppression, Medical Gas, Electrical panels, elevators).
            For clinical medical devices (MRI, Ventilator, monitors, etc.) use the{" "}
            <a href="/biomedical" className="text-blue-600 underline font-medium">Biomedical Engineering</a> module.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div><FieldLabel>Asset Tag *</FieldLabel><Input value={form.asset_tag} onChange={e => setForm(f => ({ ...f, asset_tag: e.target.value }))} placeholder="e.g. EQ-001" className="h-8 text-sm" /></div>
            <div className="col-span-2"><FieldLabel>Name *</FieldLabel><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. DG Set 250 KVA — Kirloskar" className="h-8 text-sm" /></div>
            <div>
              <FieldLabel>Category</FieldLabel>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                <option value="">Select…</option>
                {ASSET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div><FieldLabel>Location</FieldLabel><Input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Radiology Wing" className="h-8 text-sm" /></div>
            <div><FieldLabel>Vendor</FieldLabel><Input value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} placeholder="e.g. GE Healthcare" className="h-8 text-sm" /></div>
            <div><FieldLabel>Warranty Expiry</FieldLabel><Input type="date" value={form.warranty_expiry} onChange={e => setForm(f => ({ ...f, warranty_expiry: e.target.value }))} className="h-8 text-sm" /></div>
            <div><FieldLabel>AMC Provider</FieldLabel><Input value={form.amc_provider} onChange={e => setForm(f => ({ ...f, amc_provider: e.target.value }))} placeholder="Service company" className="h-8 text-sm" /></div>
            <div><FieldLabel>AMC Expiry</FieldLabel><Input type="date" value={form.amc_expiry} onChange={e => setForm(f => ({ ...f, amc_expiry: e.target.value }))} className="h-8 text-sm" /></div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving || !form.asset_tag || !form.name} className="h-7 text-xs flex-1">
              {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />} Save Asset
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)} className="h-7 text-xs">Cancel</Button>
          </div>
        </div>
      )}

      {/* ── Upcoming Maintenance / Calibration Banner ──────────────────────── */}
      {dueSoon.length > 0 && (
        <div className="border-b border-amber-200 bg-amber-50/60 dark:bg-amber-950/20 shrink-0">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-100 dark:border-amber-900">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              {dueSoon.length} asset{dueSoon.length !== 1 ? "s" : ""} have maintenance or calibration due in the next 30 days
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-amber-100 dark:border-amber-900">
                  {["Asset", "Location", "Type", "Next Due Date", "Days Remaining", ""].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[11px] font-semibold text-amber-700 dark:text-amber-400 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dueSoon.map(row => (
                  <tr
                    key={`${row.assetId}:${row.type}`}
                    className="border-b border-amber-100/60 dark:border-amber-900/60 last:border-0 hover:bg-amber-100/40 dark:hover:bg-amber-900/20 transition-colors"
                  >
                    <td className="px-3 py-2">
                      <p className="text-sm font-medium leading-tight">{row.assetName}</p>
                      <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{row.assetTag}</p>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {row.location || "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-block text-[11px] bg-white/70 border border-amber-200 text-amber-800 rounded px-1.5 py-0.5 font-medium whitespace-nowrap">
                        {MAINTENANCE_TYPES.find(t => t.value === row.type)?.label || row.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs font-medium whitespace-nowrap">
                      {format(parseISO(row.nextDue), "dd MMM yyyy")}
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn(
                        "inline-block text-[11px] border rounded-full px-2.5 py-0.5 font-bold whitespace-nowrap",
                        dayChip(row.daysRemaining)
                      )}>
                        {row.daysRemaining === 0 ? "Today" : `${row.daysRemaining}d`}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[11px] px-2 gap-1 border-amber-300 hover:bg-amber-100 text-amber-800 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/40 whitespace-nowrap"
                        onClick={() => {
                          setLogTarget(row);
                          setLogForm({ description: "", performed_by: "", status: "ok", next_due_date: "", document_url: "" });
                        }}
                      >
                        <Wrench className="h-3 w-3" /> Log Maintenance
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="px-4 py-2 border-b flex items-center gap-2 shrink-0">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search assets…" className="h-7 text-xs max-w-[200px]" />
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className="h-7 text-xs border border-input rounded px-2 bg-background">
          <option value="all">All Categories</option>
          {ASSET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} assets</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading assets…</span></div>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">{assets.length === 0 ? "No assets registered. Add equipment, life safety systems, and medical devices." : "No assets match your filter."}</p>
        ) : filtered.map(a => {
          const as = amcStatus(a.amc_expiry);
          const isOverdue = a._next_due && isPast(parseISO(a._next_due));
          const isOpen = expanded === a.id;
          return (
            <div key={a.id} className={cn("border rounded-lg overflow-hidden", isOverdue ? "border-red-200" : as === "expired" ? "border-red-200" : as === "expiring" ? "border-amber-200" : "border-border")}>
              <div
                className={cn("px-3 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-muted/40",
                  isOverdue ? "bg-red-50/50 dark:bg-red-950/20" : as === "expired" ? "bg-red-50/50 dark:bg-red-950/20" : as === "expiring" ? "bg-amber-50/30" : "bg-card"
                )}
                onClick={() => setExpanded(isOpen ? null : a.id)}
              >
                <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-px rounded shrink-0">{a.asset_tag}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{a.name}</span>
                  {a.category && <span className="text-[10px] text-muted-foreground ml-2">{a.category}</span>}
                  {a.location && <span className="text-[10px] text-muted-foreground ml-2">· {a.location}</span>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isOverdue && <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">Maintenance Overdue</Badge>}
                  {!isOverdue && as === "expiring" && <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">AMC Expiring</Badge>}
                  {!isOverdue && as === "expired"  && <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">AMC Expired</Badge>}
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                </div>
              </div>
              {isOpen && (
                <div className="border-t px-4 py-3 bg-muted/20 grid grid-cols-3 gap-x-6 gap-y-1.5 text-xs">
                  <div><span className="text-muted-foreground">Vendor:</span> {a.vendor || "—"}</div>
                  <div><span className="text-muted-foreground">Warranty:</span> {a.warranty_expiry ? format(parseISO(a.warranty_expiry), "dd MMM yyyy") : "—"}</div>
                  <div><span className="text-muted-foreground">AMC Provider:</span> {a.amc_provider || "—"}</div>
                  <div><span className="text-muted-foreground">AMC Expiry:</span> {a.amc_expiry ? format(parseISO(a.amc_expiry), "dd MMM yyyy") : "—"}</div>
                  <div><span className="text-muted-foreground">Next Maintenance:</span> {a._next_due ? <span className={cn(isPast(parseISO(a._next_due)) ? "text-red-600 font-medium" : "")}>{format(parseISO(a._next_due), "dd MMM yyyy")}</span> : "—"}</div>
                  <div className="flex justify-end">
                    <button onClick={() => handleDeactivate(a.id)} className="text-muted-foreground hover:text-destructive text-[10px] flex items-center gap-1">
                      <Trash2 className="h-3 w-3" /> Remove
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Quick Log Maintenance Modal ──────────────────────────────────────── */}
      {logTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={e => { if (e.target === e.currentTarget) setLogTarget(null); }}
        >
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md p-5 mx-4">
            {/* Modal header */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold flex items-center gap-1.5">
                  <Wrench className="h-4 w-4 text-primary" /> Log Maintenance
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  <span className="font-medium text-foreground">{logTarget.assetName}</span>
                  <span className="mx-1">·</span>
                  {MAINTENANCE_TYPES.find(t => t.value === logTarget.type)?.label || logTarget.type}
                  {logTarget.location && <span className="ml-1 text-muted-foreground">· {logTarget.location}</span>}
                </p>
                <p className="text-[11px] text-amber-600 mt-0.5">
                  Due: {format(parseISO(logTarget.nextDue), "dd MMM yyyy")}
                  {logTarget.daysRemaining === 0 ? " (Today)" : ` (${logTarget.daysRemaining}d remaining)`}
                </p>
              </div>
              <button onClick={() => setLogTarget(null)} className="text-muted-foreground hover:text-foreground p-1 -mr-1 -mt-1">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Form fields */}
            <div className="space-y-3">
              <div>
                <FieldLabel>Description / Work Done</FieldLabel>
                <textarea
                  value={logForm.description}
                  onChange={e => setLogForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Describe maintenance performed, findings, parts replaced…"
                  className="w-full text-sm border border-input rounded px-3 py-1.5 bg-background min-h-[64px] resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Performed By</FieldLabel>
                  <Input
                    value={logForm.performed_by}
                    onChange={e => setLogForm(f => ({ ...f, performed_by: e.target.value }))}
                    placeholder="Technician / vendor name"
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <FieldLabel>Outcome / Status</FieldLabel>
                  <select
                    value={logForm.status}
                    onChange={e => setLogForm(f => ({ ...f, status: e.target.value }))}
                    className="w-full h-8 text-sm border border-input rounded px-2 bg-background"
                  >
                    <option value="ok">OK — No issues</option>
                    <option value="observation">Observation noted</option>
                    <option value="defect">Defect found</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Next Due Date</FieldLabel>
                  <Input
                    type="date"
                    value={logForm.next_due_date}
                    onChange={e => setLogForm(f => ({ ...f, next_due_date: e.target.value }))}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <FieldLabel>Service Report URL</FieldLabel>
                  <Input
                    value={logForm.document_url}
                    onChange={e => setLogForm(f => ({ ...f, document_url: e.target.value }))}
                    placeholder="https://…"
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 mt-4 pt-3 border-t border-border">
              <Button
                size="sm"
                className="flex-1 h-8 text-sm gap-1"
                onClick={handleLogSave}
                disabled={savingLog}
              >
                {savingLog
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <CheckCircle2 className="h-3.5 w-3.5" />}
                Save & Mark Done
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-sm" onClick={() => setLogTarget(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Maintenance Logs Tab ─────────────────────────────────────────────────────

const MaintenanceTab: React.FC<{ hospitalId: string }> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [logs, setLogs] = useState<MaintenanceLog[]>([]);
  const [assets, setAssets] = useState<{ id: string; name: string; asset_tag: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [form, setForm] = useState({ asset_id: "", maintenance_date: today, type: "preventive", description: "", performed_by: "", status: "ok", next_due_date: "", document_url: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [logsRes, assetsRes] = await Promise.all([
      (supabase as any).from("facility_maintenance_logs")
        .select("*, a:facility_assets(name, asset_tag)")
        .eq("hospital_id", hospitalId)
        .order("maintenance_date", { ascending: false })
        .limit(200),
      (supabase as any).from("facility_assets").select("id, name, asset_tag").eq("hospital_id", hospitalId).eq("is_active", true).order("name"),
    ]);
    setAssets(assetsRes.data || []);
    setLogs((logsRes.data || []).map((l: any) => ({ ...l, asset_name: l.a?.name, asset_tag: l.a?.asset_tag })));
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.maintenance_date || !form.type) return;
    setSaving(true);
    const { error } = await (supabase as any).from("facility_maintenance_logs").insert({
      hospital_id: hospitalId,
      asset_id: form.asset_id || null,
      maintenance_date: form.maintenance_date,
      type: form.type,
      description: form.description || null,
      performed_by: form.performed_by || null,
      status: form.status,
      next_due_date: form.next_due_date || null,
      document_url: form.document_url || null,
    });
    if (error) toast({ title: "Failed to save log", description: error.message, variant: "destructive" });
    else { toast({ title: "Log saved" }); setShowAdd(false); setForm({ asset_id: "", maintenance_date: today, type: "preventive", description: "", performed_by: "", status: "ok", next_due_date: "", document_url: "" }); load(); }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await (supabase as any).from("facility_maintenance_logs").delete().eq("id", id);
    toast({ title: "Log deleted" });
    load();
  };

  const filtered = logs.filter(l => {
    if (filterStatus !== "all" && l.status !== filterStatus) return false;
    if (filterType !== "all" && l.type !== filterType) return false;
    if (search) {
      const q = search.toLowerCase();
      return (l.asset_name || "").toLowerCase().includes(q) || (l.asset_tag || "").toLowerCase().includes(q) || (l.performed_by || "").toLowerCase().includes(q) || (l.description || "").toLowerCase().includes(q);
    }
    return true;
  });

  const overdue = logs.filter(l => l.next_due_date && isPast(parseISO(l.next_due_date)));
  const defects = logs.filter(l => l.status === "defect");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <SectionHeader icon={Wrench} title="Maintenance & Calibration Logs">
        {overdue.length > 0  && <Badge className="bg-red-100 text-red-700 border-red-200">{overdue.length} Overdue</Badge>}
        {defects.length > 0  && <Badge className="bg-red-100 text-red-700 border-red-200">{defects.length} Defects</Badge>}
        <Button size="sm" onClick={() => setShowAdd(s => !s)} className="h-7 text-xs gap-1 ml-auto">
          <Plus className="h-3 w-3" /> Add Log
        </Button>
      </SectionHeader>

      {showAdd && (
        <div className="border-b p-4 bg-muted/40 space-y-3 shrink-0">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <FieldLabel>Asset</FieldLabel>
              <select value={form.asset_id} onChange={e => setForm(f => ({ ...f, asset_id: e.target.value }))} className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                <option value="">No specific asset / General</option>
                {assets.map(a => <option key={a.id} value={a.id}>{a.asset_tag} — {a.name}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Date *</FieldLabel>
              <Input type="date" value={form.maintenance_date} onChange={e => setForm(f => ({ ...f, maintenance_date: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div>
              <FieldLabel>Type *</FieldLabel>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                {MAINTENANCE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <FieldLabel>Description</FieldLabel>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Work done, findings…" className="h-8 text-sm" />
            </div>
            <div>
              <FieldLabel>Performed By</FieldLabel>
              <Input value={form.performed_by} onChange={e => setForm(f => ({ ...f, performed_by: e.target.value }))} placeholder="Technician / vendor name" className="h-8 text-sm" />
            </div>
            <div>
              <FieldLabel>Status *</FieldLabel>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                <option value="ok">OK</option>
                <option value="observation">Observation</option>
                <option value="defect">Defect</option>
              </select>
            </div>
            <div>
              <FieldLabel>Next Due Date</FieldLabel>
              <Input type="date" value={form.next_due_date} onChange={e => setForm(f => ({ ...f, next_due_date: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div>
              <FieldLabel>Document URL</FieldLabel>
              <Input value={form.document_url} onChange={e => setForm(f => ({ ...f, document_url: e.target.value }))} placeholder="Service report link" className="h-8 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving || !form.maintenance_date} className="h-7 text-xs flex-1">
              {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />} Save Log
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)} className="h-7 text-xs">Cancel</Button>
          </div>
        </div>
      )}

      <div className="px-4 py-2 border-b flex items-center gap-2 shrink-0 flex-wrap">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search asset, technician…" className="h-7 text-xs max-w-[180px]" />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="h-7 text-xs border border-input rounded px-2 bg-background">
          <option value="all">All Status</option>
          <option value="ok">OK</option>
          <option value="observation">Observation</option>
          <option value="defect">Defect</option>
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="h-7 text-xs border border-input rounded px-2 bg-background">
          <option value="all">All Types</option>
          {MAINTENANCE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} records</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading logs…</span></div>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">{logs.length === 0 ? "No maintenance logs yet. Record preventive maintenance, calibrations, and safety checks." : "No logs match your filter."}</p>
        ) : filtered.map(l => {
          const isOverdue = l.next_due_date && isPast(parseISO(l.next_due_date));
          const typeLabel = MAINTENANCE_TYPES.find(t => t.value === l.type)?.label || l.type;
          return (
            <div key={l.id} className={cn("border rounded-lg px-3 py-2.5 flex items-start gap-3",
              l.status === "defect" || isOverdue ? "border-red-200 bg-red-50/40 dark:bg-red-950/20" :
              l.status === "observation" ? "border-amber-200 bg-amber-50/30" : "border-border bg-card"
            )}>
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{l.asset_name || "General"}</span>
                  {l.asset_tag && <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-px rounded">{l.asset_tag}</span>}
                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-px rounded">{typeLabel}</span>
                  <span className={cn("text-[10px] px-1.5 py-px rounded border font-medium", STATUS_STYLES[l.status])}>
                    {l.status === "ok" ? "OK" : l.status === "observation" ? "Observation" : "Defect"}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[11px] flex-wrap">
                  <span className="text-muted-foreground">{format(parseISO(l.maintenance_date), "dd MMM yyyy")}</span>
                  {l.performed_by && <span className="text-foreground">{l.performed_by}</span>}
                  {l.description && <span className="text-muted-foreground truncate max-w-[300px]">{l.description}</span>}
                </div>
                {l.next_due_date && (
                  <div className={cn("text-[10px] flex items-center gap-1", isOverdue ? "text-red-600 font-medium" : "text-muted-foreground")}>
                    {isOverdue && <AlertTriangle className="h-2.5 w-2.5" />}
                    Next due: {format(parseISO(l.next_due_date), "dd MMM yyyy")}
                    {isOverdue ? " (Overdue)" : ""}
                  </div>
                )}
                {l.document_url && (
                  <a href={l.document_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline">
                    <ExternalLink className="h-2.5 w-2.5" /> Service Report
                  </a>
                )}
              </div>
              <button onClick={() => handleDelete(l.id)} className="p-1 text-muted-foreground hover:text-destructive shrink-0 mt-0.5">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Safety Rounds Tab ────────────────────────────────────────────────────────

const SafetyRoundsTab: React.FC<{ hospitalId: string }> = ({ hospitalId }) => {
  const { toast } = useToast();
  const { userId } = useHospitalId();
  const [rounds, setRounds] = useState<SafetyRound[]>([]);
  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ round_date: today, area: "", conducted_by: "", findings: "", non_compliances: "", corrective_actions: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [roundsRes, staffRes] = await Promise.all([
      (supabase as any).from("safety_rounds")
        .select("*, u:users!safety_rounds_conducted_by_fkey(full_name)")
        .eq("hospital_id", hospitalId)
        .order("round_date", { ascending: false })
        .limit(100),
      supabase.from("users").select("id, full_name").eq("hospital_id", hospitalId).eq("is_active", true),
    ]);
    setStaff(staffRes.data || []);
    setRounds((roundsRes.data || []).map((r: any) => ({
      ...r,
      non_compliances: Array.isArray(r.non_compliances) ? r.non_compliances : [],
      conductor_name: r.u?.full_name,
    })));
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.round_date) return;
    setSaving(true);
    const ncs = form.non_compliances.split("\n").map(s => s.trim()).filter(Boolean);
    const { error } = await (supabase as any).from("safety_rounds").insert({
      hospital_id: hospitalId,
      round_date: form.round_date,
      area: form.area || null,
      conducted_by: form.conducted_by || userId || null,
      findings: form.findings || null,
      non_compliances: ncs,
      corrective_actions: form.corrective_actions || null,
    });
    if (error) toast({ title: "Failed to save round", description: error.message, variant: "destructive" });
    else { toast({ title: "Safety round recorded" }); setShowAdd(false); setForm({ round_date: today, area: "", conducted_by: "", findings: "", non_compliances: "", corrective_actions: "" }); load(); }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await (supabase as any).from("safety_rounds").delete().eq("id", id);
    toast({ title: "Round deleted" });
    load();
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <SectionHeader icon={ShieldAlert} title="Safety Rounds">
        <Button size="sm" onClick={() => setShowAdd(s => !s)} className="h-7 text-xs gap-1 ml-auto">
          <Plus className="h-3 w-3" /> Record Round
        </Button>
      </SectionHeader>

      {showAdd && (
        <div className="border-b p-4 bg-muted/40 space-y-3 shrink-0">
          <div className="grid grid-cols-3 gap-3">
            <div><FieldLabel>Date *</FieldLabel><Input type="date" value={form.round_date} onChange={e => setForm(f => ({ ...f, round_date: e.target.value }))} className="h-8 text-sm" /></div>
            <div><FieldLabel>Area / Ward</FieldLabel><Input value={form.area} onChange={e => setForm(f => ({ ...f, area: e.target.value }))} placeholder="e.g. ICU, OT complex, Kitchen" className="h-8 text-sm" /></div>
            <div>
              <FieldLabel>Conducted By</FieldLabel>
              <select value={form.conducted_by} onChange={e => setForm(f => ({ ...f, conducted_by: e.target.value }))} className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                <option value="">Select…</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
            <div className="col-span-3">
              <FieldLabel>Findings / Observations</FieldLabel>
              <textarea value={form.findings} onChange={e => setForm(f => ({ ...f, findings: e.target.value }))}
                placeholder="Overall observations from the round…"
                className="w-full text-sm border border-input rounded px-3 py-1.5 bg-background min-h-[60px] resize-none" />
            </div>
            <div className="col-span-2">
              <FieldLabel>Non-compliances (one per line)</FieldLabel>
              <textarea value={form.non_compliances} onChange={e => setForm(f => ({ ...f, non_compliances: e.target.value }))}
                placeholder={"Sharp container overfilled in Ward 3\nFire exit blocked in corridor B"}
                className="w-full text-sm border border-input rounded px-3 py-1.5 bg-background min-h-[60px] resize-none" />
            </div>
            <div>
              <FieldLabel>Corrective Actions</FieldLabel>
              <textarea value={form.corrective_actions} onChange={e => setForm(f => ({ ...f, corrective_actions: e.target.value }))}
                placeholder="Actions taken or assigned…"
                className="w-full text-sm border border-input rounded px-3 py-1.5 bg-background min-h-[60px] resize-none" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving || !form.round_date} className="h-7 text-xs flex-1">
              {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />} Save Round
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)} className="h-7 text-xs">Cancel</Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading rounds…</span></div>
        ) : rounds.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">No safety rounds recorded. Document daily/weekly safety walkrounds for FMS evidence.</p>
        ) : rounds.map(r => (
          <div key={r.id} className={cn("border rounded-lg px-3 py-3", r.non_compliances.length > 0 ? "border-amber-200 bg-amber-50/30 dark:bg-amber-950/20" : "border-border bg-card")}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{format(parseISO(r.round_date), "dd MMM yyyy")}</span>
                  {r.area && <span className="text-xs text-muted-foreground bg-muted px-1.5 py-px rounded">{r.area}</span>}
                  {r.conductor_name && <span className="text-[11px] text-muted-foreground">by {r.conductor_name}</span>}
                  {r.non_compliances.length > 0 && (
                    <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">
                      <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                      {r.non_compliances.length} Non-compliance{r.non_compliances.length > 1 ? "s" : ""}
                    </Badge>
                  )}
                  {r.non_compliances.length === 0 && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                </div>
                {r.findings && <p className="text-[11px] text-muted-foreground">{r.findings}</p>}
                {r.non_compliances.length > 0 && (
                  <ul className="space-y-0.5 mt-1">
                    {r.non_compliances.map((nc, i) => (
                      <li key={i} className="text-[11px] text-amber-800 dark:text-amber-200 flex items-start gap-1">
                        <span className="shrink-0 mt-px">•</span> {nc}
                      </li>
                    ))}
                  </ul>
                )}
                {r.corrective_actions && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    <span className="font-medium text-foreground">Actions:</span> {r.corrective_actions}
                  </p>
                )}
              </div>
              <button onClick={() => handleDelete(r.id)} className="p-1 text-muted-foreground hover:text-destructive shrink-0">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── BMW month summary type ───────────────────────────────────────────────────

interface MonthSummary {
  month: string;   // "YYYY-MM"
  label: string;   // "Jan 2025"
  yellow: number;
  red: number;
  blue: number;
  white: number;
  total: number;
}

// ─── BMW Manifests Tab ────────────────────────────────────────────────────────

const BmwTab: React.FC<{ hospitalId: string }> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [manifests, setManifests] = useState<BmwManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ manifest_date: today, vendor: "", yellow_bag_kg: "", red_bag_kg: "", blue_bag_kg: "", white_bag_kg: "", route_sheet_url: "", remarks: "" });
  const [saving, setSaving] = useState(false);
  const [hospitalName, setHospitalName] = useState("Hospital");

  const load = useCallback(async () => {
    setLoading(true);
    const [manifestsRes, hospitalRes] = await Promise.all([
      (supabase as any).from("bmw_manifests")
        .select("*").eq("hospital_id", hospitalId)
        .order("manifest_date", { ascending: false }).limit(500),
      (supabase as any).from("hospitals").select("name").eq("id", hospitalId).maybeSingle(),
    ]);
    setManifests(manifestsRes.data || []);
    if (hospitalRes.data?.name) setHospitalName(hospitalRes.data.name);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.manifest_date) return;
    setSaving(true);
    const { error } = await (supabase as any).from("bmw_manifests").insert({
      hospital_id: hospitalId,
      manifest_date: form.manifest_date,
      vendor: form.vendor || null,
      yellow_bag_kg: parseFloat(form.yellow_bag_kg) || 0,
      red_bag_kg:    parseFloat(form.red_bag_kg) || 0,
      blue_bag_kg:   parseFloat(form.blue_bag_kg) || 0,
      white_bag_kg:  parseFloat(form.white_bag_kg) || 0,
      route_sheet_url: form.route_sheet_url || null,
      remarks: form.remarks || null,
    });
    if (error) toast({ title: "Failed to save manifest", description: error.message, variant: "destructive" });
    else { toast({ title: "BMW manifest saved" }); setShowAdd(false); setForm({ manifest_date: today, vendor: "", yellow_bag_kg: "", red_bag_kg: "", blue_bag_kg: "", white_bag_kg: "", route_sheet_url: "", remarks: "" }); load(); }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await (supabase as any).from("bmw_manifests").delete().eq("id", id);
    toast({ title: "Manifest deleted" });
    load();
  };

  const monthlyTotals = useMemo(() => {
    const monthStart = startOfMonth(new Date()).toISOString().split("T")[0];
    const monthEnd   = endOfMonth(new Date()).toISOString().split("T")[0];
    const thisMonth  = manifests.filter(m => m.manifest_date >= monthStart && m.manifest_date <= monthEnd);
    return BMW_COLORS.map(c => ({
      ...c,
      total: thisMonth.reduce((sum, m) => sum + (m[c.key as keyof BmwManifest] as number || 0), 0),
    }));
  }, [manifests]);

  const grandTotalKg = monthlyTotals.reduce((s, c) => s + c.total, 0);

  // 12-month aggregation for chart and print report
  const monthlySummary = useMemo<MonthSummary[]>(() => {
    const map: Record<string, MonthSummary> = {};
    for (const m of manifests) {
      const month = m.manifest_date.slice(0, 7);
      if (!map[month]) {
        map[month] = {
          month,
          label: format(parseISO(month + "-01"), "MMM yyyy"),
          yellow: 0, red: 0, blue: 0, white: 0, total: 0,
        };
      }
      const y = m.yellow_bag_kg || 0;
      const r = m.red_bag_kg    || 0;
      const b = m.blue_bag_kg   || 0;
      const w = m.white_bag_kg  || 0;
      map[month].yellow += y;
      map[month].red    += r;
      map[month].blue   += b;
      map[month].white  += w;
      map[month].total  += y + r + b + w;
    }
    return Object.values(map)
      .sort((a, b) => b.month.localeCompare(a.month))
      .slice(0, 12);
  }, [manifests]);

  const chartMax = Math.max(1, ...monthlySummary.map(m => m.total));

  const handlePrint = () => {
    if (!monthlySummary.length) {
      toast({ title: "No data to print", variant: "destructive" });
      return;
    }

    const chronoRows = [...monthlySummary].sort((a, b) => a.month.localeCompare(b.month));
    const totY = chronoRows.reduce((s, m) => s + m.yellow, 0);
    const totR = chronoRows.reduce((s, m) => s + m.red,    0);
    const totB = chronoRows.reduce((s, m) => s + m.blue,   0);
    const totW = chronoRows.reduce((s, m) => s + m.white,  0);
    const totG = chronoRows.reduce((s, m) => s + m.total,  0);

    const printedOn  = format(new Date(), "dd MMMM yyyy, HH:mm");
    const periodFrom = chronoRows[0]?.label || "—";
    const periodTo   = chronoRows[chronoRows.length - 1]?.label || "—";
    const maxBar = Math.max(1, ...chronoRows.map(m => m.total));

    const tableRows = chronoRows.map(m => `
      <tr>
        <td>${m.label}</td>
        <td class="num">${m.yellow.toFixed(2)}</td>
        <td class="num">${m.red.toFixed(2)}</td>
        <td class="num">${m.blue.toFixed(2)}</td>
        <td class="num">${m.white.toFixed(2)}</td>
        <td class="num bold">${m.total.toFixed(2)}</td>
      </tr>`).join("");

    const chartRows = chronoRows.map(m => {
      const bw = Math.round((m.total / maxBar) * 280);
      const yw = m.total ? Math.round((m.yellow / m.total) * bw) : 0;
      const rw = m.total ? Math.round((m.red    / m.total) * bw) : 0;
      const bv = m.total ? Math.round((m.blue   / m.total) * bw) : 0;
      const ww = Math.max(0, bw - yw - rw - bv);
      return `
      <tr>
        <td class="cl">${m.label}</td>
        <td>
          <div style="display:flex;height:14px;width:${bw}px;border-radius:2px;overflow:hidden;background:#f1f5f9;">
            ${yw > 0 ? `<div style="width:${yw}px;background:#facc15;"></div>` : ""}
            ${rw > 0 ? `<div style="width:${rw}px;background:#f87171;"></div>` : ""}
            ${bv > 0 ? `<div style="width:${bv}px;background:#60a5fa;"></div>` : ""}
            ${ww > 0 && m.white > 0 ? `<div style="width:${ww}px;background:#cbd5e1;border-right:1px solid #94a3b8;"></div>` : ""}
          </div>
        </td>
        <td class="ct">${m.total.toFixed(2)} kg</td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>BMW Monthly Report — ${hospitalName}</title>
<style>
  @page { size: A4 portrait; margin: 18mm 15mm 18mm 15mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; }
  .hdr { text-align: center; border-bottom: 2px solid #166534; padding-bottom: 10px; margin-bottom: 14px; }
  .hdr h1 { font-size: 17px; font-weight: 700; margin-bottom: 3px; }
  .hdr h2 { font-size: 13px; font-weight: 600; color: #166534; margin-bottom: 4px; }
  .hdr p  { font-size: 10px; color: #555; }
  .sec { font-size: 11px; font-weight: 700; background: #f0fdf4; border-left: 3px solid #16a34a;
         padding: 5px 8px; margin: 14px 0 6px; color: #14532d; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  th { background: #1f2937; color: #fff; font-size: 10px; padding: 5px 7px; text-align: left; }
  td { padding: 4px 7px; border-bottom: 1px solid #e5e7eb; font-size: 10px; vertical-align: middle; }
  tr:nth-child(even) td { background: #f9fafb; }
  .num  { text-align: right; font-variant-numeric: tabular-nums; }
  .bold { font-weight: 700; }
  .foot td { font-weight: 700; background: #f3f4f6; border-top: 2px solid #374151; }
  .cl   { width: 64px; white-space: nowrap; color: #374151; padding-right: 8px; }
  .ct   { padding-left: 8px; white-space: nowrap; font-weight: 600; font-size: 10px; }
  .legend { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 8px; }
  .li   { display: flex; align-items: center; gap: 4px; font-size: 10px; }
  .dot  { width: 10px; height: 10px; border-radius: 2px; display: inline-block; flex-shrink: 0; }
  .sig-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 6px; }
  .sig-box  { border-top: 1px solid #374151; padding-top: 6px; }
  .sig-name { font-size: 11px; font-weight: 700; }
  .sig-role { font-size: 9px; color: #6b7280; margin-bottom: 30px; }
  .sig-line { font-size: 9px; color: #6b7280; border-top: 1px dashed #9ca3af; padding-top: 3px; margin-top: 4px; }
  .footer   { font-size: 8px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 6px; margin-top: 20px; }
</style>
</head>
<body>
  <div class="hdr">
    <h1>${hospitalName}</h1>
    <h2>Biomedical Waste Management — Monthly Report</h2>
    <p>Period: <strong>${periodFrom}</strong> to <strong>${periodTo}</strong> &nbsp;|&nbsp; Generated: ${printedOn}</p>
    <p>Biomedical Waste Management Rules 2016 (CPCB / SPCB) Compliance Evidence</p>
  </div>

  <div class="sec">Monthly Waste Collection Summary</div>
  <table>
    <thead>
      <tr>
        <th>Month</th>
        <th style="text-align:right">Yellow Bag (kg)<br><span style="font-weight:400;font-size:9px">Infectious / Pathological</span></th>
        <th style="text-align:right">Red Bag (kg)<br><span style="font-weight:400;font-size:9px">Contaminated / Recyclable</span></th>
        <th style="text-align:right">Blue Bag (kg)<br><span style="font-weight:400;font-size:9px">Glass Waste</span></th>
        <th style="text-align:right">White Bag (kg)<br><span style="font-weight:400;font-size:9px">Sharps / Metallic</span></th>
        <th style="text-align:right">Total (kg)</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
    <tfoot>
      <tr class="foot">
        <td><strong>GRAND TOTAL</strong></td>
        <td class="num">${totY.toFixed(2)}</td>
        <td class="num">${totR.toFixed(2)}</td>
        <td class="num">${totB.toFixed(2)}</td>
        <td class="num">${totW.toFixed(2)}</td>
        <td class="num bold">${totG.toFixed(2)}</td>
      </tr>
    </tfoot>
  </table>

  <div class="sec">Monthly Trend — Stacked Bar Chart</div>
  <div class="legend">
    <div class="li"><span class="dot" style="background:#facc15;"></span> Yellow — Infectious / Pathological</div>
    <div class="li"><span class="dot" style="background:#f87171;"></span> Red — Contaminated / Recyclable</div>
    <div class="li"><span class="dot" style="background:#60a5fa;"></span> Blue — Glass Waste</div>
    <div class="li"><span class="dot" style="background:#cbd5e1;border:1px solid #94a3b8;"></span> White — Sharps / Metallic</div>
  </div>
  <table>
    <tbody>${chartRows}</tbody>
  </table>

  <div class="sec">Authorized Signatures</div>
  <div class="sig-grid">
    <div class="sig-box">
      <div class="sig-name">FMS In-Charge / Engineering Head</div>
      <div class="sig-role">Facility Management Services</div>
      <div class="sig-line">Signature &amp; Date: ________________________</div>
    </div>
    <div class="sig-box">
      <div class="sig-name">BMW Nodal Officer</div>
      <div class="sig-role">Biomedical Waste Coordinator</div>
      <div class="sig-line">Signature &amp; Date: ________________________</div>
    </div>
    <div class="sig-box">
      <div class="sig-name">Medical Superintendent / CEO</div>
      <div class="sig-role">Authorised Signatory</div>
      <div class="sig-line">Signature &amp; Date: ________________________</div>
    </div>
  </div>

  <div class="footer">
    NABH FMS Chapter Evidence &nbsp;|&nbsp; BMW Rules 2016 (Ministry of Environment, Forest &amp; Climate Change) &nbsp;|&nbsp;
    System-generated by Aumrti HMS. Authorised signatures confirm authenticity. Retain for accreditation records.
  </div>
</body>
</html>`;

    const win = window.open("", "_blank", "width=900,height=720");
    if (!win) {
      toast({ title: "Popup blocked", description: "Allow popups to generate the print report", variant: "destructive" });
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 500);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <SectionHeader icon={FlaskConical} title="BMW Manifests">
        <Button
          size="sm" variant="outline"
          onClick={handlePrint}
          disabled={!monthlySummary.length}
          className="h-7 text-xs gap-1 ml-auto"
          title="Print BMW Monthly Report"
        >
          <Printer className="h-3 w-3" /> Print Monthly Report
        </Button>
        <Button size="sm" onClick={() => setShowAdd(s => !s)} className="h-7 text-xs gap-1">
          <Plus className="h-3 w-3" /> Add Manifest
        </Button>
      </SectionHeader>

      {showAdd && (
        <div className="border-b p-4 bg-muted/40 space-y-3 shrink-0">
          <div className="grid grid-cols-3 gap-3">
            <div><FieldLabel>Date *</FieldLabel><Input type="date" value={form.manifest_date} onChange={e => setForm(f => ({ ...f, manifest_date: e.target.value }))} className="h-8 text-sm" /></div>
            <div><FieldLabel>Authorised Vendor</FieldLabel><Input value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} placeholder="CBWTF / vendor name" className="h-8 text-sm" /></div>
            <div><FieldLabel>Route Sheet URL</FieldLabel><Input value={form.route_sheet_url} onChange={e => setForm(f => ({ ...f, route_sheet_url: e.target.value }))} placeholder="https://…" className="h-8 text-sm" /></div>
            {BMW_COLORS.map(c => (
              <div key={c.key}>
                <FieldLabel><span className={cn("inline-block w-2 h-2 rounded-full mr-1", c.color)} />{c.label} Bag (kg) — {c.desc}</FieldLabel>
                <Input type="number" value={form[c.key as keyof typeof form]} onChange={e => setForm(f => ({ ...f, [c.key]: e.target.value }))}
                  placeholder="0.00" className="h-8 text-sm" min="0" step="0.01" />
              </div>
            ))}
            <div className="col-span-3"><FieldLabel>Remarks</FieldLabel><Input value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} placeholder="Optional notes" className="h-8 text-sm" /></div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving || !form.manifest_date} className="h-7 text-xs flex-1">
              {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />} Save Manifest
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)} className="h-7 text-xs">Cancel</Button>
          </div>
        </div>
      )}

      {/* This-month totals strip */}
      <div className="px-4 py-2.5 border-b bg-muted/30 shrink-0 flex items-center gap-4 flex-wrap">
        <span className="text-[11px] font-semibold text-muted-foreground shrink-0">
          This Month — {grandTotalKg.toFixed(2)} kg
        </span>
        {monthlyTotals.map(c => (
          <div key={c.key} className="flex items-center gap-1.5">
            <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", c.color)} />
            <span className="text-xs">
              <span className="font-medium">{c.total.toFixed(2)} kg</span>
              <span className="text-muted-foreground ml-1">{c.label}</span>
            </span>
          </div>
        ))}
      </div>

      {/* 12-Month trend chart */}
      {monthlySummary.length > 0 && (
        <div className="border-b bg-card shrink-0">
          <div className="px-4 py-2 border-b border-border/50 flex items-center justify-between">
            <p className="text-[11px] font-semibold text-foreground">
              Monthly Trend
            </p>
            <span className="text-[10px] text-muted-foreground">
              {monthlySummary.length} month{monthlySummary.length !== 1 ? "s" : ""} · all bag types
            </span>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 px-4 pt-2 pb-1 flex-wrap">
            {BMW_COLORS.map(c => (
              <div key={c.key} className="flex items-center gap-1">
                <span className={cn("w-2.5 h-2.5 rounded-sm shrink-0", c.color)} />
                <span className="text-[10px] text-muted-foreground">{c.label}</span>
              </div>
            ))}
          </div>

          {/* Bars */}
          <div className="px-4 pb-3 space-y-1.5 overflow-y-auto max-h-[260px]">
            {monthlySummary.map(m => (
              <div key={m.month} className="flex items-center gap-3">
                <span className="text-[11px] text-muted-foreground w-[62px] shrink-0 text-right tabular-nums">
                  {m.label}
                </span>
                <div className="flex-1 bg-muted/30 rounded h-4 overflow-hidden">
                  <div
                    className="h-full flex transition-all"
                    style={{ width: `${(m.total / chartMax) * 100}%` }}
                  >
                    {m.yellow > 0 && (
                      <div title={`Yellow: ${m.yellow.toFixed(2)} kg`}
                        style={{ width: `${(m.yellow / m.total) * 100}%` }}
                        className="bg-yellow-400 h-full" />
                    )}
                    {m.red > 0 && (
                      <div title={`Red: ${m.red.toFixed(2)} kg`}
                        style={{ width: `${(m.red / m.total) * 100}%` }}
                        className="bg-red-400 h-full" />
                    )}
                    {m.blue > 0 && (
                      <div title={`Blue: ${m.blue.toFixed(2)} kg`}
                        style={{ width: `${(m.blue / m.total) * 100}%` }}
                        className="bg-blue-400 h-full" />
                    )}
                    {m.white > 0 && (
                      <div title={`White: ${m.white.toFixed(2)} kg`}
                        style={{ width: `${(m.white / m.total) * 100}%` }}
                        className="bg-slate-300 h-full" />
                    )}
                  </div>
                </div>
                <span className="text-[11px] font-medium tabular-nums w-[60px] shrink-0 text-right">
                  {m.total.toFixed(1)} kg
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading manifests…</span></div>
        ) : manifests.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">No manifests recorded. Log daily BMW collections per CPCB/SPCB requirements.</p>
        ) : manifests.map(m => {
          const total = (m.yellow_bag_kg || 0) + (m.red_bag_kg || 0) + (m.blue_bag_kg || 0) + (m.white_bag_kg || 0);
          return (
            <div key={m.id} className="border rounded-lg px-3 py-2.5 flex items-center gap-3 bg-card">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{format(parseISO(m.manifest_date), "dd MMM yyyy")}</span>
                  {m.vendor && <span className="text-[11px] text-muted-foreground">{m.vendor}</span>}
                  <span className="text-[11px] font-medium text-foreground">{total.toFixed(2)} kg total</span>
                </div>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  {BMW_COLORS.map(c => {
                    const val = m[c.key as keyof BmwManifest] as number;
                    if (!val) return null;
                    return (
                      <span key={c.key} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <span className={cn("w-2 h-2 rounded-full shrink-0", c.color)} />
                        {val.toFixed(2)} kg
                      </span>
                    );
                  })}
                  {m.route_sheet_url && (
                    <a href={m.route_sheet_url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline">
                      <ExternalLink className="h-2.5 w-2.5" /> Route Sheet
                    </a>
                  )}
                </div>
                {m.remarks && <p className="text-[10px] text-muted-foreground italic mt-0.5">{m.remarks}</p>}
              </div>
              <button onClick={() => handleDelete(m.id)} className="p-1 text-muted-foreground hover:text-destructive shrink-0">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

const navTabs = [
  { id: "assets",       label: "Assets",            icon: Package },
  { id: "maintenance",  label: "Maintenance",        icon: Wrench },
  { id: "safety",       label: "Safety Rounds",      icon: ShieldAlert },
  { id: "bmw",          label: "BMW Manifests",      icon: FlaskConical },
  { id: "fire_safety",  label: "Fire Safety",        icon: Flame },
  { id: "medical_gas",  label: "Medical Gas",        icon: Wind },
  { id: "electrical",   label: "Electrical Safety",  icon: Zap },
];

const FMSDashboardPage: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const [activeTab, setActiveTab] = useState("assets");
  const [kpis, setKpis] = useState({ assets: 0, overdueMaintenace: 0, amcExpiring: 0, roundsThisMonth: 0, bmwThisMonth: 0 });

  useEffect(() => {
    if (!hospitalId) return;
    const load = async () => {
      const today = new Date().toISOString().split("T")[0];
      const in30Days = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
      const monthStart = startOfMonth(new Date()).toISOString().split("T")[0];

      const [assetsRes, overdueMaint, amcRes, roundsRes, bmwRes] = await Promise.all([
        (supabase as any).from("facility_assets").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("is_active", true),
        (supabase as any).from("facility_maintenance_logs").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).not("next_due_date", "is", null).lte("next_due_date", today),
        (supabase as any).from("facility_assets").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("is_active", true).not("amc_expiry", "is", null).lte("amc_expiry", in30Days),
        (supabase as any).from("safety_rounds").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).gte("round_date", monthStart),
        (supabase as any).from("bmw_manifests").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).gte("manifest_date", monthStart),
      ]);

      setKpis({
        assets: assetsRes.count || 0,
        overdueMaintenace: overdueMaint.count || 0,
        amcExpiring: amcRes.count || 0,
        roundsThisMonth: roundsRes.count || 0,
        bmwThisMonth: bmwRes.count || 0,
      });
    };
    load();
  }, [hospitalId, activeTab]);

  const renderContent = () => {
    if (!hospitalId) return null;
    switch (activeTab) {
      case "assets":      return <AssetsTab         hospitalId={hospitalId} />;
      case "maintenance": return <MaintenanceTab    hospitalId={hospitalId} />;
      case "safety":      return <SafetyRoundsTab   hospitalId={hospitalId} />;
      case "bmw":         return <BmwTab            hospitalId={hospitalId} />;
      case "fire_safety": return <FireSafetyTab     hospitalId={hospitalId} />;
      case "medical_gas": return <MedicalGasTab     hospitalId={hospitalId} />;
      case "electrical":  return <ElectricalSafetyTab hospitalId={hospitalId} />;
      default: return null;
    }
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div className="h-[52px] flex-shrink-0 bg-card border-b border-border flex items-center justify-between px-5">
        <span className="text-base font-bold text-foreground">Facility Management & Safety</span>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs px-3 py-1 rounded-full bg-primary/10 text-primary font-medium">
            🏢 {kpis.assets} Assets
          </span>
          {kpis.overdueMaintenace > 0 && (
            <span className="text-xs px-3 py-1 rounded-full bg-destructive/10 text-destructive font-medium">
              ⚠️ {kpis.overdueMaintenace} Maintenance Overdue
            </span>
          )}
          {kpis.amcExpiring > 0 && (
            <span className="text-xs px-3 py-1 rounded-full bg-amber-500/10 text-amber-600 font-medium">
              🔧 {kpis.amcExpiring} AMC Expiring
            </span>
          )}
          <span className="text-xs px-3 py-1 rounded-full bg-muted text-muted-foreground font-medium">
            🛡️ {kpis.roundsThisMonth} Rounds This Month
          </span>
          <span className="text-xs px-3 py-1 rounded-full bg-muted text-muted-foreground font-medium">
            🗑️ {kpis.bmwThisMonth} BMW Entries
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left nav */}
        <div className="w-[200px] bg-card border-r border-border flex flex-col">
          {navTabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "h-11 flex items-center gap-3 px-4 text-sm transition-colors text-left",
                  activeTab === tab.id
                    ? "bg-primary/10 text-primary font-semibold border-r-2 border-primary"
                    : "text-muted-foreground hover:bg-muted/50"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default FMSDashboardPage;

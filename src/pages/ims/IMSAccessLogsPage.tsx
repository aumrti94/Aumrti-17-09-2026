import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Shield, Loader2, Search, Download, RefreshCw, Filter, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── types ────────────────────────────────────────────────────────────────────

interface AccessLog {
  id: string;
  record_type: string;
  record_id: string | null;
  access_action: string;
  patient_id: string | null;
  accessed_by: string;
  created_at: string;
  // joined
  user_name?: string;
  patient_name?: string;
}

interface Filters {
  dateFrom: string;
  dateTo: string;
  user: string;
  recordType: string;
  patient: string;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const RECORD_TYPE_OPTIONS = [
  "OPD_Record", "IPD_Record", "MLC_Record", "OT_Record",
  "Lab_Report", "Radiology_Report", "Billing", "HR_File",
  "Consent_Form", "Blood_Transfusion", "Immunisation_Record",
];

const ACTION_COLOURS: Record<string, string> = {
  view:     "bg-blue-100 text-blue-700",
  print:    "bg-purple-100 text-purple-700",
  download: "bg-amber-100 text-amber-700",
  export:   "bg-green-100 text-green-700",
  share:    "bg-red-100 text-red-700",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function escCsv(v: string | null | undefined) {
  if (v == null) return "";
  const s = String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

// ─── component ────────────────────────────────────────────────────────────────

export default function IMSAccessLogsPage() {
  const navigate = useNavigate();
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();

  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);

  const [filters, setFilters] = useState<Filters>({
    dateFrom: thirtyDaysAgo,
    dateTo: today,
    user: "",
    recordType: "",
    patient: "",
  });
  const [pendingFilters, setPendingFilters] = useState<Filters>(filters);
  const [showFilters, setShowFilters] = useState(false);

  // ── load ────────────────────────────────────────────────────────────────────

  const load = useCallback(async (f: Filters, pg: number) => {
    if (!hospitalId) return;
    setLoading(true);
    try {
      // Base query with count
      let q = (supabase as any)
        .from("record_access_logs")
        .select("*", { count: "exact" })
        .eq("hospital_id", hospitalId)
        .gte("created_at", f.dateFrom + "T00:00:00")
        .lte("created_at", f.dateTo + "T23:59:59")
        .order("created_at", { ascending: false })
        .range(pg * PAGE_SIZE, pg * PAGE_SIZE + PAGE_SIZE - 1);

      if (f.recordType) q = q.eq("record_type", f.recordType);

      const { data: rawLogs, count, error } = await q;
      if (error) throw error;

      setTotal(count ?? 0);

      if (!rawLogs || rawLogs.length === 0) {
        setLogs([]);
        return;
      }

      // Resolve user names
      const userIds = [...new Set((rawLogs as AccessLog[]).map(l => l.accessed_by).filter(Boolean))];
      const { data: usersData } = await (supabase as any)
        .from("users")
        .select("id, full_name")
        .in("id", userIds);
      const userMap: Record<string, string> = {};
      (usersData ?? []).forEach((u: { id: string; full_name: string }) => {
        userMap[u.id] = u.full_name;
      });

      // Resolve patient names
      const patientIds = [...new Set((rawLogs as AccessLog[]).map(l => l.patient_id).filter(Boolean))];
      const patientMap: Record<string, string> = {};
      if (patientIds.length > 0) {
        const { data: pData } = await (supabase as any)
          .from("patients")
          .select("id, full_name")
          .in("id", patientIds);
        (pData ?? []).forEach((p: { id: string; full_name: string }) => {
          patientMap[p.id] = p.full_name;
        });
      }

      let enriched: AccessLog[] = (rawLogs as AccessLog[]).map(l => ({
        ...l,
        user_name: userMap[l.accessed_by] ?? l.accessed_by?.slice(0, 8) ?? "—",
        patient_name: l.patient_id ? (patientMap[l.patient_id] ?? l.patient_id.slice(0, 8)) : null,
      }));

      // Client-side filter: user name search
      if (f.user.trim()) {
        const u = f.user.toLowerCase();
        enriched = enriched.filter(l => (l.user_name ?? "").toLowerCase().includes(u));
      }
      // Client-side filter: patient name search
      if (f.patient.trim()) {
        const p = f.patient.toLowerCase();
        enriched = enriched.filter(l => (l.patient_name ?? "").toLowerCase().includes(p));
      }

      setLogs(enriched);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Error loading logs", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [hospitalId, toast]);

  useEffect(() => { load(filters, page); }, [load, filters, page]);

  // ── apply filters ───────────────────────────────────────────────────────────

  function applyFilters() {
    setFilters(pendingFilters);
    setPage(0);
    setShowFilters(false);
  }

  function resetFilters() {
    const def: Filters = { dateFrom: thirtyDaysAgo, dateTo: today, user: "", recordType: "", patient: "" };
    setPendingFilters(def);
    setFilters(def);
    setPage(0);
  }

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.user) n++;
    if (filters.recordType) n++;
    if (filters.patient) n++;
    if (filters.dateFrom !== thirtyDaysAgo || filters.dateTo !== today) n++;
    return n;
  }, [filters, thirtyDaysAgo, today]);

  // ── export CSV ──────────────────────────────────────────────────────────────

  async function exportCsv() {
    if (!hospitalId) return;
    setLoading(true);
    try {
      let q = (supabase as any)
        .from("record_access_logs")
        .select("*")
        .eq("hospital_id", hospitalId)
        .gte("created_at", filters.dateFrom + "T00:00:00")
        .lte("created_at", filters.dateTo + "T23:59:59")
        .order("created_at", { ascending: false })
        .limit(5000);

      if (filters.recordType) q = q.eq("record_type", filters.recordType);
      const { data: allLogs, error } = await q;
      if (error) throw error;

      // Resolve users
      const userIds = [...new Set((allLogs as AccessLog[]).map((l: AccessLog) => l.accessed_by).filter(Boolean))];
      const { data: usersData } = await (supabase as any).from("users").select("id, full_name").in("id", userIds);
      const userMap: Record<string, string> = {};
      (usersData ?? []).forEach((u: { id: string; full_name: string }) => { userMap[u.id] = u.full_name; });

      const rows: string[][] = [
        ["Timestamp", "User", "Action", "Record Type", "Record ID", "Patient ID"],
        ...(allLogs as AccessLog[]).map((l: AccessLog) => [
          new Date(l.created_at).toISOString(),
          userMap[l.accessed_by] ?? l.accessed_by ?? "",
          l.access_action ?? "",
          l.record_type ?? "",
          l.record_id ?? "",
          l.patient_id ?? "",
        ]),
      ];

      const csv = rows.map(r => r.map(escCsv).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `record_access_logs_${filters.dateFrom}_to_${filters.dateTo}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      toast({ title: "Exported", description: `${allLogs.length} records downloaded as CSV.` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Export failed", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 max-w-full">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <Shield className="h-5 w-5 text-blue-600" />
          <div>
            <h1 className="text-xl font-bold">Record Access Log</h1>
            <p className="text-xs text-muted-foreground">IMS NABH evidence — read-only audit trail of all record accesses</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => load(filters, page)} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-1", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setShowFilters(v => !v); }}>
            <Filter className="h-4 w-4 mr-1" />
            Filters
            {activeFilterCount > 0 && (
              <Badge className="ml-1.5 h-4 w-4 p-0 text-[10px] flex items-center justify-center bg-blue-600">
                {activeFilterCount}
              </Badge>
            )}
          </Button>
          <Button size="sm" onClick={exportCsv} disabled={loading || logs.length === 0}>
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="border rounded-lg p-4 bg-muted/30 flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">From</label>
            <Input
              type="date"
              className="h-8 w-36 text-sm"
              value={pendingFilters.dateFrom}
              onChange={e => setPendingFilters(p => ({ ...p, dateFrom: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">To</label>
            <Input
              type="date"
              className="h-8 w-36 text-sm"
              value={pendingFilters.dateTo}
              onChange={e => setPendingFilters(p => ({ ...p, dateTo: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Record Type</label>
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              value={pendingFilters.recordType}
              onChange={e => setPendingFilters(p => ({ ...p, recordType: e.target.value }))}
            >
              <option value="">All Types</option>
              {RECORD_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">User Name</label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="h-8 pl-7 w-36 text-sm"
                placeholder="Search user..."
                value={pendingFilters.user}
                onChange={e => setPendingFilters(p => ({ ...p, user: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Patient Name</label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="h-8 pl-7 w-36 text-sm"
                placeholder="Search patient..."
                value={pendingFilters.patient}
                onChange={e => setPendingFilters(p => ({ ...p, patient: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-auto">
            <Button size="sm" onClick={applyFilters}>Apply</Button>
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              <X className="h-3.5 w-3.5 mr-1" /> Reset
            </Button>
          </div>
        </div>
      )}

      {/* Active filter chips */}
      {activeFilterCount > 0 && !showFilters && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {(filters.dateFrom !== thirtyDaysAgo || filters.dateTo !== today) && (
            <span className="bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5">
              {filters.dateFrom} → {filters.dateTo}
            </span>
          )}
          {filters.recordType && (
            <span className="bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5">
              {filters.recordType}
            </span>
          )}
          {filters.user && (
            <span className="bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5">
              User: {filters.user}
            </span>
          )}
          {filters.patient && (
            <span className="bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5">
              Patient: {filters.patient}
            </span>
          )}
        </div>
      )}

      {/* Stats bar */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {loading ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Loading…</>
        ) : (
          <>
            <span className="font-medium text-foreground">{total.toLocaleString()}</span> total records
            {(logs.length < total) && <span>· showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)}</span>}
          </>
        )}
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b">
              <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Timestamp</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Who (User)</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Action</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Record Type</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Record ID</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Patient</th>
            </tr>
          </thead>
          <tbody>
            {!loading && logs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center text-muted-foreground">
                  No access logs found for this period.
                </td>
              </tr>
            )}
            {logs.map(log => (
              <tr key={log.id} className="border-b last:border-0 hover:bg-muted/20">
                <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-muted-foreground">
                  {fmtDate(log.created_at)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap font-medium">
                  {log.user_name ?? "—"}
                </td>
                <td className="px-3 py-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs capitalize border-0",
                      ACTION_COLOURS[log.access_action] ?? "bg-gray-100 text-gray-700"
                    )}
                  >
                    {log.access_action}
                  </Badge>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-xs">
                  {log.record_type?.replace(/_/g, " ") ?? "—"}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground max-w-[160px] truncate" title={log.record_id ?? ""}>
                  {log.record_id ? log.record_id.slice(0, 8) + "…" : "—"}
                </td>
                <td className="px-3 py-2 text-xs">
                  {log.patient_name ?? (log.patient_id ? log.patient_id.slice(0, 8) + "…" : "—")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {Math.ceil(total / PAGE_SIZE)}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline" size="sm"
              disabled={page === 0}
              onClick={() => setPage(p => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline" size="sm"
              disabled={(page + 1) * PAGE_SIZE >= total}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* NABH evidence note */}
      <div className="border border-blue-200 bg-blue-50 rounded-lg p-3 text-xs text-blue-800 flex gap-2">
        <Shield className="h-4 w-4 shrink-0 mt-0.5 text-blue-600" />
        <div>
          <span className="font-semibold">NABH IMS Evidence</span> — This log is automatically recorded by the system and cannot be edited.
          It satisfies NABH IMS standard requirements for access control and audit trail maintenance.
          Export CSV to attach as evidence during assessments.
        </div>
      </div>
    </div>
  );
}

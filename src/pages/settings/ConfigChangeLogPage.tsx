import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, ClipboardList, Loader2, RefreshCw, Download,
  Filter, X, ChevronDown, ChevronRight, Search,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── types ────────────────────────────────────────────────────────────────────

interface ChangeLog {
  id: string;
  config_area: string;
  item_id: string | null;
  changed_by: string;
  old_value: unknown;
  new_value: unknown;
  reason: string | null;
  changed_at: string;
  // joined
  user_name?: string;
}

interface Filters {
  dateFrom: string;
  dateTo: string;
  configArea: string;
  user: string;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

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

function toJsonStr(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (typeof val === "string") return val;
  return JSON.stringify(val, null, 2);
}

// Collapsed JSON cell with expand toggle
function JsonCell({ value, label }: { value: unknown; label: string }) {
  const [open, setOpen] = useState(false);
  const str = toJsonStr(value);
  if (str === "—") return <span className="text-muted-foreground text-xs">—</span>;

  const preview = str.length > 40 ? str.slice(0, 40).replace(/\n/g, " ") + "…" : str.replace(/\n/g, " ");

  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors group"
        title={`${open ? "Collapse" : "Expand"} ${label}`}
      >
        {open
          ? <ChevronDown className="h-3 w-3" />
          : <ChevronRight className="h-3 w-3" />}
        <span className={cn("font-mono", !open && "text-muted-foreground group-hover:text-blue-600")}>
          {open ? label : preview}
        </span>
      </button>
      {open && (
        <pre className="mt-1 p-2 bg-muted rounded text-[11px] font-mono whitespace-pre-wrap max-w-xs overflow-auto max-h-48 border">
          {str}
        </pre>
      )}
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export default function ConfigChangeLogPage() {
  const navigate = useNavigate();
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();

  const [logs, setLogs] = useState<ChangeLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [configAreas, setConfigAreas] = useState<string[]>([]);

  const today = new Date().toISOString().slice(0, 10);
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);

  const [filters, setFilters] = useState<Filters>({
    dateFrom: ninetyDaysAgo,
    dateTo: today,
    configArea: "",
    user: "",
  });
  const [pendingFilters, setPendingFilters] = useState<Filters>(filters);
  const [showFilters, setShowFilters] = useState(false);

  // ── load ────────────────────────────────────────────────────────────────────

  const load = useCallback(async (f: Filters, pg: number) => {
    if (!hospitalId) return;
    setLoading(true);
    try {
      let q = (supabase as any)
        .from("config_change_logs")
        .select("*", { count: "exact" })
        .eq("hospital_id", hospitalId)
        .gte("changed_at", f.dateFrom + "T00:00:00")
        .lte("changed_at", f.dateTo + "T23:59:59")
        .order("changed_at", { ascending: false })
        .range(pg * PAGE_SIZE, pg * PAGE_SIZE + PAGE_SIZE - 1);

      if (f.configArea) q = q.eq("config_area", f.configArea);

      const { data: rawLogs, count, error } = await q;
      if (error) throw error;

      setTotal(count ?? 0);

      // Collect distinct config areas for filter dropdown
      if (pg === 0 && !f.configArea) {
        const { data: areas } = await (supabase as any)
          .from("config_change_logs")
          .select("config_area")
          .eq("hospital_id", hospitalId)
          .limit(200);
        const unique = [...new Set((areas ?? []).map((a: { config_area: string }) => a.config_area))].sort() as string[];
        setConfigAreas(unique);
      }

      if (!rawLogs || rawLogs.length === 0) {
        setLogs([]);
        return;
      }

      // Resolve user names
      const userIds = [...new Set((rawLogs as ChangeLog[]).map(l => l.changed_by).filter(Boolean))];
      const { data: usersData } = await (supabase as any)
        .from("users")
        .select("id, full_name")
        .in("id", userIds);
      const userMap: Record<string, string> = {};
      (usersData ?? []).forEach((u: { id: string; full_name: string }) => {
        userMap[u.id] = u.full_name;
      });

      let enriched: ChangeLog[] = (rawLogs as ChangeLog[]).map(l => ({
        ...l,
        user_name: userMap[l.changed_by] ?? l.changed_by?.slice(0, 8) ?? "—",
      }));

      // Client-side user name filter
      if (f.user.trim()) {
        const u = f.user.toLowerCase();
        enriched = enriched.filter(l => (l.user_name ?? "").toLowerCase().includes(u));
      }

      setLogs(enriched);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Error loading change log", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [hospitalId, toast]);

  useEffect(() => { load(filters, page); }, [load, filters, page]);

  // ── filter helpers ──────────────────────────────────────────────────────────

  function applyFilters() {
    setFilters(pendingFilters);
    setPage(0);
    setShowFilters(false);
  }

  function resetFilters() {
    const def: Filters = { dateFrom: ninetyDaysAgo, dateTo: today, configArea: "", user: "" };
    setPendingFilters(def);
    setFilters(def);
    setPage(0);
  }

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.configArea) n++;
    if (filters.user) n++;
    if (filters.dateFrom !== ninetyDaysAgo || filters.dateTo !== today) n++;
    return n;
  }, [filters, ninetyDaysAgo, today]);

  // ── export CSV ──────────────────────────────────────────────────────────────

  async function exportCsv() {
    if (!hospitalId) return;
    setLoading(true);
    try {
      let q = (supabase as any)
        .from("config_change_logs")
        .select("*")
        .eq("hospital_id", hospitalId)
        .gte("changed_at", filters.dateFrom + "T00:00:00")
        .lte("changed_at", filters.dateTo + "T23:59:59")
        .order("changed_at", { ascending: false })
        .limit(5000);

      if (filters.configArea) q = q.eq("config_area", filters.configArea);

      const { data: allLogs, error } = await q;
      if (error) throw error;

      const userIds = [...new Set((allLogs as ChangeLog[]).map((l: ChangeLog) => l.changed_by).filter(Boolean))];
      const { data: usersData } = await (supabase as any).from("users").select("id, full_name").in("id", userIds);
      const userMap: Record<string, string> = {};
      (usersData ?? []).forEach((u: { id: string; full_name: string }) => { userMap[u.id] = u.full_name; });

      const rows: string[][] = [
        ["Timestamp", "Config Area", "Item ID", "Changed By", "Reason", "Old Value", "New Value"],
        ...(allLogs as ChangeLog[]).map((l: ChangeLog) => [
          new Date(l.changed_at).toISOString(),
          l.config_area ?? "",
          l.item_id ?? "",
          userMap[l.changed_by] ?? l.changed_by ?? "",
          l.reason ?? "",
          toJsonStr(l.old_value),
          toJsonStr(l.new_value),
        ]),
      ];

      const csv = rows.map(r => r.map(escCsv).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `config_change_log_${filters.dateFrom}_to_${filters.dateTo}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      toast({ title: "Exported", description: `${allLogs.length} records downloaded.` });
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
          <Button variant="ghost" size="sm" onClick={() => navigate("/settings")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Settings
          </Button>
          <ClipboardList className="h-5 w-5 text-indigo-600" />
          <div>
            <h1 className="text-xl font-bold">Configuration Change Log</h1>
            <p className="text-xs text-muted-foreground">IMS NABH evidence — read-only audit trail of all configuration changes</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => load(filters, page)} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-1", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowFilters(v => !v)}>
            <Filter className="h-4 w-4 mr-1" />
            Filters
            {activeFilterCount > 0 && (
              <Badge className="ml-1.5 h-4 w-4 p-0 text-[10px] flex items-center justify-center bg-indigo-600">
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
            <label className="text-xs font-medium text-muted-foreground">Config Area</label>
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-sm min-w-[160px]"
              value={pendingFilters.configArea}
              onChange={e => setPendingFilters(p => ({ ...p, configArea: e.target.value }))}
            >
              <option value="">All Areas</option>
              {configAreas.map(a => <option key={a} value={a}>{a.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Changed By</label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="h-8 pl-7 w-36 text-sm"
                placeholder="Search user…"
                value={pendingFilters.user}
                onChange={e => setPendingFilters(p => ({ ...p, user: e.target.value }))}
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
          {(filters.dateFrom !== ninetyDaysAgo || filters.dateTo !== today) && (
            <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5">
              {filters.dateFrom} → {filters.dateTo}
            </span>
          )}
          {filters.configArea && (
            <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5">
              {filters.configArea.replace(/_/g, " ")}
            </span>
          )}
          {filters.user && (
            <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-2 py-0.5">
              User: {filters.user}
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
            <span className="font-medium text-foreground">{total.toLocaleString()}</span> total changes
            {logs.length < total && (
              <span>· showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)}</span>
            )}
          </>
        )}
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b">
              <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Date / Time</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Config Area</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Item</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Changed By</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Reason</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Old Value</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">New Value</th>
            </tr>
          </thead>
          <tbody>
            {!loading && logs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-12 text-center text-muted-foreground">
                  No configuration changes found for this period.
                </td>
              </tr>
            )}
            {logs.map(log => (
              <tr key={log.id} className="border-b last:border-0 hover:bg-muted/20 align-top">
                <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-muted-foreground">
                  {fmtDate(log.changed_at)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <Badge variant="outline" className="text-xs bg-indigo-50 text-indigo-700 border-indigo-200">
                    {log.config_area?.replace(/_/g, " ") ?? "—"}
                  </Badge>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground max-w-[140px] truncate" title={log.item_id ?? ""}>
                  {log.item_id ? log.item_id.slice(0, 12) + (log.item_id.length > 12 ? "…" : "") : "—"}
                </td>
                <td className="px-3 py-2 whitespace-nowrap font-medium text-sm">
                  {log.user_name ?? "—"}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground max-w-[180px]">
                  {log.reason ?? <span className="italic">No reason given</span>}
                </td>
                <td className="px-3 py-2 max-w-[200px]">
                  <JsonCell value={log.old_value} label="Old Value" />
                </td>
                <td className="px-3 py-2 max-w-[200px]">
                  <JsonCell value={log.new_value} label="New Value" />
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
      <div className="border border-indigo-200 bg-indigo-50 rounded-lg p-3 text-xs text-indigo-800 flex gap-2">
        <ClipboardList className="h-4 w-4 shrink-0 mt-0.5 text-indigo-600" />
        <div>
          <span className="font-semibold">NABH IMS Evidence</span> — This log is system-generated and tamper-proof.
          It demonstrates controlled change management per NABH IMS standards.
          Present the exported CSV during assessments to show traceability of all configuration changes.
        </div>
      </div>
    </div>
  );
}

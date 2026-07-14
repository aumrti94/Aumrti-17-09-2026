import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Search, RefreshCw, ArrowUpDown } from "lucide-react";
import { PLATFORM_STATUS_PILL, computeHealthScore } from "@/lib/platform-utils";
import { format } from "date-fns";

interface HospRow {
  id: string; name: string; state: string | null; beds_count: number;
  created_at: string; plan_name: string; status: string; plan_id: string | null;
  hasRecentOpd: boolean; hasRecentBilling: boolean; deletedAt: string | null;
}

const STATUS_PILL = PLATFORM_STATUS_PILL;

// computeHealthScore imported from @/lib/platform-utils

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? "text-emerald-600 bg-emerald-500/10 border-emerald-500/30"
    : score >= 40 ? "text-amber-600 bg-amber-500/10 border-amber-500/30"
    : "text-red-500 bg-red-500/10 border-red-500/30";
  const label = score >= 70 ? "Healthy" : score >= 40 ? "Monitor" : "At Risk";
  return (
    <div className="flex items-center gap-2">
      <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-full border ${color}`}>
        {score}
      </span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

// ─── Data Fetcher ─────────────────────────────────────────────────────────────
async function fetchHospitals(): Promise<HospRow[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const [hResult, sResult, activeResult] = await Promise.all([
    (supabase as any).from("hospitals")
      .select("id, name, state, beds_count, created_at, deleted_at")
      .eq("is_active", true)
      .order("name"),
    (supabase as any).from("hospital_subscriptions")
      .select("hospital_id, status, plan_id, subscription_plans(name)"),
    (supabase as any).rpc("platform_active_hospitals", { since: thirtyDaysAgo }),
  ]);

  const subs = new Map((sResult.data || []).map((s: any) => [s.hospital_id, s]));
  const activeList = activeResult.data || [];
  const activeOpd  = new Set(activeList.filter((r: any) => r.has_opd).map((r: any) => r.hospital_id));
  const activeBill = new Set(activeList.filter((r: any) => r.has_billing).map((r: any) => r.hospital_id));

  return (hResult.data || []).map((h: any) => {
    const sub = subs.get(h.id) as any;
    return {
      id: h.id, name: h.name, state: h.state,
      beds_count: h.beds_count, created_at: h.created_at,
      plan_name: sub?.subscription_plans?.name || "—",
      status: sub?.status || "no_subscription",
      plan_id: sub?.plan_id || null,
      hasRecentOpd:     activeOpd.has(h.id),
      hasRecentBilling: activeBill.has(h.id),
      deletedAt: h.deleted_at || null,
    };
  });
}

type SortKey = "name" | "score" | "joined" | "beds";

export default function HospitalsListPage() {
  const navigate = useNavigate();
  const [search, setSearch]         = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortKey, setSortKey]       = useState<SortKey>("score");
  const [sortAsc, setSortAsc]       = useState(true);

  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ["platform-hospitals"],
    queryFn: fetchHospitals,
    staleTime: 60_000,
  });

  const withScores = useMemo(
    () => data.map((h) => ({ ...h, score: computeHealthScore(h) })),
    [data],
  );

  const filtered = useMemo(() => {
    let rows = withScores.filter((h) => {
      const matchSearch = h.name.toLowerCase().includes(search.toLowerCase()) ||
        (h.state || "").toLowerCase().includes(search.toLowerCase());
      const matchStatus = filterStatus === "all" || h.status === filterStatus;
      return matchSearch && matchStatus;
    });

    rows = [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name")   cmp = a.name.localeCompare(b.name);
      if (sortKey === "score")  cmp = a.score - b.score;
      if (sortKey === "joined") cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sortKey === "beds")   cmp = a.beds_count - b.beds_count;
      return sortAsc ? cmp : -cmp;
    });

    return rows;
  }, [withScores, search, filterStatus, sortKey, sortAsc]);

  const atRiskCount  = withScores.filter((h) => computeHealthScore(h) < 40).length;
  const monitorCount = withScores.filter((h) => { const s = computeHealthScore(h); return s >= 40 && s < 70; }).length;
  const healthyCount = withScores.filter((h) => computeHealthScore(h) >= 70).length;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(key === "score" ? true : false); }
  };

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <button
      onClick={() => toggleSort(k)}
      className={`flex items-center gap-1 transition-colors ${sortKey === k ? "text-blue-600" : "text-muted-foreground hover:text-foreground"}`}
    >
      {label}
      {sortKey === k && <ArrowUpDown size={10} />}
    </button>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0">
        <h1 className="text-[15px] font-semibold text-foreground">Hospitals ({data.length})</h1>
        <div className="flex items-center gap-4">
          {/* Health summary pills */}
          {!isLoading && data.length > 0 && (
            <div className="flex items-center gap-3 text-[11px]">
              <span className="text-emerald-600">{healthyCount} healthy</span>
              <span className="text-amber-600">{monitorCount} monitor</span>
              {atRiskCount > 0 && <span className="text-red-500 font-semibold">{atRiskCount} at risk</span>}
            </div>
          )}
          <button onClick={() => refetch()} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="p-5 border-b border-border flex items-center gap-3 shrink-0">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search hospitals…"
            className="w-full h-8 pl-8 pr-3 text-xs bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="trial">Trial</option>
          <option value="suspended">Suspended</option>
          <option value="past_due">Past Due</option>
          <option value="no_subscription">No Plan</option>
        </select>
        <select
          value={`${sortKey}-${sortAsc}`}
          onChange={(e) => {
            const [k, asc] = e.target.value.split("-");
            setSortKey(k as SortKey);
            setSortAsc(asc === "true");
          }}
          className="h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary"
        >
          <option value="score-true">Sort: At Risk First</option>
          <option value="score-false">Sort: Healthiest First</option>
          <option value="name-false">Sort: Name A→Z</option>
          <option value="joined-false">Sort: Newest First</option>
          <option value="beds-false">Sort: Largest First</option>
        </select>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="text-[10px] uppercase font-bold text-muted-foreground border-b border-border">
              <th className="px-5 py-3 text-left"><SortBtn k="name" label="Hospital" /></th>
              <th className="px-5 py-3 text-left">State</th>
              <th className="px-5 py-3 text-left"><SortBtn k="beds" label="Beds" /></th>
              <th className="px-5 py-3 text-left">Plan</th>
              <th className="px-5 py-3 text-left">Status</th>
              <th className="px-5 py-3 text-left"><SortBtn k="score" label="Health Score" /></th>
              <th className="px-5 py-3 text-left">Activity (30d)</th>
              <th className="px-5 py-3 text-left"><SortBtn k="joined" label="Joined" /></th>
              <th className="px-5 py-3 text-left"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={9} className="px-5 py-12 text-center text-xs text-muted-foreground">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className="px-5 py-12 text-center text-xs text-muted-foreground">No hospitals found</td></tr>
            ) : filtered.map((h) => (
              <tr key={h.id} className="border-t border-border hover:bg-muted/40 transition-colors">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground">{h.name}</span>
                    {h.deletedAt && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-600 border border-red-500/30 whitespace-nowrap">
                        Pending Deletion
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-5 py-3 text-xs text-muted-foreground">{h.state || "—"}</td>
                <td className="px-5 py-3 text-xs text-muted-foreground font-mono">{h.beds_count}</td>
                <td className="px-5 py-3 text-xs text-foreground/80">{h.plan_name}</td>
                <td className="px-5 py-3">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_PILL[h.status] || STATUS_PILL.no_subscription}`}>
                    {h.status.replace("_", " ")}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <ScoreBadge score={h.score} />
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${h.hasRecentOpd ? "bg-emerald-500/20 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
                      OPD
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${h.hasRecentBilling ? "bg-emerald-500/20 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
                      Billing
                    </span>
                  </div>
                </td>
                <td className="px-5 py-3 text-xs text-muted-foreground">
                  {format(new Date(h.created_at), "dd MMM yyyy")}
                </td>
                <td className="px-5 py-3">
                  <button
                    onClick={() => navigate(`/platform/hospitals/${h.id}`)}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
                  >
                    Manage →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

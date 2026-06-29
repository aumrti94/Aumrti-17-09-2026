import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, Bed, TrendingUp, AlertTriangle, IndianRupee, Activity, Maximize2, Minimize2, RefreshCw, ChevronLeft, ChevronRight, ScanLine, Bot, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface HospitalKPIs {
  id: string;
  name: string;
  state: string | null;
  beds_count: number;
  group_tag: string | null;
  opdToday: number;
  admittedNow: number;
  occupancyPct: number;
  revenueToday: number;
  pendingClaims: number;
  criticalAlerts: number;
  labPendingToday: number;
  dischargesToday: number;
  leakageAmount: number;
  leakageItems: number;
  fetchedAt: number;
}

const fmt = (n: number) => `₹${(n / 100000).toFixed(1)}L`;
const pct = (v: number, total: number) => total > 0 ? Math.round((v / total) * 100) : 0;

const KpiBox: React.FC<{ label: string; value: string | number; sub?: string; alert?: boolean; icon: React.ReactNode }> = ({ label, value, sub, alert, icon }) => (
  <div className={`flex items-start gap-2.5 p-3 rounded-xl border ${alert ? "border-red-300 bg-red-50 dark:bg-red-950/20" : "border-border bg-card"}`}>
    <div className={`p-1.5 rounded-lg ${alert ? "bg-red-100 dark:bg-red-900/30" : "bg-primary/10"}`}>
      {icon}
    </div>
    <div className="min-w-0">
      <p className={`text-lg font-bold font-mono leading-none ${alert ? "text-red-700 dark:text-red-400" : "text-foreground"}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
      {sub && <p className="text-[9px] text-muted-foreground">{sub}</p>}
    </div>
  </div>
);

const CEOBoardPage: React.FC = () => {
  const { hospitalId, role } = useHospitalId();
  const [hospitals, setHospitals] = useState<HospitalKPIs[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tvMode, setTvMode] = useState(false);
  const [tvIndex, setTvIndex] = useState(0);
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [digestOpen, setDigestOpen] = useState(false);
  const [digestText, setDigestText] = useState<string | null>(null);
  const [digestLoading, setDigestLoading] = useState(false);
  const tvTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRefresh = useRef(new Date());

  const fetchKPIs = useCallback(async (hospitalList: { id: string; name: string; state: string | null; beds_count: number }[]) => {
    const today = new Date().toISOString().split("T")[0];
    const startOfToday = today + "T00:00:00";
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    const results: HospitalKPIs[] = await Promise.all(
      hospitalList.map(async (h) => {
        const [opd, admitted, billsToday, claims, labPending, discharges, leakage] = await Promise.all([
          supabase.from("opd_tokens").select("id", { count: "exact", head: true })
            .eq("hospital_id", h.id).gte("created_at", startOfToday),
          supabase.from("admissions").select("id", { count: "exact", head: true })
            .eq("hospital_id", h.id).eq("status", "admitted"),
          supabase.from("bills").select("paid_amount")
            .eq("hospital_id", h.id).gte("bill_date", today)
            .in("payment_status", ["paid", "partial"]),
          supabase.from("insurance_claims").select("id", { count: "exact", head: true })
            .eq("hospital_id", h.id).in("status", ["submitted", "under_review"]),
          supabase.from("lab_orders").select("id", { count: "exact", head: true })
            .eq("hospital_id", h.id).eq("order_date", today).in("status", ["ordered", "sample_collected", "in_process"]),
          supabase.from("admissions").select("id", { count: "exact", head: true })
            .eq("hospital_id", h.id).eq("status", "discharged").gte("discharged_at", startOfToday),
          (supabase as any).from("leakage_reports")
            .select("total_items, estimated_amount")
            .eq("hospital_id", h.id)
            .eq("report_date", yesterdayStr)
            .maybeSingle(),
        ]);

        const revenueToday = (billsToday.data || []).reduce((s: number, b: any) => s + Number(b.paid_amount || 0), 0);
        const admittedCount = admitted.count || 0;

        return {
          id: h.id,
          name: h.name,
          state: h.state,
          beds_count: h.beds_count,
          group_tag: (h as any).group_tag || null,
          opdToday: opd.count || 0,
          admittedNow: admittedCount,
          occupancyPct: pct(admittedCount, h.beds_count),
          revenueToday,
          pendingClaims: claims.count || 0,
          criticalAlerts: (labPending.count || 0) > 20 ? 1 : 0,
          labPendingToday: labPending.count || 0,
          dischargesToday: discharges.count || 0,
          leakageAmount: Number(leakage.data?.estimated_amount || 0),
          leakageItems: Number(leakage.data?.total_items || 0),
          fetchedAt: Date.now(),
        };
      })
    );
    return results;
  }, []);

  const generateDigest = useCallback(async () => {
    if (!hospitalId) return;
    setDigestLoading(true);
    try {
      const today = format(new Date(), "yyyy-MM-dd");
      const { data: existing } = await (supabase as any)
        .from("ai_digests").select("digest_text")
        .eq("hospital_id", hospitalId).eq("digest_date", today).maybeSingle();
      if (existing?.digest_text) { setDigestText(existing.digest_text); return; }

      const { data: hospData } = await supabase.from("hospitals").select("name").eq("id", hospitalId).maybeSingle();
      const snapshot = {
        opd_patients: hospitals.reduce((s, h) => s + h.opdToday, 0),
        revenue_today: hospitals.reduce((s, h) => s + h.revenueToday, 0),
        bed_occupancy_pct: pct(hospitals.reduce((s, h) => s + h.admittedNow, 0), hospitals.reduce((s, h) => s + h.beds_count, 0)),
        occupied_beds: hospitals.reduce((s, h) => s + h.admittedNow, 0),
        total_beds: hospitals.reduce((s, h) => s + h.beds_count, 0),
        lab_pending: hospitals.reduce((s, h) => s + h.labPendingToday, 0),
        critical_alerts: hospitals.reduce((s, h) => s + h.criticalAlerts, 0),
      };
      const { data: fnData, error } = await supabase.functions.invoke("ai-executive-digest", {
        body: { hospital_name: (hospData as any)?.name || "Hospital", date: today, snapshot, anomalies: [] },
      });
      if (error) throw error;
      const text = fnData?.digest_text;
      if (!text) throw new Error("No digest returned");
      await (supabase as any).from("ai_digests").upsert(
        { hospital_id: hospitalId, digest_date: today, digest_text: text, kpi_snapshot: snapshot, anomalies: [], generated_at: new Date().toISOString() },
        { onConflict: "hospital_id,digest_date" }
      );
      setDigestText(text);
      toast.success("AI Digest generated");
    } catch (e: any) {
      toast.error(e?.message || "Failed to generate digest");
    } finally {
      setDigestLoading(false);
    }
  }, [hospitalId, hospitals]);

  const load = useCallback(async () => {
    if (!hospitalId) return;

    let hospitalList: { id: string; name: string; state: string | null; beds_count: number }[] = [];

    if (role === "super_admin") {
      let q = supabase.from("hospitals").select("id, name, state, beds_count, group_tag").eq("is_active", true).order("name");
      if (groupFilter !== "all") q = q.eq("group_tag" as any, groupFilter);
      const { data } = await q;
      hospitalList = (data || []) as typeof hospitalList;
    } else {
      const { data } = await supabase.from("hospitals").select("id, name, state, beds_count").eq("id", hospitalId).limit(1);
      if (data && data[0]) {
        hospitalList = [data[0] as { id: string; name: string; state: string | null; beds_count: number }];
      }
    }

    if (hospitalList.length === 0) {
      setLoading(false);
      return;
    }

    const kpis = await fetchKPIs(hospitalList);
    setHospitals(kpis);
    lastRefresh.current = new Date();
    setLoading(false);
    setRefreshing(false);
  }, [fetchKPIs, hospitalId, role]);

  useEffect(() => {
    if (hospitalId && role) load();
  }, [load, hospitalId, role, groupFilter]);

  // Auto-refresh every 2 minutes
  useEffect(() => {
    const timer = setInterval(() => {
      setRefreshing(true);
      load();
    }, 120000);
    return () => clearInterval(timer);
  }, [load]);

  // TV mode: cycle hospitals every 10 seconds + refresh stale KPIs on display
  useEffect(() => {
    if (tvMode && hospitals.length > 1) {
      tvTimer.current = setInterval(async () => {
        setTvIndex(i => {
          const next = (i + 1) % hospitals.length;
          // Refresh KPIs for the hospital about to be shown if >90s stale
          const h = hospitals[next];
          if (h && Date.now() - (h.fetchedAt || 0) > 90000) {
            fetchKPIs([{ id: h.id, name: h.name, state: h.state, beds_count: h.beds_count }]).then(results => {
              if (results[0]) {
                setHospitals(prev => prev.map(p => p.id === results[0].id ? results[0] : p));
              }
            });
          }
          return next;
        });
      }, 10000);
    } else {
      if (tvTimer.current) clearInterval(tvTimer.current);
    }
    return () => { if (tvTimer.current) clearInterval(tvTimer.current); };
  }, [tvMode, hospitals.length, hospitals, fetchKPIs]);

  const totalOPD = hospitals.reduce((s, h) => s + h.opdToday, 0);
  const totalAdmitted = hospitals.reduce((s, h) => s + h.admittedNow, 0);
  const totalRevenue = hospitals.reduce((s, h) => s + h.revenueToday, 0);
  const totalClaims = hospitals.reduce((s, h) => s + h.pendingClaims, 0);
  const totalBeds = hospitals.reduce((s, h) => s + h.beds_count, 0);
  const totalLeakage = hospitals.reduce((s, h) => s + h.leakageAmount, 0);
  const totalLeakageItems = hospitals.reduce((s, h) => s + h.leakageItems, 0);

  if (loading) return (
    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading CEO Board…</div>
  );

  // TV Mode — full-screen cycling view
  if (tvMode && hospitals.length > 0) {
    const h = hospitals[tvIndex];
    return (
      <div className="fixed inset-0 bg-background z-50 flex flex-col p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground">{h.name}</h1>
            <p className="text-muted-foreground">
              {h.state || "India"} · {format(new Date(), "dd MMM yyyy, HH:mm")}
              {h.fetchedAt && <span className="ml-2 text-xs opacity-60">· KPIs as of {format(new Date(h.fetchedAt), "HH:mm:ss")}</span>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="text-sm px-3 py-1">{tvIndex + 1} / {hospitals.length}</Badge>
            <Button size="sm" variant="outline" onClick={() => setTvIndex(i => (i - 1 + hospitals.length) % hospitals.length)}><ChevronLeft size={16} /></Button>
            <Button size="sm" variant="outline" onClick={() => setTvIndex(i => (i + 1) % hospitals.length)}><ChevronRight size={16} /></Button>
            <Button size="sm" onClick={() => setTvMode(false)}><Minimize2 size={14} className="mr-1" /> Exit TV Mode</Button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-6 flex-1">
          <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6 flex flex-col items-center justify-center">
            <Users size={40} className="text-primary mb-3" />
            <p className="text-6xl font-bold text-primary">{h.opdToday}</p>
            <p className="text-muted-foreground mt-2 text-lg">OPD Today</p>
          </div>
          <div className={`border rounded-2xl p-6 flex flex-col items-center justify-center ${h.occupancyPct >= 90 ? "bg-red-50 border-red-200" : "bg-card border-border"}`}>
            <Bed size={40} className={h.occupancyPct >= 90 ? "text-red-600 mb-3" : "text-blue-600 mb-3"} />
            <p className={`text-6xl font-bold ${h.occupancyPct >= 90 ? "text-red-600" : "text-blue-600"}`}>{h.occupancyPct}%</p>
            <p className="text-muted-foreground mt-2 text-lg">Bed Occupancy</p>
            <p className="text-muted-foreground text-sm">{h.admittedNow} / {h.beds_count} beds</p>
          </div>
          <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-6 flex flex-col items-center justify-center">
            <IndianRupee size={40} className="text-emerald-600 mb-3" />
            <p className="text-6xl font-bold text-emerald-600">{fmt(h.revenueToday)}</p>
            <p className="text-muted-foreground mt-2 text-lg">Revenue Today</p>
          </div>
          <div className="bg-card border border-border rounded-2xl p-6 flex flex-col items-center justify-center">
            <Activity size={40} className="text-amber-600 mb-3" />
            <p className="text-6xl font-bold text-amber-600">{h.labPendingToday}</p>
            <p className="text-muted-foreground mt-2 text-lg">Lab Pending</p>
            <p className="text-muted-foreground text-sm">{h.dischargesToday} discharges today</p>
          </div>
        </div>

        {/* Progress bar for auto-cycle */}
        <div className="mt-4 h-1 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary animate-[growWidth_10s_linear_infinite]" style={{ width: "100%" }} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="h-[52px] flex-shrink-0 bg-card border-b border-border flex items-center justify-between px-5">
        <div>
          <h1 className="text-base font-bold">CEO Command Board</h1>
          <p className="text-[10px] text-muted-foreground">Last updated: {format(lastRefresh.current, "HH:mm:ss")}</p>
        </div>
        <div className="flex items-center gap-2">
          {role === "super_admin" && (
            <select
              value={groupFilter}
              onChange={e => setGroupFilter(e.target.value)}
              className="text-xs border border-border rounded px-2 py-1 bg-background text-foreground h-8"
            >
              <option value="all">All Groups</option>
              {[...new Set(hospitals.map(h => h.group_tag).filter(Boolean))].map(g => (
                <option key={g!} value={g!}>{g}</option>
              ))}
            </select>
          )}
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => { setRefreshing(true); load(); }}>
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} /> Refresh
          </Button>
          {hospitals.length >= 1 && (
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => setTvMode(true)}>
              <Maximize2 size={12} /> TV Mode
            </Button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Chain-level aggregates */}
        {hospitals.length > 0 && (
          <div className="grid grid-cols-6 gap-3">
            <KpiBox label="OPD Today (chain)" value={totalOPD} icon={<Users size={14} className="text-primary" />} />
            <KpiBox label="Beds Occupied" value={`${totalAdmitted}/${totalBeds}`} sub={`${pct(totalAdmitted, totalBeds)}% occupancy`} icon={<Bed size={14} className="text-blue-600" />} />
            <KpiBox label="Revenue Today" value={fmt(totalRevenue)} icon={<IndianRupee size={14} className="text-emerald-600" />} />
            <KpiBox label="Pending Claims" value={totalClaims} alert={totalClaims > 20} icon={<TrendingUp size={14} className={totalClaims > 20 ? "text-red-600" : "text-amber-600"} />} />
            <KpiBox label="Active Hospitals" value={hospitals.length} icon={<Activity size={14} className="text-primary" />} />
            <KpiBox
              label="Yesterday's Leakage"
              value={totalLeakage > 0 ? fmt(totalLeakage) : "—"}
              sub={totalLeakageItems > 0 ? `${totalLeakageItems} unbilled item(s)` : "No leakage detected"}
              alert={totalLeakage > 0}
              icon={<ScanLine size={14} className={totalLeakage > 0 ? "text-red-600" : "text-emerald-600"} />}
            />
          </div>
        )}

        {/* Per-hospital comparison table */}
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-[10px] font-bold uppercase text-muted-foreground">
                <th className="px-3 py-2 text-left">Hospital / Branch</th>
                <th className="px-3 py-2 text-center">OPD Today</th>
                <th className="px-3 py-2 text-center">Admitted</th>
                <th className="px-3 py-2 text-center">Occupancy</th>
                <th className="px-3 py-2 text-center">Revenue Today</th>
                <th className="px-3 py-2 text-center">Lab Pending</th>
                <th className="px-3 py-2 text-center">Discharges</th>
                <th className="px-3 py-2 text-center">Claims Pending</th>
                <th className="px-3 py-2 text-center">Leakage (Yesterday)</th>
                <th className="px-3 py-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {hospitals.map((h) => (
                <tr key={h.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2.5">
                    <div className="text-xs font-medium">{h.name}</div>
                    {h.state && <div className="text-[10px] text-muted-foreground">{h.state}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs font-mono">{h.opdToday}</td>
                  <td className="px-3 py-2.5 text-center text-xs font-mono">{h.admittedNow}</td>
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${h.occupancyPct >= 90 ? "bg-red-500" : h.occupancyPct >= 75 ? "bg-amber-500" : "bg-emerald-500"}`}
                          style={{ width: `${Math.min(h.occupancyPct, 100)}%` }}
                        />
                      </div>
                      <span className={`text-xs font-mono font-bold ${h.occupancyPct >= 90 ? "text-red-600" : h.occupancyPct >= 75 ? "text-amber-600" : "text-emerald-600"}`}>
                        {h.occupancyPct}%
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs font-mono font-bold text-emerald-700 dark:text-emerald-400">
                    {fmt(h.revenueToday)}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`text-xs font-mono ${h.labPendingToday > 10 ? "text-amber-600 font-bold" : "text-muted-foreground"}`}>
                      {h.labPendingToday}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs font-mono text-muted-foreground">{h.dischargesToday}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`text-xs font-mono ${h.pendingClaims > 10 ? "text-amber-600 font-bold" : "text-muted-foreground"}`}>
                      {h.pendingClaims}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {h.leakageAmount > 0 ? (
                      <span className="text-xs font-mono font-bold text-red-600">
                        {fmt(h.leakageAmount)}
                        <span className="text-[9px] text-red-400 ml-1">({h.leakageItems})</span>
                      </span>
                    ) : (
                      <span className="text-[10px] text-emerald-600">✓ Clear</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {h.occupancyPct >= 90 || h.labPendingToday > 20 || h.leakageAmount > 50000 ? (
                      <Badge variant="destructive" className="text-[9px]"><AlertTriangle size={8} className="mr-0.5" /> Attention</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] border-emerald-300 bg-emerald-50 text-emerald-700">Normal</Badge>
                    )}
                  </td>
                </tr>
              ))}
              {hospitals.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-xs text-muted-foreground">No hospital data available</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* AI Executive Insights */}
        <div className="border border-border rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/50 hover:bg-muted/80 text-sm font-semibold transition-colors"
            onClick={() => {
              const opening = !digestOpen;
              setDigestOpen(opening);
              if (opening && !digestText) generateDigest();
            }}
          >
            <span className="flex items-center gap-2">
              <Bot size={14} className="text-primary" />
              AI Executive Insights — Today's Digest
            </span>
            {digestOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {digestOpen && (
            <div className="p-4 bg-card space-y-3">
              {digestLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" /> Generating AI summary…
                </div>
              ) : digestText ? (
                <>
                  <p className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">{digestText}</p>
                  <Button size="sm" variant="outline" className="text-xs gap-1" onClick={generateDigest} disabled={digestLoading}>
                    <RefreshCw size={11} /> Regenerate
                  </Button>
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 py-4">
                  <Bot size={36} className="text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">No digest yet for today</p>
                  <Button size="sm" onClick={generateDigest} disabled={digestLoading} className="gap-1">
                    <Bot size={12} /> Generate Now
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-[10px] text-muted-foreground">
          TV Mode cycles through each hospital/branch every 10 seconds. Super Admin users see all registered hospitals. Auto-refreshes every 2 minutes.
        </p>
      </div>
    </div>
  );
};

export default CEOBoardPage;

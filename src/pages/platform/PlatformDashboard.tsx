import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Building2, TrendingUp, Users, AlertTriangle, IndianRupee, RefreshCw, MapPin, Filter } from "lucide-react";
import { PLATFORM_STATUS_PILL, fmtINR } from "@/lib/platform-utils";
import { effectiveMonthlyAmount } from "@/lib/platformBilling";
import { format } from "date-fns";

interface DashStat {
  totalHospitals: number;
  active: number;
  trial: number;
  suspended: number;
  mrr: number;
  recent: Array<{
    id: string; name: string; state: string | null;
    beds_count: number; created_at: string;
    plan_name: string; status: string;
  }>;
  // Activation funnel
  funnel: {
    registered: number;
    hasOpd: number;
    hasBilling: number;
    hasIpd: number;
    converted: number;
  };
  // Geographic
  byState: Array<{ state: string; count: number }>;
}

const STATUS_PILL = PLATFORM_STATUS_PILL;

async function fetchDash(): Promise<DashStat> {
  const [hResult, sResult, funnelResult] = await Promise.all([
    (supabase as any).from("hospitals")
      .select("id, name, state, beds_count, created_at")
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    (supabase as any).from("hospital_subscriptions")
      .select("hospital_id, status, billing_cycle, effective_amount_inr, subscription_plans(name, price_monthly)"),
    // Use server-side COUNT(DISTINCT) instead of fetching all rows
    (supabase as any).rpc("platform_activation_funnel"),
  ]);

  const hospitals: any[] = hResult.data || [];
  const subs: any[]      = sResult.data || [];
  const subMap = new Map(subs.map((s: any) => [s.hospital_id, s]));

  const active    = subs.filter((s: any) => s.status === "active").length;
  const trial     = subs.filter((s: any) => s.status === "trial").length;
  const suspended = subs.filter((s: any) => ["suspended", "past_due"].includes(s.status)).length;
  // MRR comes from what the hospital is ACTUALLY charged, not the plan's list
  // price. Under bed-band pricing those differ by design (a 250-bed hospital on
  // Professional pays the base plus 21 bed blocks), so reading price_monthly
  // would understate MRR for every hospital above its included bed count.
  // Falls back to list price only for rows predating billing v2.
  const mrr       = subs
    .filter((s: any) => ["active", "trial"].includes(s.status))
    .reduce((acc: number, s: any) => acc + (
      s.effective_amount_inr != null
        ? effectiveMonthlyAmount({ amountInr: s.effective_amount_inr, cycle: s.billing_cycle })
        : Number(s.subscription_plans?.price_monthly) || 0
    ), 0);

  const recent = hospitals.slice(0, 12).map((h: any) => {
    const sub = subMap.get(h.id) as any;
    return {
      id: h.id, name: h.name, state: h.state,
      beds_count: h.beds_count, created_at: h.created_at,
      plan_name: sub?.subscription_plans?.name || "—",
      status: sub?.status || "no_subscription",
    };
  });

  // ── Activation Funnel (from server-side RPC) ───────────────────────────────
  const funnelRow = (funnelResult.data as any[])?.[0] ?? {};
  const funnel = {
    registered: Number(funnelRow.registered ?? hospitals.length),
    hasOpd:     Number(funnelRow.has_opd     ?? 0),
    hasBilling: Number(funnelRow.has_billing ?? 0),
    hasIpd:     Number(funnelRow.has_ipd     ?? 0),
    converted:  Number(funnelRow.converted   ?? active),
  };

  // ── Geographic Distribution ────────────────────────────────────────────────
  const stateMap = new Map<string, number>();
  for (const h of hospitals) {
    const s = h.state || "Unknown";
    stateMap.set(s, (stateMap.get(s) || 0) + 1);
  }
  const byState = [...stateMap.entries()]
    .map(([state, count]) => ({ state, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  return { totalHospitals: hospitals.length, active, trial, suspended, mrr, recent, funnel, byState };
}

// fmtINR imported from @/lib/platform-utils

export default function PlatformDashboard() {
  const navigate = useNavigate();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["platform-dash"],
    queryFn: fetchDash,
    staleTime: 60_000,
  });

  const KPIS = [
    { label: "Total Hospitals",  value: data?.totalHospitals, icon: Building2,     color: "text-blue-400" },
    { label: "Active",           value: data?.active,         icon: TrendingUp,    color: "text-emerald-400" },
    { label: "On Trial",         value: data?.trial,          icon: Users,         color: "text-blue-300" },
    { label: "Suspended",        value: data?.suspended,      icon: AlertTriangle, color: "text-red-400" },
    { label: "MRR",              value: data ? fmtINR(data.mrr) : "—", icon: IndianRupee, color: "text-emerald-400" },
  ];

  const funnel = data?.funnel;
  const funnelSteps = funnel ? [
    { label: "Registered",     count: funnel.registered, desc: "All hospitals" },
    { label: "Created OPD",    count: funnel.hasOpd,     desc: "First patient token" },
    { label: "Generated Bill", count: funnel.hasBilling, desc: "First bill created" },
    { label: "Used IPD",       count: funnel.hasIpd,     desc: "First admission" },
    { label: "Converted",      count: funnel.converted,  desc: "Paid subscription" },
  ] : [];

  const maxState = (data?.byState?.[0]?.count) || 1;

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0">
        <h1 className="text-[15px] font-semibold text-foreground">Platform Overview</h1>
        <button onClick={() => refetch()} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">

        {/* ── KPIs ── */}
        <div className="grid grid-cols-5 gap-4">
          {KPIS.map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-card border border-border rounded-xl p-4 shadow-sm">
              <Icon size={15} className={`${color} mb-3`} />
              <p className="text-2xl font-bold text-foreground font-mono">{isLoading ? "—" : (value ?? 0)}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
            </div>
          ))}
        </div>

        {/* ── Activation Funnel + Geographic side by side ── */}
        <div className="grid grid-cols-2 gap-5">

          {/* Activation Funnel */}
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Filter size={14} className="text-blue-500" />
              <p className="text-sm font-semibold text-foreground">Activation Funnel</p>
            </div>
            {isLoading ? (
              <div className="text-xs text-muted-foreground py-4">Loading…</div>
            ) : (
              <div className="space-y-3">
                {funnelSteps.map((step, i) => {
                  const pct = funnel?.registered ? Math.round((step.count / funnel.registered) * 100) : 0;
                  const isLast = i === funnelSteps.length - 1;
                  return (
                    <div key={step.label}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-muted-foreground w-4">{i + 1}</span>
                          <span className="text-xs text-foreground/80">{step.label}</span>
                          <span className="text-[10px] text-muted-foreground">{step.desc}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-mono font-bold ${isLast ? "text-emerald-500" : "text-foreground"}`}>
                            {step.count}
                          </span>
                          <span className="text-[10px] text-muted-foreground w-8 text-right">{pct}%</span>
                        </div>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${isLast ? "bg-emerald-500" : "bg-blue-600"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      {/* Drop-off indicator */}
                      {i > 0 && funnelSteps[i - 1].count > 0 && (
                        <p className="text-[10px] text-muted-foreground text-right mt-0.5">
                          {funnelSteps[i - 1].count - step.count > 0
                            ? `↓ ${funnelSteps[i - 1].count - step.count} dropped off`
                            : ""}
                        </p>
                      )}
                    </div>
                  );
                })}
                {funnel && funnel.registered > 0 && (
                  <div className="pt-2 border-t border-border text-[11px] text-muted-foreground">
                    Overall conversion: <span className="text-emerald-500 font-mono font-bold">
                      {Math.round((funnel.converted / funnel.registered) * 100)}%
                    </span> of all signups converted to paid
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Geographic Distribution */}
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <MapPin size={14} className="text-blue-500" />
              <p className="text-sm font-semibold text-foreground">Geographic Distribution</p>
            </div>
            {isLoading ? (
              <div className="text-xs text-muted-foreground py-4">Loading…</div>
            ) : (data?.byState || []).length === 0 ? (
              <div className="text-xs text-muted-foreground py-4">No location data yet</div>
            ) : (
              <div className="space-y-2">
                {(data?.byState || []).map((row) => (
                  <div key={row.state} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-28 truncate shrink-0">{row.state}</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full"
                        style={{ width: `${Math.round((row.count / maxState) * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono text-foreground/80 w-4 text-right shrink-0">{row.count}</span>
                  </div>
                ))}
                {data && (
                  <div className="pt-2 border-t border-border text-[11px] text-muted-foreground">
                    {new Set(data.byState.map(r => r.state)).size} states covered ·{" "}
                    28 total states in India
                  </div>
                )}
              </div>
            )}
          </div>

        </div>

        {/* ── Recent hospitals table ── */}
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Recent Hospitals</p>
            <button onClick={() => navigate("/platform/hospitals")} className="text-xs text-blue-500 hover:text-blue-600 transition-colors">
              View all →
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase font-bold text-muted-foreground border-b border-border">
                {["Hospital", "State", "Beds", "Plan", "Status", "Joined", ""].map((h) => (
                  <th key={h} className="px-5 py-2.5 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-xs text-muted-foreground">Loading…</td></tr>
              ) : !data?.recent.length ? (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-xs text-muted-foreground">No hospitals yet</td></tr>
              ) : data.recent.map((h) => (
                <tr key={h.id} className="border-t border-border hover:bg-muted/40 transition-colors">
                  <td className="px-5 py-3 text-xs font-medium text-foreground">{h.name}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{h.state || "—"}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground font-mono">{h.beds_count}</td>
                  <td className="px-5 py-3 text-xs text-foreground/80">{h.plan_name}</td>
                  <td className="px-5 py-3">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_PILL[h.status] || STATUS_PILL.no_subscription}`}>
                      {h.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{format(new Date(h.created_at), "dd MMM yyyy")}</td>
                  <td className="px-5 py-3">
                    <button onClick={() => navigate(`/platform/hospitals/${h.id}`)} className="text-xs text-blue-500 hover:text-blue-600">
                      Manage →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}

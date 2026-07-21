import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { IndianRupee, TrendingUp, RefreshCw, Repeat2, Wallet, ArrowUpRight } from "lucide-react";
import { fmtINR, RECHARTS_TOOLTIP_STYLE } from "@/lib/platform-utils";
import MetricInfoIcon from "@/components/platform/MetricInfoIcon";
import { effectiveMonthlyAmount } from "@/lib/platformBilling";
import { format, addDays, subMonths } from "date-fns";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from "recharts";

// ─── types ────────────────────────────────────────────────────────────────────
interface SubRow {
  hospital_id: string;
  status: string;
  plan_id: string | null;
  created_at: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  billing_cycle?: "monthly" | "yearly" | null;
  effective_amount_inr?: number | string | null;
  subscription_plans: { name: string; price_monthly: number } | null;
  hospitals: { name: string } | null;
}

interface RevData {
  mrr: number;
  arr: number;
  logoRetention12mo: number | null;
  ltv: number | null;
  conversionRate: number;
  activeCount: number;
  trialCount: number;
  atRiskMrr: number;
  byPlan: Array<{ name: string; count: number; revenue: number; pct: number }>;
  monthlyChart: Array<{ month: string; newMrr: number; totalMrr: number; collected: number }>;
  /** Cash actually received this calendar month, net of refunds. */
  collectedMtd: number;
  /** Cash actually received over the trailing 12 months, net of refunds. */
  collected12mo: number;
  upcoming: Array<{ hospital: string; plan: string; ends: string; amount: number }>;
  pastDue: Array<{ hospital: string; plan: string; since: string; amount: number }>;
}

// ─── data fetcher ─────────────────────────────────────────────────────────────
async function fetchRevenue(): Promise<RevData> {
  const { data: subs } = await (supabase as any)
    .from("hospital_subscriptions")
    .select(`
      hospital_id, status, plan_id, created_at, trial_ends_at, current_period_end,
      billing_cycle, effective_amount_inr,
      subscription_plans(name, price_monthly),
      hospitals(name)
    `);

  const rows: SubRow[] = subs || [];

  // MRR must reflect what the hospital is ACTUALLY billed, not the plan's list
  // price: negotiated overrides and coupons are now genuinely charged, and an
  // annual subscriber pays 12 months at once. Reading price_monthly directly
  // (as this did) overstates discounted customers and 12x-overstates annual ones
  // in their payment month.
  const price = (r: SubRow) =>
    r.effective_amount_inr != null
      ? effectiveMonthlyAmount({ amountInr: r.effective_amount_inr, cycle: r.billing_cycle })
      : Number(r.subscription_plans?.price_monthly) || 0;

  const active    = rows.filter((r) => r.status === "active");
  const trial     = rows.filter((r) => r.status === "trial");
  const pastDueRows = rows.filter((r) => ["past_due", "suspended"].includes(r.status));

  // MRR = active, paying subscriptions only — trials are not revenue yet.
  const mrr = active.reduce((s, r) => s + price(r), 0);
  const arr = mrr * 12;
  const activeCount = active.length;
  const trialCount  = trial.length;
  const atRiskMrr   = pastDueRows.reduce((s, r) => s + price(r), 0);

  // ── 12-month Logo Retention ────────────────────────────────────────────────
  // Headcount retention, not dollar-weighted — was previously mislabeled
  // "NRR" on this dashboard. Real dollar-weighted NRR is computed by
  // compute_dollar_nrr() from mrr_snapshots, fetched separately below.
  const twelveMonthsAgo = subMonths(new Date(), 12);
  const cohort12 = rows.filter((r) => new Date(r.created_at) < twelveMonthsAgo);
  const retained12 = cohort12.filter((r) => ["active", "trial"].includes(r.status));
  const logoRetention12mo = cohort12.length > 0
    ? Math.round((retained12.length / cohort12.length) * 100)
    : null;

  // ── LTV ───────────────────────────────────────────────────────────────────
  const arpu = activeCount > 0 ? mrr / activeCount : 0;
  const avgAgeMonths = active.length > 0
    ? active.reduce((s, r) => {
        const ageDays = (Date.now() - new Date(r.created_at).getTime()) / 86400000;
        return s + ageDays / 30;
      }, 0) / active.length
    : 0;
  const ltv = arpu > 0 ? Math.round(arpu * Math.max(avgAgeMonths * 2, 12)) : null;

  // ── Trial → Paid Conversion ────────────────────────────────────────────────
  const olderTrials = trial.filter((r) => {
    const ageDays = (Date.now() - new Date(r.created_at).getTime()) / 86400000;
    return ageDays > 14;
  });
  const denominator = activeCount + olderTrials.length;
  const conversionRate = denominator > 0
    ? Math.round((activeCount / denominator) * 100)
    : 0;

  // ── Monthly MRR Growth Chart ───────────────────────────────────────────────
  const allPaying = [...active, ...trial];
  const signupRevByMonth = new Map<string, number>();
  for (const r of allPaying) {
    const key = format(new Date(r.created_at), "MMM yy");
    signupRevByMonth.set(key, (signupRevByMonth.get(key) || 0) + price(r));
  }

  const baseline = allPaying
    .filter((r) => new Date(r.created_at) < twelveMonthsAgo)
    .reduce((s, r) => s + price(r), 0);

  // ── Collected cash ─────────────────────────────────────────────────────────
  // Everything above is CONTRACTED revenue derived from subscriptions. This is
  // money that actually arrived, from the invoice ledger — the two diverge when
  // a charge fails or is refunded, and only this side is real.
  const { data: invRows } = await (supabase as any)
    .from("subscription_invoices")
    .select("amount_inr, refund_amount_inr, status, invoice_type, created_at")
    .gte("created_at", twelveMonthsAgo.toISOString());

  const collectedByMonth = new Map<string, number>();
  let collectedMtd = 0;
  let collected12mo = 0;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  for (const inv of (invRows || []) as any[]) {
    // Credit notes are the refund record; subtracting them AND the originating
    // invoice's refund_amount_inr would double-count the same refund.
    const signed = inv.invoice_type === "credit_note"
      ? -Number(inv.amount_inr || 0)
      : (inv.status === "paid" || inv.status === "partially_refunded" || inv.status === "refunded")
        ? Number(inv.amount_inr || 0)
        : 0;   // failed attempts contribute nothing
    if (!signed) continue;

    const key = format(new Date(inv.created_at), "MMM yy");
    collectedByMonth.set(key, (collectedByMonth.get(key) || 0) + signed);
    collected12mo += signed;
    if (new Date(inv.created_at) >= monthStart) collectedMtd += signed;
  }

  let running = baseline;
  const monthlyChart = Array.from({ length: 12 }, (_, i) => {
    const d = subMonths(new Date(), 11 - i);
    const month = format(d, "MMM yy");
    const newMrr = signupRevByMonth.get(month) || 0;
    running += newMrr;
    return { month, newMrr, totalMrr: running, collected: collectedByMonth.get(month) || 0 };
  });

  // ── Plan breakdown ─────────────────────────────────────────────────────────
  const planMap = new Map<string, { count: number; revenue: number }>();
  for (const r of allPaying) {
    const name = r.subscription_plans?.name || "Unknown";
    const cur = planMap.get(name) || { count: 0, revenue: 0 };
    planMap.set(name, { count: cur.count + 1, revenue: cur.revenue + price(r) });
  }
  const byPlan = [...planMap.entries()]
    .map(([name, v]) => ({ name, ...v, pct: mrr > 0 ? Math.round((v.revenue / mrr) * 100) : 0 }))
    .sort((a, b) => b.revenue - a.revenue);

  // ── Upcoming renewals ─────────────────────────────────────────────────────
  const now = new Date();
  const soon = addDays(now, 14);
  const upcoming = active
    .filter((r) => r.current_period_end && new Date(r.current_period_end) <= soon)
    .map((r) => ({
      hospital: (r.hospitals as any)?.name || "—",
      plan: r.subscription_plans?.name || "—",
      ends: r.current_period_end!,
      amount: price(r),
    }))
    .slice(0, 10);

  const pastDue = pastDueRows
    .map((r) => ({
      hospital: (r.hospitals as any)?.name || "—",
      plan: r.subscription_plans?.name || "—",
      since: r.current_period_end || "—",
      amount: price(r),
    }))
    .slice(0, 10);

  return { mrr, arr, logoRetention12mo, ltv, conversionRate, activeCount, trialCount, atRiskMrr, byPlan, monthlyChart, upcoming, pastDue, collectedMtd, collected12mo };
}

// ─── helpers ──────────────────────────────────────────────────────────────────
// fmtINR imported from @/lib/platform-utils

const chartTooltipFormatter = (value: number, name: string) => [
  fmtINR(value),
  name === "newMrr" ? "New MRR" : "Total MRR",
];

// ─── component ────────────────────────────────────────────────────────────────
export default function RevenueDashboardPage() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["platform-revenue"],
    queryFn: fetchRevenue,
    staleTime: 60_000,
  });

  const topCard = (label: string, value: string, sub: string, icon: React.ReactNode, accent = "text-emerald-600", metricKey?: string) => (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">{sub}</span>
      </div>
      <p className={`text-2xl font-bold font-mono ${accent}`}>{isLoading ? "—" : value}</p>
      <p className="text-[11px] text-muted-foreground mt-1">{label}{metricKey && <MetricInfoIcon metricKey={metricKey} />}</p>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0">
        <h1 className="text-[15px] font-semibold text-foreground">Revenue Intelligence</h1>
        <button onClick={() => refetch()} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">

        {/* ── Top metric cards ── */}
        <div className="grid grid-cols-4 gap-4">
          {topCard("Monthly Recurring Revenue", data ? fmtINR(data.mrr) : "—", "Contracted MRR", <IndianRupee size={16} />, "text-emerald-600", "mrr")}
          {topCard("Annual Run Rate", data ? fmtINR(data.arr) : "—", "ARR", <TrendingUp size={16} />, "text-emerald-600", "arr")}
          {/* Contracted ≠ collected. Everything above is derived from
              subscriptions; these two come from the invoice ledger, i.e. money
              that actually arrived, net of refunds. */}
          {topCard("Collected This Month", data ? fmtINR(data.collectedMtd) : "—", "Cash received, net of refunds", <Wallet size={16} />, "text-emerald-600")}
          {topCard("Collected (12 mo)", data ? fmtINR(data.collected12mo) : "—", "Trailing 12 months", <Wallet size={16} />, "text-emerald-600")}
          {topCard(
            "12-Month Logo Retention",
            data?.logoRetention12mo != null ? `${data.logoRetention12mo}%` : "N/A",
            "% of hospitals",
            <Repeat2 size={16} />,
            data?.logoRetention12mo != null && data.logoRetention12mo >= 90 ? "text-emerald-600" : data?.logoRetention12mo != null && data.logoRetention12mo >= 70 ? "text-amber-600" : "text-red-500",
            "logo_retention_12mo",
          )}
          {topCard(
            "Avg Customer LTV",
            data?.ltv ? fmtINR(data.ltv) : "N/A",
            "Est. lifetime value",
            <Wallet size={16} />,
            "text-emerald-600",
            "ltv",
          )}
          {topCard(
            "Trial → Paid Rate",
            data ? `${data.conversionRate}%` : "—",
            `${data?.activeCount ?? 0} paid / ${(data?.activeCount ?? 0) + (data?.trialCount ?? 0)} total`,
            <ArrowUpRight size={16} />,
            data?.conversionRate != null && data.conversionRate >= 50 ? "text-emerald-600" : "text-amber-600",
            "trial_to_paid_conversion",
          )}
        </div>

        {/* ── Real dollar-weighted NRR ── */}
        <DollarNrrCard />

        {/* ── Sub-metrics row ── */}
        {data && (
          <div className="flex items-center gap-6 px-1">
            <span className="text-xs text-muted-foreground">
              <span className="text-emerald-600 font-mono font-bold">{data.activeCount}</span> paid
            </span>
            <span className="text-[10px] text-border">·</span>
            <span className="text-xs text-muted-foreground">
              <span className="text-blue-600 font-mono font-bold">{data.trialCount}</span> on trial
            </span>
            {data.atRiskMrr > 0 && (
              <>
                <span className="text-[10px] text-border">·</span>
                <span className="text-xs text-muted-foreground">
                  <span className="text-red-500 font-mono font-bold">{fmtINR(data.atRiskMrr)}</span> at risk (past-due/suspended)<MetricInfoIcon metricKey="at_risk_mrr" />
                </span>
              </>
            )}
          </div>
        )}

        {/* ── MRR Growth Chart ── */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-sm font-semibold text-foreground">MRR Growth Trajectory</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Active subscriptions by signup month · bars = new MRR added · line = cumulative
              </p>
            </div>
          </div>
          {isLoading ? (
            <div className="h-52 flex items-center justify-center text-xs text-muted-foreground">Loading…</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={data?.monthlyChart || []} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#64748b" }} />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={RECHARTS_TOOLTIP_STYLE}
                  formatter={chartTooltipFormatter}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: "#64748b" }} />
                <Bar yAxisId="left" dataKey="newMrr" name="New MRR" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="totalMrr" name="Total MRR" stroke="#10b981" strokeWidth={2} dot={false} />
                {/* Collected sits against contracted so a gap between the two —
                    failed charges, refunds — is visible rather than inferred. */}
                <Line yAxisId="right" type="monotone" dataKey="collected" name="Collected" stroke="#6366f1" strokeWidth={2} strokeDasharray="4 3" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* ── Plan breakdown ── */}
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-border">
            <p className="text-sm font-semibold text-foreground">Revenue by Plan</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase font-bold text-muted-foreground border-b border-border">
                {["Plan", "Hospitals", "Monthly Revenue", "Annual Revenue", "% of MRR"].map((h) => (
                  <th key={h} className="px-5 py-2.5 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="px-5 py-6 text-center text-xs text-muted-foreground">Loading…</td></tr>
              ) : (data?.byPlan || []).length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-6 text-center text-xs text-muted-foreground">No paid subscriptions yet</td></tr>
              ) : (data?.byPlan || []).map((r) => (
                <tr key={r.name} className="border-t border-border">
                  <td className="px-5 py-3 text-xs font-medium text-foreground">{r.name}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground font-mono">{r.count}</td>
                  <td className="px-5 py-3 text-xs text-emerald-600 font-mono">{fmtINR(r.revenue)}</td>
                  <td className="px-5 py-3 text-xs text-emerald-500 font-mono">{fmtINR(r.revenue * 12)}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 bg-muted rounded-full w-20 overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${r.pct}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground font-mono w-8">{r.pct}%</span>
                    </div>
                  </td>
                </tr>
              ))}
              {data && (
                <tr className="border-t border-border bg-muted/30">
                  <td className="px-5 py-3 text-xs font-bold text-foreground">Total</td>
                  <td className="px-5 py-3 text-xs font-mono text-foreground">{data.byPlan.reduce((s, r) => s + r.count, 0)}</td>
                  <td className="px-5 py-3 text-xs font-bold text-emerald-600 font-mono">{fmtINR(data.mrr)}</td>
                  <td className="px-5 py-3 text-xs font-bold text-emerald-500 font-mono">{fmtINR(data.arr)}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">100%</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Upcoming renewals ── */}
        {(data?.upcoming.length ?? 0) > 0 && (
          <div className="bg-card border border-amber-300 rounded-xl overflow-hidden shadow-sm">
            <div className="px-5 py-3 border-b border-amber-200 bg-amber-50 flex items-center justify-between">
              <p className="text-sm font-semibold text-amber-700">Upcoming Renewals — next 14 days</p>
              <p className="text-xs text-amber-600 font-mono">
                {fmtINR((data?.upcoming || []).reduce((s, r) => s + r.amount, 0))} renewing
              </p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase font-bold text-muted-foreground border-b border-border">
                  {["Hospital", "Plan", "Renewal Date", "Amount"].map((h) => (
                    <th key={h} className="px-5 py-2.5 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.upcoming || []).map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-5 py-3 text-xs text-foreground">{r.hospital}</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{r.plan}</td>
                    <td className="px-5 py-3 text-xs text-amber-600">
                      {r.ends ? format(new Date(r.ends), "dd MMM yyyy") : "—"}
                    </td>
                    <td className="px-5 py-3 text-xs text-emerald-600 font-mono">{fmtINR(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Past due ── */}
        {(data?.pastDue.length ?? 0) > 0 && (
          <div className="bg-card border border-red-300 rounded-xl overflow-hidden shadow-sm">
            <div className="px-5 py-3 border-b border-red-200 bg-red-50 flex items-center justify-between">
              <p className="text-sm font-semibold text-red-600">Past Due / Suspended</p>
              <p className="text-xs text-red-500 font-mono">
                {fmtINR((data?.pastDue || []).reduce((s, r) => s + r.amount, 0))} at risk
              </p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase font-bold text-muted-foreground border-b border-border">
                  {["Hospital", "Plan", "Period End", "Monthly Value"].map((h) => (
                    <th key={h} className="px-5 py-2.5 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.pastDue || []).map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-5 py-3 text-xs text-red-600 font-medium">{r.hospital}</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{r.plan}</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">
                      {r.since && r.since !== "—" ? format(new Date(r.since), "dd MMM yyyy") : "—"}
                    </td>
                    <td className="px-5 py-3 text-xs text-red-500 font-mono">{fmtINR(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Settlement Reconciliation ── */}
        <SettlementReconciliationPanel />

      </div>
    </div>
  );
}

// ─── Real dollar-weighted NRR ───────────────────────────────────────────────────
// mrr_snapshots only started accumulating when that migration shipped, so
// compute_dollar_nrr() returns null ("insufficient data") for roughly the
// first 12 months. Showing that honestly — not hiding the card, not faking
// a number — is the whole point of building this the slow-but-real way.
async function fetchDollarNrr(): Promise<{ nrr: number | null; since: string | null }> {
  const [nrrRes, sinceRes] = await Promise.all([
    (supabase as any).rpc("compute_dollar_nrr"),
    (supabase as any).rpc("mrr_snapshots_since"),
  ]);
  return { nrr: nrrRes.data ?? null, since: sinceRes.data ?? null };
}

function DollarNrrCard() {
  const { data } = useQuery({
    queryKey: ["platform-dollar-nrr"],
    queryFn: fetchDollarNrr,
    staleTime: 5 * 60 * 1000,
  });

  const accurateFrom = data?.since
    ? format(new Date(new Date(data.since).setMonth(new Date(data.since).getMonth() + 12)), "MMM yyyy")
    : null;

  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-sm flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-semibold text-foreground">Dollar-Weighted NRR</span>
        <span className="text-[10px] text-muted-foreground">(the real, revenue-weighted retention metric — distinct from Logo Retention above)</span>
      </div>
      {data?.nrr != null ? (
        <span className="text-lg font-bold font-mono text-emerald-600">{data.nrr}%</span>
      ) : (
        <span className="text-[11px] text-amber-700">
          {data?.since
            ? `Accumulating since ${format(new Date(data.since), "MMM yyyy")} — accurate from ${accurateFrom}`
            : "Not yet accumulating — mrr_snapshots has no data yet"}
        </span>
      )}
    </div>
  );
}

// ─── Settlement reconciliation panel ───────────────────────────────────────────
interface ReconFlag {
  id: string;
  discrepancy_type: string;
  expected_amount: number;
  settled_amount: number | null;
  razorpay_status: string | null;
  flagged_at: string;
  hospitals: { name: string } | null;
  subscription_invoices: { invoice_number: string } | null;
}

const DISCREPANCY_LABEL: Record<string, string> = {
  payment_not_found: "Payment not found",
  not_captured: "Not captured",
  amount_mismatch: "Amount mismatch",
  refunded: "Refunded",
};

async function fetchReconFlags(): Promise<ReconFlag[]> {
  const { data } = await (supabase as any)
    .from("settlement_reconciliation_flags")
    .select("id, discrepancy_type, expected_amount, settled_amount, razorpay_status, flagged_at, hospitals(name), subscription_invoices(invoice_number)")
    .is("resolved_at", null)
    .order("flagged_at", { ascending: false });
  return data || [];
}

function SettlementReconciliationPanel() {
  const { data: flags, isLoading } = useQuery({
    queryKey: ["settlement-reconciliation-flags"],
    queryFn: fetchReconFlags,
    staleTime: 60_000,
  });

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">Settlement Reconciliation</p>
        <p className="text-[11px] text-muted-foreground">
          Weekly check against real Razorpay payment records · unresolved discrepancies only
        </p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase font-bold text-muted-foreground border-b border-border">
            {["Hospital", "Invoice", "Issue", "Expected", "Razorpay Amount", "Razorpay Status", "Flagged"].map((h) => (
              <th key={h} className="px-5 py-2.5 text-left">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr><td colSpan={7} className="px-5 py-6 text-center text-xs text-muted-foreground">Loading…</td></tr>
          ) : (flags || []).length === 0 ? (
            <tr><td colSpan={7} className="px-5 py-6 text-center text-xs text-muted-foreground">No unresolved discrepancies — everything reconciled on the last scan.</td></tr>
          ) : (flags || []).map((f) => (
            <tr key={f.id} className="border-t border-border">
              <td className="px-5 py-3 text-xs text-foreground">{f.hospitals?.name || "—"}</td>
              <td className="px-5 py-3 text-xs text-muted-foreground font-mono">{f.subscription_invoices?.invoice_number || "—"}</td>
              <td className="px-5 py-3 text-xs">
                <span className="text-red-600 font-medium">{DISCREPANCY_LABEL[f.discrepancy_type] || f.discrepancy_type}</span>
              </td>
              <td className="px-5 py-3 text-xs text-foreground font-mono">{fmtINR(f.expected_amount)}</td>
              <td className="px-5 py-3 text-xs text-muted-foreground font-mono">{f.settled_amount != null ? fmtINR(f.settled_amount) : "—"}</td>
              <td className="px-5 py-3 text-xs text-muted-foreground">{f.razorpay_status || "—"}</td>
              <td className="px-5 py-3 text-xs text-muted-foreground">{format(new Date(f.flagged_at), "dd MMM yyyy")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

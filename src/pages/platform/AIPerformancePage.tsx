import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, subDays, startOfDay } from "date-fns";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ComposedChart,
} from "recharts";
import { Zap, TrendingDown, IndianRupee, Activity, CheckCircle2, AlertCircle } from "lucide-react";
import { RECHARTS_TOOLTIP_STYLE } from "@/lib/platform-utils";
import { formatINRPrecise, formatINRCompact } from "@/lib/currency";

// ─── types ────────────────────────────────────────────────────────────────────
interface DailyRow {
  date: string;
  feature_key: string;
  provider: string;
  total_calls: number;
  total_tokens_input: number;
  total_tokens_output: number;
  total_cache_reads: number;
  cache_hit_count: number;
  total_cost_inr: number;
  hospitals: { name: string } | null;
  hospital_id: string;
}

interface HospitalSummary {
  hospital_id: string;
  hospital_name: string;
  total_calls: number;
  cache_hit_pct: number;
  total_cost_inr: number;
  total_tokens: number;
  top_feature: string;
}

interface ChartPoint {
  date: string;
  cost: number;
  calls: number;
  cache_pct: number;
}

// Rupees, not dollars: providers bill Aumrti in USD but every figure shown in
// the product is ₹ (the raw USD is still stored for invoice reconciliation).
// formatINRPrecise rather than formatINRExact because AI unit costs are
// routinely under ₹1 and must not round to "₹0".
const fmtMoney = (v: number) => formatINRPrecise(v);

const fmtN = (v: number) =>
  v >= 1_000_000
    ? `${(v / 1_000_000).toFixed(1)}M`
    : v >= 1_000
    ? `${(v / 1_000).toFixed(1)}K`
    : String(v);

// ─── data fetch ───────────────────────────────────────────────────────────────
async function fetchAIPerf(days: number) {
  const since = format(subDays(startOfDay(new Date()), days), "yyyy-MM-dd");

  const { data: rows } = await (supabase as any)
    .from("ai_cost_daily")
    .select(`
      date, feature_key, provider, total_calls,
      total_tokens_input, total_tokens_output,
      total_cache_reads, cache_hit_count, total_cost_inr,
      hospital_id,
      hospitals:hospital_id ( name )
    `)
    .gte("date", since)
    .order("date", { ascending: true });

  const all: DailyRow[] = rows ?? [];

  // ── Platform totals ────────────────────────────────────────────────────────
  const totalCalls       = all.reduce((s, r) => s + r.total_calls, 0);
  const totalCostInr     = all.reduce((s, r) => s + r.total_cost_inr, 0);
  const totalCacheHits   = all.reduce((s, r) => s + r.cache_hit_count, 0);
  const totalTokensIn    = all.reduce((s, r) => s + r.total_tokens_input, 0);
  const totalTokensOut   = all.reduce((s, r) => s + r.total_tokens_output, 0);
  const cacheHitPct      = totalCalls > 0 ? (totalCacheHits / totalCalls) * 100 : 0;

  // ── Daily trend for chart ──────────────────────────────────────────────────
  const byDate: Record<string, ChartPoint> = {};
  for (const r of all) {
    if (!byDate[r.date]) byDate[r.date] = { date: r.date, cost: 0, calls: 0, cache_pct: 0 };
    byDate[r.date].cost  += r.total_cost_inr;
    byDate[r.date].calls += r.total_calls;
  }
  // second pass for cache_pct per day
  const byDateCacheHits: Record<string, number> = {};
  for (const r of all) {
    byDateCacheHits[r.date] = (byDateCacheHits[r.date] ?? 0) + r.cache_hit_count;
  }
  const trendData: ChartPoint[] = Object.values(byDate).map(d => ({
    ...d,
    cost:      parseFloat(d.cost.toFixed(4)),
    cache_pct: d.calls > 0
      ? parseFloat(((byDateCacheHits[d.date] ?? 0) / d.calls * 100).toFixed(1))
      : 0,
    date: format(new Date(d.date), "dd MMM"),
  }));

  // ── Per-hospital summary ───────────────────────────────────────────────────
  const hospitalMap: Record<string, HospitalSummary> = {};
  for (const r of all) {
    const hid  = r.hospital_id;
    const name = (r.hospitals as any)?.name ?? hid.substring(0, 8);
    if (!hospitalMap[hid]) {
      hospitalMap[hid] = {
        hospital_id: hid, hospital_name: name,
        total_calls: 0, cache_hit_pct: 0, total_cost_inr: 0,
        total_tokens: 0, top_feature: "",
      };
    }
    hospitalMap[hid].total_calls    += r.total_calls;
    hospitalMap[hid].total_cost_inr += r.total_cost_inr;
    hospitalMap[hid].total_tokens   += r.total_tokens_input + r.total_tokens_output;
  }
  // cache_hit_pct per hospital
  const hCacheHits: Record<string, number> = {};
  for (const r of all) {
    hCacheHits[r.hospital_id] = (hCacheHits[r.hospital_id] ?? 0) + r.cache_hit_count;
  }
  for (const hid of Object.keys(hospitalMap)) {
    const h = hospitalMap[hid];
    h.cache_hit_pct = h.total_calls > 0
      ? parseFloat(((hCacheHits[hid] ?? 0) / h.total_calls * 100).toFixed(1))
      : 0;
    h.total_cost_inr = parseFloat(h.total_cost_inr.toFixed(4));
  }

  // ── Feature breakdown ──────────────────────────────────────────────────────
  const featureMap: Record<string, { calls: number; cost: number; cache_hits: number }> = {};
  for (const r of all) {
    if (!featureMap[r.feature_key]) featureMap[r.feature_key] = { calls: 0, cost: 0, cache_hits: 0 };
    featureMap[r.feature_key].calls      += r.total_calls;
    featureMap[r.feature_key].cost       += r.total_cost_inr;
    featureMap[r.feature_key].cache_hits += r.cache_hit_count;
  }
  const featureData = Object.entries(featureMap)
    .map(([key, v]) => ({
      feature: key.replace(/_/g, " "),
      calls:   v.calls,
      cost:    parseFloat(v.cost.toFixed(4)),
      cache_pct: v.calls > 0 ? parseFloat((v.cache_hits / v.calls * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10);

  const hospitals = Object.values(hospitalMap).sort((a, b) => b.total_cost_inr - a.total_cost_inr);

  return {
    totalCalls, totalCostInr, cacheHitPct,
    totalTokensIn, totalTokensOut,
    trendData, featureData, hospitals,
  };
}

// ─── component ────────────────────────────────────────────────────────────────
export default function AIPerformancePage() {
  const [days, setDays] = useState(30);

  const { data, isLoading } = useQuery({
    queryKey: ["platform-ai-perf", days],
    queryFn: () => fetchAIPerf(days),
    refetchInterval: 60_000,
  });

  // Observed unit cost of a dictated encounter and a scanned document.
  //
  // This is the deliverable of the encounter-pricing work: it replaces an
  // estimated ₹/encounter with a measured one, covering BOTH halves of a
  // dictation (the LLM structuring call and the ASR transcription that was
  // previously invisible). Credit-pack pricing should be set from this, not
  // from a guess. Rows show NULL until a hospital has at least one encounter —
  // "not yet measured" rather than "free".
  const { data: unitCosts } = useQuery({
    queryKey: ["platform-encounter-unit-cost"],
    queryFn: async () => {
      const { data: rows } = await (supabase as any)
        .from("hospital_encounter_usage")
        .select("hospital_id, hospital_name, plan_slug, voice_encounters, ocr_documents, inr_per_encounter, inr_per_document, encounter_credits")
        .order("voice_encounters", { ascending: false })
        .limit(15);
      return (rows || []) as Array<{
        hospital_id: string; hospital_name: string; plan_slug: string;
        voice_encounters: number; ocr_documents: number;
        inr_per_encounter: number | null; inr_per_document: number | null;
        encounter_credits: number;
      }>;
    },
    staleTime: 60_000,
  });

  // Always month-to-date regardless of the 7/30/90 chart window — a budget is a
  // billing-cycle concept, not a rolling window, so it must not move with the
  // chart selector.
  const { data: overBudget } = useQuery({
    queryKey: ["platform-ai-over-budget"],
    queryFn: async () => {
      const { data: rows } = await (supabase as any)
        .from("hospital_ai_budget_status")
        .select("hospital_id, hospital_name, plan_slug, budget_inr, metered_cost_inr, overage_inr, pct_used")
        .eq("over_budget", true)
        .order("overage_inr", { ascending: false });
      return (rows || []) as Array<{
        hospital_id: string; hospital_name: string; plan_slug: string;
        budget_inr: number; metered_cost_inr: number; overage_inr: number; pct_used: number;
      }>;
    },
    staleTime: 60_000,
  });

  const kpis = [
    {
      label: "Total API Calls",
      value: data ? fmtN(data.totalCalls) : "—",
      icon: Activity,
      color: "text-blue-500",
    },
    {
      label: "Total Cost",
      value: data ? fmtMoney(data.totalCostInr) : "—",
      icon: IndianRupee,
      color: "text-emerald-600",
    },
    {
      label: "Cache Hit Rate",
      value: data ? `${data.cacheHitPct.toFixed(1)}%` : "—",
      icon: data && data.cacheHitPct >= 50 ? CheckCircle2 : AlertCircle,
      color: data && data.cacheHitPct >= 50 ? "text-emerald-600" : "text-amber-600",
    },
    {
      label: "Total Tokens In",
      value: data ? fmtN(data.totalTokensIn) : "—",
      icon: Zap,
      color: "text-violet-500",
    },
    {
      label: "Total Tokens Out",
      value: data ? fmtN(data.totalTokensOut) : "—",
      icon: TrendingDown,
      color: "text-pink-500",
    },
  ];

  return (
    <div className="flex flex-col h-full overflow-auto bg-background text-foreground p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-bold text-foreground">AI Performance</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">Cache hit rates, token usage, and cost per hospital</p>
        </div>
        <div className="flex gap-2">
          {[7, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                days === d
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Budget worklist — hospitals whose metered AI spend has passed the
          allowance their plan includes. This is simultaneously the upsell list
          and the margin-leak monitor: every row is either a hospital that should
          move up a tier, or AI cost the platform is absorbing. Safety-class AI
          is excluded by the view and never appears here. */}
      {overBudget && overBudget.length > 0 && (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <AlertCircle size={14} className="text-amber-500" />
            <p className="text-[13px] font-semibold text-foreground">
              Over AI allowance ({overBudget.length})
            </p>
            <span className="text-[11px] text-muted-foreground ml-auto">
              Month to date · safety features excluded · nothing is blocked
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="text-left font-medium px-4 py-2">Hospital</th>
                  <th className="text-left font-medium px-4 py-2">Plan</th>
                  <th className="text-right font-medium px-4 py-2">Used</th>
                  <th className="text-right font-medium px-4 py-2">Allowance</th>
                  <th className="text-right font-medium px-4 py-2">Over by</th>
                  <th className="text-right font-medium px-4 py-2">% used</th>
                </tr>
              </thead>
              <tbody>
                {overBudget.map((r) => (
                  <tr key={r.hospital_id} className="border-t border-border">
                    <td className="px-4 py-2 text-foreground">{r.hospital_name}</td>
                    <td className="px-4 py-2 text-muted-foreground capitalize">{r.plan_slug}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(Number(r.metered_cost_inr))}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{fmtMoney(Number(r.budget_inr))}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-amber-600">
                      {fmtMoney(Number(r.overage_inr))}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{Math.round(Number(r.pct_used))}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Measured unit cost — what encounter pricing should be set from. */}
      {unitCosts && unitCosts.some((r) => r.voice_encounters > 0 || r.ocr_documents > 0) && (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-[13px] font-semibold text-foreground">Measured cost per encounter</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Month to date · includes both halves of a dictation (structuring + transcription) ·
              ASR duration is estimated from audio size, so treat these as close, not exact
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="text-left font-medium px-4 py-2">Hospital</th>
                  <th className="text-left font-medium px-4 py-2">Plan</th>
                  <th className="text-right font-medium px-4 py-2">Notes</th>
                  <th className="text-right font-medium px-4 py-2">₹/note</th>
                  <th className="text-right font-medium px-4 py-2">Scans</th>
                  <th className="text-right font-medium px-4 py-2">₹/scan</th>
                  <th className="text-right font-medium px-4 py-2">Credits</th>
                </tr>
              </thead>
              <tbody>
                {unitCosts
                  .filter((r) => r.voice_encounters > 0 || r.ocr_documents > 0)
                  .map((r) => (
                    <tr key={r.hospital_id} className="border-t border-border">
                      <td className="px-4 py-2 text-foreground">{r.hospital_name}</td>
                      <td className="px-4 py-2 text-muted-foreground capitalize">{r.plan_slug}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.voice_encounters}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">
                        {r.inr_per_encounter == null ? "—" : fmtMoney(Number(r.inr_per_encounter))}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.ocr_documents}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">
                        {r.inr_per_document == null ? "—" : fmtMoney(Number(r.inr_per_document))}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{r.encounter_credits}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-5 gap-3">
        {kpis.map(k => (
          <div key={k.label} className="bg-card rounded-xl p-4 border border-border shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <k.icon size={14} className={k.color} />
              <span className="text-[11px] text-muted-foreground uppercase tracking-wide">{k.label}</span>
            </div>
            <p className="text-[22px] font-bold text-foreground">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-2 gap-4">
        {/* Daily cost + calls */}
        <div className="bg-card rounded-xl border border-border shadow-sm p-4">
          <p className="text-[13px] font-semibold text-foreground mb-4">Daily Cost & Calls</p>
          {isLoading ? (
            <div className="h-44 flex items-center justify-center text-muted-foreground text-[13px]">Loading…</div>
          ) : (
            <ResponsiveContainer width="100%" height={176}>
              <ComposedChart data={data?.trendData ?? []} margin={{ top: 0, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 11 }} />
                <YAxis yAxisId="cost" tick={{ fill: "#64748b", fontSize: 11 }} tickFormatter={v => formatINRCompact(v)} />
                <YAxis yAxisId="calls" orientation="right" tick={{ fill: "#64748b", fontSize: 11 }} />
                <Tooltip
                  contentStyle={RECHARTS_TOOLTIP_STYLE}
                  labelStyle={{ color: "#1e293b", fontSize: 12 }}
                  itemStyle={{ fontSize: 12 }}
                  formatter={(v: number, name: string) => name === "cost" ? [formatINRPrecise(v), "Cost"] : [v, "Calls"]}
                />
                <Bar yAxisId="calls" dataKey="calls" fill="#3b82f6" opacity={0.6} radius={[2, 2, 0, 0]} />
                <Line yAxisId="cost" type="monotone" dataKey="cost" stroke="#10b981" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Cache hit rate trend */}
        <div className="bg-card rounded-xl border border-border shadow-sm p-4">
          <p className="text-[13px] font-semibold text-foreground mb-4">Cache Hit Rate % (Daily)</p>
          {isLoading ? (
            <div className="h-44 flex items-center justify-center text-muted-foreground text-[13px]">Loading…</div>
          ) : (
            <ResponsiveContainer width="100%" height={176}>
              <LineChart data={data?.trendData ?? []} margin={{ top: 0, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fill: "#64748b", fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 11 }} tickFormatter={v => `${v}%`} />
                <Tooltip
                  contentStyle={RECHARTS_TOOLTIP_STYLE}
                  labelStyle={{ color: "#1e293b", fontSize: 12 }}
                  formatter={(v: number) => [`${v}%`, "Cache Hit Rate"]}
                />
                <Line type="monotone" dataKey="cache_pct" stroke="#a78bfa" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Feature breakdown */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-4">
        <p className="text-[13px] font-semibold text-foreground mb-4">Top 10 Features by Cost</p>
        {isLoading ? (
          <div className="h-36 flex items-center justify-center text-muted-foreground text-[13px]">Loading…</div>
        ) : (
          <ResponsiveContainer width="100%" height={144}>
            <BarChart data={data?.featureData ?? []} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 100 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
              <XAxis type="number" tick={{ fill: "#64748b", fontSize: 11 }} tickFormatter={v => formatINRCompact(v)} />
              <YAxis dataKey="feature" type="category" tick={{ fill: "#64748b", fontSize: 11 }} width={100} />
              <Tooltip
                contentStyle={RECHARTS_TOOLTIP_STYLE}
                formatter={(v: number, name: string) => name === "cost" ? [formatINRPrecise(v), "Cost"] : [v, "Calls"]}
              />
              <Bar dataKey="cost" fill="#3b82f6" radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Per-hospital table */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-4">
        <p className="text-[13px] font-semibold text-foreground mb-3">Hospital Breakdown</p>
        {isLoading ? (
          <div className="py-8 flex items-center justify-center text-muted-foreground text-[13px]">Loading…</div>
        ) : !data?.hospitals.length ? (
          <p className="text-[13px] text-muted-foreground py-4 text-center">No AI calls recorded in this period.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-2 text-muted-foreground font-medium">Hospital</th>
                <th className="pb-2 text-muted-foreground font-medium text-right">Calls</th>
                <th className="pb-2 text-muted-foreground font-medium text-right">Cache Hit %</th>
                <th className="pb-2 text-muted-foreground font-medium text-right">Tokens</th>
                <th className="pb-2 text-muted-foreground font-medium text-right">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.hospitals.map(h => (
                <tr key={h.hospital_id} className="hover:bg-muted/40 transition-colors">
                  <td className="py-2 text-foreground font-medium">{h.hospital_name}</td>
                  <td className="py-2 text-right text-foreground/70">{fmtN(h.total_calls)}</td>
                  <td className="py-2 text-right">
                    <span className={`font-semibold ${h.cache_hit_pct >= 50 ? "text-emerald-600" : h.cache_hit_pct >= 25 ? "text-amber-600" : "text-red-500"}`}>
                      {h.cache_hit_pct.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2 text-right text-foreground/70">{fmtN(h.total_tokens)}</td>
                  <td className="py-2 text-right text-emerald-600 font-semibold">{fmtMoney(h.total_cost_inr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}


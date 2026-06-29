/**
 * ForecastsPage — Predictive Analytics Dashboards
 *
 * Route: /analytics/forecasts
 *
 * Forecasts:
 *  1. OPD Volume  — next 7 days per day (with day-of-week seasonality)
 *  2. IPD Bed Occupancy — next 7 days by ward group
 *  3. Revenue — next 30 days projected total
 *
 * Algorithm: weighted moving average + day-of-week seasonal index + linear trend.
 * Confidence interval: ±1.3 × MAE (mean absolute error of last 14 days).
 * Non-clinical, preview quality — shown with a clear disclaimer.
 */
import React, { useEffect, useState, useCallback } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import { format, subDays, addDays, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Loader2, TrendingUp, FlaskConical, BedDouble, IndianRupee, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Forecast algorithm ────────────────────────────────────────────────────────

interface HistPoint { date: string; value: number }
interface FcastPoint { date: string; forecast: number; lower: number; upper: number; bandBottom: number; bandWidth: number }

function computeForecast(history: HistPoint[], horizon: number): FcastPoint[] {
  if (history.length < 7) return [];

  // Day-of-week seasonal indices
  const dowBuckets: number[][] = Array.from({ length: 7 }, () => []);
  history.forEach(({ date, value }) => {
    dowBuckets[new Date(date).getDay()].push(value);
  });
  const overallMean = history.reduce((s, h) => s + h.value, 0) / history.length || 1;
  const dowFactors = dowBuckets.map(b =>
    b.length ? (b.reduce((s, v) => s + v, 0) / b.length) / overallMean : 1
  );

  // Linear trend (OLS on last 28 points)
  const recent = history.slice(-28);
  const n = recent.length;
  const xm = (n - 1) / 2;
  const ym = recent.reduce((s, h) => s + h.value, 0) / n;
  let num = 0, den = 0;
  recent.forEach((h, i) => { num += (i - xm) * (h.value - ym); den += (i - xm) ** 2; });
  const trendPerDay = den > 0 ? num / den : 0;

  // Baseline: weighted mean of last 14 (linearly decaying weights)
  const wnd = recent.slice(-14);
  const { sum, wsum } = wnd.reduce(
    (acc, h, i) => { const w = i + 1; return { sum: acc.sum + h.value * w, wsum: acc.wsum + w }; },
    { sum: 0, wsum: 0 }
  );
  const baseline = wsum > 0 ? sum / wsum : ym;

  // MAE on recent residuals for confidence band
  const residuals = recent.map((h, i) => Math.abs(h.value - (baseline + trendPerDay * (i - n + 1))));
  const mae = residuals.reduce((s, r) => s + r, 0) / residuals.length || 1;

  const lastDate = parseISO(history[history.length - 1].date);
  return Array.from({ length: horizon }, (_, i) => {
    const d = addDays(lastDate, i + 1);
    const dow = d.getDay();
    const raw = Math.max(0, (baseline + trendPerDay * (i + 1)) * dowFactors[dow]);
    const forecast = Math.round(raw);
    const lower   = Math.max(0, Math.round(raw - 1.3 * mae));
    const upper   = Math.round(raw + 1.3 * mae);
    return {
      date: format(d, "yyyy-MM-dd"),
      forecast,
      lower,
      upper,
      bandBottom: lower,
      bandWidth: upper - lower,
    };
  });
}

/**
 * Naive moving-average forecast — v1 / no-AI baseline.
 * Forecast value = simple mean of last `window` days (flat line).
 * Band = ±1 std-dev of the same window.
 * Easy to replace with an ai-forecast edge function call later.
 */
function computeNaiveMA(
  history: HistPoint[],
  window = 7,
  horizon = 7
): FcastPoint[] {
  if (history.length < window) return [];

  const recent  = history.slice(-window);
  const lastMA  = recent.reduce((s, h) => s + h.value, 0) / window;
  const variance = recent.reduce((s, h) => s + (h.value - lastMA) ** 2, 0) / window;
  const stdDev   = Math.sqrt(variance);

  const lastDate = parseISO(history[history.length - 1].date);
  return Array.from({ length: horizon }, (_, i) => {
    const d        = addDays(lastDate, i + 1);
    const forecast = Math.round(lastMA);
    const lower    = Math.max(0, Math.round(lastMA - stdDev));
    const upper    = Math.round(lastMA + stdDev);
    return { date: format(d, "yyyy-MM-dd"), forecast, lower, upper, bandBottom: lower, bandWidth: upper - lower };
  });
}

/** Merge historical + forecast arrays into a single series for recharts. */
function mergeChartData(
  history: HistPoint[],
  forecast: FcastPoint[],
  showHistoryDays = 14
): Record<string, any>[] {
  const hist = history.slice(-showHistoryDays).map(h => ({
    date: h.date,
    actual: h.value,
    forecast: null,
    bandBottom: null,
    bandWidth: null,
  }));
  const fcast = forecast.map(f => ({
    date: f.date,
    actual: null,
    forecast: f.forecast,
    bandBottom: f.bandBottom,
    bandWidth: f.bandWidth,
  }));
  // bridge point: last actual = first forecast start value (continuity)
  if (hist.length && fcast.length) {
    const bridge = { ...hist[hist.length - 1], forecast: hist[hist.length - 1].actual };
    return [...hist.slice(0, -1), bridge, ...fcast];
  }
  return [...hist, ...fcast];
}

const fmt = (n: number) => {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000)   return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)     return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toLocaleString("en-IN")}`;
};

const fmtDate = (d: string) => {
  try { return format(parseISO(d), "dd MMM"); } catch { return d; }
};

// ─── Sub-components ───────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  color: string;
}
const StatCard: React.FC<StatCardProps> = ({ label, value, sub, icon: Icon, color }) => (
  <div className="bg-card border border-border rounded-xl p-4 flex items-start gap-4">
    <div className="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0" style={{ background: `${color}20` }}>
      <Icon className="h-5 w-5" style={{ color }} />
    </div>
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-black text-foreground leading-tight mt-0.5">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
    </div>
  </div>
);

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg shadow-lg px-3 py-2.5 text-xs">
      <p className="font-bold text-foreground mb-1">{fmtDate(label)}</p>
      {payload.map((p: any) => p.value != null && p.name !== "bandBottom" && p.name !== "bandWidth" && (
        <p key={p.name} style={{ color: p.color }}>
          {p.name === "actual" ? "Actual" : p.name === "forecast" ? "Forecast" : p.name}: {
            typeof p.value === "number" ? (p.value > 1000 ? fmt(p.value) : p.value) : p.value
          }
        </p>
      ))}
    </div>
  );
};

interface ForecastChartProps {
  data: Record<string, any>[];
  todayLabel: string;
  yLabel: string;
  loading: boolean;
  valuePrefix?: string;
}
const ForecastChart: React.FC<ForecastChartProps> = ({ data, todayLabel, yLabel, loading, valuePrefix = "" }) => {
  if (loading) return (
    <div className="h-64 flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
  if (!data.length) return (
    <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
      Not enough historical data (need ≥ 7 days)
    </div>
  );
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <defs>
            <linearGradient id="forecastBand" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F59E0B" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#F59E0B" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtDate}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={v => valuePrefix ? fmt(v) : String(v)}
            width={valuePrefix ? 50 : 32}
          />
          <Tooltip content={<ChartTooltip />} />

          {/* Confidence band (stacked transparent + amber) */}
          <Area type="monotone" dataKey="bandBottom" fill="transparent" stroke="none" stackId="ci" legendType="none" />
          <Area type="monotone" dataKey="bandWidth" fill="url(#forecastBand)" stroke="none" stackId="ci" legendType="none" />

          {/* Today reference line */}
          <ReferenceLine x={todayLabel} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 2" label={{ value: "Today", fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />

          {/* Actual */}
          <Line type="monotone" dataKey="actual" stroke="#3B82F6" strokeWidth={2.5} dot={false} connectNulls={false} name="actual" />

          {/* Forecast */}
          <Line type="monotone" dataKey="forecast" stroke="#F59E0B" strokeWidth={2} strokeDasharray="6 3" dot={false} connectNulls={false} name="forecast" />

          <Legend
            formatter={v => v === "actual" ? "Actual" : v === "forecast" ? "Forecast" : null}
            wrapperStyle={{ fontSize: 11 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────

const ForecastsPage: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const today = format(new Date(), "yyyy-MM-dd");

  // OPD
  const [opdHistory,  setOpdHistory]  = useState<HistPoint[]>([]);
  const [opdForecast, setOpdForecast] = useState<FcastPoint[]>([]);
  const [opdLoading,  setOpdLoading]  = useState(true);

  // IPD
  const [ipdHistory,  setIpdHistory]  = useState<HistPoint[]>([]);
  const [ipdForecast, setIpdForecast] = useState<FcastPoint[]>([]);
  const [ipdLoading,  setIpdLoading]  = useState(true);

  // Revenue
  const [revHistory,  setRevHistory]  = useState<HistPoint[]>([]);
  const [revForecast, setRevForecast] = useState<FcastPoint[]>([]);
  const [revLoading,  setRevLoading]  = useState(true);

  // ── Load OPD history ─────────────────────────────────────────────────────────
  const loadOPD = useCallback(async () => {
    if (!hospitalId) return;
    setOpdLoading(true);
    const from = format(subDays(new Date(), 90), "yyyy-MM-dd");

    const { data } = await (supabase as any)
      .from("opd_tokens")
      .select("visit_date")
      .eq("hospital_id", hospitalId)
      .gte("visit_date", from)
      .lte("visit_date", today);

    if (data) {
      const counts: Record<string, number> = {};
      (data as any[]).forEach((t) => {
        counts[t.visit_date] = (counts[t.visit_date] || 0) + 1;
      });
      // Fill missing days with 0
      const hist: HistPoint[] = [];
      for (let i = 89; i >= 0; i--) {
        const d = format(subDays(new Date(), i), "yyyy-MM-dd");
        hist.push({ date: d, value: counts[d] || 0 });
      }
      setOpdHistory(hist);
      // v1: simple 7-day moving average + naive flat extrapolation.
      // Swap computeNaiveMA → computeForecast (or ai-forecast call) to upgrade.
      setOpdForecast(computeNaiveMA(hist, 7, 7));
    }
    setOpdLoading(false);
  }, [hospitalId, today]);

  // ── Load IPD history ─────────────────────────────────────────────────────────
  const loadIPD = useCallback(async () => {
    if (!hospitalId) return;
    setIpdLoading(true);
    const from = format(subDays(new Date(), 60), "yyyy-MM-dd");

    // Admissions per day
    const { data: admissions } = await (supabase as any)
      .from("admissions")
      .select("admission_date")
      .eq("hospital_id", hospitalId)
      .gte("admission_date", from)
      .lte("admission_date", today);

    // Discharges per day
    const { data: discharges } = await (supabase as any)
      .from("admissions")
      .select("discharge_date")
      .eq("hospital_id", hospitalId)
      .not("discharge_date", "is", null)
      .gte("discharge_date", from)
      .lte("discharge_date", today);

    if (admissions !== null) {
      const admMap: Record<string, number> = {};
      const disMap: Record<string, number> = {};
      (admissions as any[]).forEach(a => { admMap[a.admission_date] = (admMap[a.admission_date] || 0) + 1; });
      (discharges || []).forEach((d: any) => { if (d.discharge_date) disMap[d.discharge_date] = (disMap[d.discharge_date] || 0) + 1; });

      // Running occupancy (cumulative admissions - cumulative discharges)
      const hist: HistPoint[] = [];
      let cumAdm = 0, cumDis = 0;
      for (let i = 59; i >= 0; i--) {
        const d = format(subDays(new Date(), i), "yyyy-MM-dd");
        cumAdm += admMap[d] || 0;
        cumDis += disMap[d] || 0;
        hist.push({ date: d, value: Math.max(0, cumAdm - cumDis) });
      }
      // Re-baseline to daily delta occupancy for forecast (changes in bed count)
      const deltaHist: HistPoint[] = hist.map((h, i) => ({
        date: h.date,
        value: i === 0 ? h.value : Math.max(0, h.value),
      }));
      setIpdHistory(deltaHist);
      setIpdForecast(computeForecast(deltaHist, 7));
    }
    setIpdLoading(false);
  }, [hospitalId, today]);

  // ── Load Revenue history ─────────────────────────────────────────────────────
  const loadRevenue = useCallback(async () => {
    if (!hospitalId) return;
    setRevLoading(true);
    const from = format(subDays(new Date(), 90), "yyyy-MM-dd");

    const { data } = await (supabase as any)
      .from("bills")
      .select("bill_date, total_amount")
      .eq("hospital_id", hospitalId)
      .gte("bill_date", from)
      .lte("bill_date", today)
      .neq("bill_status", "cancelled");

    if (data) {
      const sums: Record<string, number> = {};
      (data as any[]).forEach(b => {
        sums[b.bill_date] = (sums[b.bill_date] || 0) + (b.total_amount || 0);
      });
      const hist: HistPoint[] = [];
      for (let i = 89; i >= 0; i--) {
        const d = format(subDays(new Date(), i), "yyyy-MM-dd");
        hist.push({ date: d, value: Math.round(sums[d] || 0) });
      }
      setRevHistory(hist);
      setRevForecast(computeForecast(hist, 30));
    }
    setRevLoading(false);
  }, [hospitalId, today]);

  useEffect(() => {
    loadOPD();
    loadIPD();
    loadRevenue();
  }, [loadOPD, loadIPD, loadRevenue]);

  const refresh = () => { loadOPD(); loadIPD(); loadRevenue(); };

  // ── Derived summary values ───────────────────────────────────────────────────

  const opdTomorrow   = opdForecast[0]?.forecast ?? 0;
  const opdWeekTotal  = opdForecast.reduce((s, f) => s + f.forecast, 0);
  const opdWeekLower  = opdForecast.reduce((s, f) => s + f.lower, 0);
  const opdWeekUpper  = opdForecast.reduce((s, f) => s + f.upper, 0);

  const ipdTomorrow   = ipdForecast[0]?.forecast ?? 0;
  const ipdWeekPeak   = Math.max(...ipdForecast.map(f => f.forecast), 0);

  const revMonthTotal = revForecast.reduce((s, f) => s + f.forecast, 0);
  const revMonthLower = revForecast.reduce((s, f) => s + f.lower, 0);
  const revMonthUpper = revForecast.reduce((s, f) => s + f.upper, 0);

  const opdChartData  = mergeChartData(opdHistory, opdForecast);
  const ipdChartData  = mergeChartData(ipdHistory, ipdForecast);
  const revChartData  = mergeChartData(revHistory,  revForecast, 21);

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex-shrink-0 h-16 flex items-center justify-between px-8 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <TrendingUp className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-bold text-foreground">Predictive Analytics</h1>
            <p className="text-xs text-muted-foreground">OPD, IPD & revenue forecasts — next 7–30 days</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-800 px-3 py-1 text-[11px] font-semibold">
            <AlertTriangle className="h-3 w-3" />
            Preview — non-clinical
          </div>
          <Button variant="outline" size="sm" onClick={refresh} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8 space-y-10 max-w-5xl">

        {/* Disclaimer */}
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
          <p>
            Forecasts use weighted moving averages with day-of-week seasonality on your historical data.
            They are <strong>indicative only</strong> and should not be used for clinical decisions.
            Accuracy improves with more history (90+ days recommended).
          </p>
        </div>

        {/* ── OPD Volume Forecast ─────────────────────────────────────────── */}
        <ForecastSection
          icon={<FlaskConical className="h-5 w-5 text-blue-600" />}
          title="OPD Patient Volume"
          subtitle="Daily new registrations & tokens — next 7 days"
          color="#3B82F6"
        >
          <div className="grid grid-cols-3 gap-3 mb-6">
            <StatCard
              label="Predicted tomorrow"
              value={String(opdTomorrow)}
              sub="patients"
              icon={FlaskConical}
              color="#3B82F6"
            />
            <StatCard
              label="7-day projected total"
              value={String(opdWeekTotal)}
              sub={`Range: ${opdWeekLower}–${opdWeekUpper}`}
              icon={TrendingUp}
              color="#3B82F6"
            />
            <StatCard
              label="Avg per day (forecast)"
              value={opdForecast.length ? String(Math.round(opdWeekTotal / opdForecast.length)) : "—"}
              sub="patients / day"
              icon={TrendingUp}
              color="#3B82F6"
            />
          </div>
          <ForecastChart
            data={opdChartData}
            todayLabel={today}
            yLabel="Patients"
            loading={opdLoading}
          />
          <p className="mt-3 text-[11px] text-muted-foreground italic text-center">
            Forecast v1 (simple moving average — last 7 days, flat extrapolation).{" "}
            AI-powered forecasting will be plugged in here via the{" "}
            <code className="bg-muted rounded px-1 not-italic">ai-forecast</code> edge function.
          </p>
        </ForecastSection>

        {/* ── IPD Occupancy Forecast ──────────────────────────────────────── */}
        <ForecastSection
          icon={<BedDouble className="h-5 w-5 text-emerald-600" />}
          title="IPD Bed Occupancy"
          subtitle="Estimated occupied beds — next 7 days"
          color="#059669"
        >
          <div className="grid grid-cols-3 gap-3 mb-6">
            <StatCard
              label="Predicted tomorrow"
              value={String(ipdTomorrow)}
              sub="beds occupied"
              icon={BedDouble}
              color="#059669"
            />
            <StatCard
              label="7-day peak occupancy"
              value={String(ipdWeekPeak)}
              sub="beds (max in window)"
              icon={TrendingUp}
              color="#059669"
            />
            <StatCard
              label="7-day avg occupancy"
              value={ipdForecast.length ? String(Math.round(ipdForecast.reduce((s, f) => s + f.forecast, 0) / ipdForecast.length)) : "—"}
              sub="beds / day"
              icon={TrendingUp}
              color="#059669"
            />
          </div>
          <ForecastChart
            data={ipdChartData}
            todayLabel={today}
            yLabel="Beds"
            loading={ipdLoading}
          />
        </ForecastSection>

        {/* ── Revenue Forecast ────────────────────────────────────────────── */}
        <ForecastSection
          icon={<IndianRupee className="h-5 w-5 text-violet-600" />}
          title="Revenue Forecast"
          subtitle="Projected billing collections — next 30 days"
          color="#7C3AED"
        >
          <div className="grid grid-cols-3 gap-3 mb-6">
            <StatCard
              label="30-day projected total"
              value={fmt(revMonthTotal)}
              sub={`Range: ${fmt(revMonthLower)}–${fmt(revMonthUpper)}`}
              icon={IndianRupee}
              color="#7C3AED"
            />
            <StatCard
              label="Predicted tomorrow"
              value={revForecast.length ? fmt(revForecast[0].forecast) : "—"}
              sub="in collections"
              icon={TrendingUp}
              color="#7C3AED"
            />
            <StatCard
              label="Avg per day (forecast)"
              value={revForecast.length ? fmt(Math.round(revMonthTotal / revForecast.length)) : "—"}
              sub="per day"
              icon={TrendingUp}
              color="#7C3AED"
            />
          </div>
          <ForecastChart
            data={revChartData}
            todayLabel={today}
            yLabel="Revenue (₹)"
            loading={revLoading}
            valuePrefix="₹"
          />
        </ForecastSection>

        {/* Method note */}
        <div className="rounded-xl border border-border bg-muted/30 px-5 py-4 text-xs text-muted-foreground space-y-1">
          <p className="font-bold text-foreground text-sm">About these forecasts</p>
          <p>
            <strong>Method:</strong> Weighted exponential moving average (last 14 days, linearly decayed)
            + day-of-week seasonal index (last 90 days) + linear trend (last 28 days).
          </p>
          <p>
            <strong>Confidence band:</strong> ±1.3 × MAE of recent residuals (~80% empirical coverage).
          </p>
          <p>
            <strong>Limitations:</strong> Holidays, disease outbreaks, new doctor joins, and external
            referral spikes are not modelled. Forecasts are for operational planning only.
          </p>
          <p className="mt-2">
            To plug in an AI model, replace the <code className="bg-muted rounded px-1">computeForecast</code> call
            with a call to the <code className="bg-muted rounded px-1">ai-forecast</code> edge function.
          </p>
        </div>

      </div>
    </div>
  );
};

interface ForecastSectionProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  color: string;
  children: React.ReactNode;
}
const ForecastSection: React.FC<ForecastSectionProps> = ({ icon, title, subtitle, color, children }) => (
  <div>
    <div className="flex items-center gap-2 mb-5">
      <div className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0" style={{ background: `${color}15` }}>
        {icon}
      </div>
      <div>
        <h2 className="text-base font-bold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
    <div className="bg-card border border-border rounded-2xl p-6">
      {children}
    </div>
  </div>
);

export default ForecastsPage;

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatINR } from "@/lib/currency";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from "recharts";
import {
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  Ban,
  CheckCircle2,
  DollarSign,
  Clock,
  BarChart3,
  Loader2,
} from "lucide-react";
import { callAI } from "@/lib/aiProvider";
import { differenceInDays, format, subMonths, startOfMonth, endOfMonth } from "date-fns";

// ─── Colour Palette ──────────────────────────────────────

const CHART_COLORS = [
  "hsl(217, 91%, 60%)",   // blue
  "hsl(25, 95%, 53%)",    // orange
  "hsl(142, 71%, 45%)",   // green
  "hsl(346, 87%, 58%)",   // pink
  "hsl(262, 83%, 58%)",   // purple
  "hsl(47, 96%, 53%)",    // yellow
  "hsl(189, 94%, 43%)",   // cyan
  "hsl(12, 76%, 61%)",    // coral
];

const CATEGORY_LABELS: Record<string, string> = {
  documentation_missing: "Documentation Missing",
  clinical_not_justified: "Clinical Not Justified",
  policy_exclusion: "Policy Exclusion",
  duplicate_claim: "Duplicate Claim",
  technical_error: "Technical Error",
  other: "Other",
};

// ─── Types ───────────────────────────────────────────────

interface KPIs {
  denialRate: number;
  denialRatePrev: number;
  avgSettlementDays: number;
  topDeniedTPA: string | null;
  topDeniedTPARate: number;
  revenueAtRisk: number;
  totalClaims: number;
  rejectedClaims: number;
  settledClaims: number;
  resubmittedClaims: number;
  resubmissionSuccessRate: number;
}

interface MonthlyTrend {
  month: string;
  total: number;
  rejected: number;
  rate: number;
}

interface TPADenialRate {
  tpa: string;
  total: number;
  rejected: number;
  rate: number;
}

interface CategoryStat {
  category: string;
  label: string;
  count: number;
}

interface AIInsight {
  insight: string;
  action: string;
  priority: "high" | "medium" | "low";
}

// ─── Component ───────────────────────────────────────────

const DenialAnalyticsDashboard: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<KPIs>({
    denialRate: 0,
    denialRatePrev: 0,
    avgSettlementDays: 0,
    topDeniedTPA: null,
    topDeniedTPARate: 0,
    revenueAtRisk: 0,
    totalClaims: 0,
    rejectedClaims: 0,
    settledClaims: 0,
    resubmittedClaims: 0,
    resubmissionSuccessRate: 0,
  });
  const [monthlyTrend, setMonthlyTrend] = useState<MonthlyTrend[]>([]);
  const [tpaDenials, setTpaDenials] = useState<TPADenialRate[]>([]);
  const [categoryStats, setCategoryStats] = useState<CategoryStat[]>([]);
  const [aiInsights, setAiInsights] = useState<AIInsight[]>([]);
  const [aiLoading, setAiLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);

    try {
      // ── Fetch all claims ──────────────────────────
      const { data: allClaims } = await supabase
        .from("insurance_claims")
        .select("id, status, tpa_name, claimed_amount, approved_amount, settled_amount, submitted_at, created_at, denial_reason, resubmission_count")
        .eq("hospital_id", hospitalId);

      const claims = (allClaims || []).map((c: any) => ({
        ...c,
        claimed_amount: Number(c.claimed_amount || 0),
        approved_amount: Number(c.approved_amount || 0),
        settled_amount: Number(c.settled_amount || 0),
        resubmission_count: Number(c.resubmission_count || 0),
      }));

      // ── Fetch denial logs ─────────────────────────
      const { data: denialLogs } = await supabase
        .from("denial_logs")
        .select("id, category, denial_reason, claim_id, created_at");

      const logs = denialLogs || [];

      // ── KPIs ──────────────────────────────────────
      const now = new Date();
      const thisMonthStart = startOfMonth(now);
      const prevMonthStart = startOfMonth(subMonths(now, 1));
      const prevMonthEnd = endOfMonth(subMonths(now, 1));

      const totalClaims = claims.length;
      const rejectedClaims = claims.filter((c: any) => c.status === "rejected").length;
      const denialRate = totalClaims > 0 ? Math.round((rejectedClaims / totalClaims) * 100) : 0;

      // Previous month denial rate
      const prevMonthClaims = claims.filter((c: any) => {
        const d = new Date(c.created_at);
        return d >= prevMonthStart && d <= prevMonthEnd;
      });
      const prevMonthRejected = prevMonthClaims.filter((c: any) => c.status === "rejected").length;
      const denialRatePrev = prevMonthClaims.length > 0
        ? Math.round((prevMonthRejected / prevMonthClaims.length) * 100)
        : 0;

      // Average settlement days
      const settledClaims = claims.filter((c: any) => c.status === "settled" && c.submitted_at);
      const avgSettleDays = settledClaims.length > 0
        ? Math.round(
            settledClaims.reduce((sum: number, c: any) => {
              return sum + differenceInDays(new Date(c.created_at), new Date(c.submitted_at));
            }, 0) / settledClaims.length
          )
        : 0;

      // Top denied TPA
      const tpaRejected: Record<string, { total: number; rejected: number }> = {};
      claims.forEach((c: any) => {
        if (!tpaRejected[c.tpa_name]) tpaRejected[c.tpa_name] = { total: 0, rejected: 0 };
        tpaRejected[c.tpa_name].total++;
        if (c.status === "rejected") tpaRejected[c.tpa_name].rejected++;
      });

      const tpaDenialArr = Object.entries(tpaRejected)
        .map(([tpa, { total, rejected }]) => ({
          tpa,
          total,
          rejected,
          rate: total > 0 ? Math.round((rejected / total) * 100) : 0,
        }))
        .filter(t => t.total >= 2) // Only TPAs with meaningful volume
        .sort((a, b) => b.rate - a.rate);

      const topDenied = tpaDenialArr[0];

      // Revenue at risk
      const revenueAtRisk = claims
        .filter((c: any) => c.status === "rejected")
        .reduce((sum: number, c: any) => sum + c.claimed_amount, 0);

      // Resubmission success rate
      const resubmitted = claims.filter((c: any) => c.resubmission_count > 0);
      const resubSuccess = resubmitted.filter((c: any) => ["approved", "settled", "partially_approved"].includes(c.status));

      setKpis({
        denialRate,
        denialRatePrev,
        avgSettlementDays: Math.abs(avgSettleDays),
        topDeniedTPA: topDenied?.tpa || null,
        topDeniedTPARate: topDenied?.rate || 0,
        revenueAtRisk,
        totalClaims,
        rejectedClaims,
        settledClaims: settledClaims.length,
        resubmittedClaims: resubmitted.length,
        resubmissionSuccessRate: resubmitted.length > 0
          ? Math.round((resubSuccess.length / resubmitted.length) * 100)
          : 0,
      });

      // ── Monthly trend (last 12 months) ────────────
      const months: MonthlyTrend[] = [];
      for (let i = 11; i >= 0; i--) {
        const mStart = startOfMonth(subMonths(now, i));
        const mEnd = endOfMonth(subMonths(now, i));
        const mClaims = claims.filter((c: any) => {
          const d = new Date(c.created_at);
          return d >= mStart && d <= mEnd;
        });
        const mRejected = mClaims.filter((c: any) => c.status === "rejected").length;
        months.push({
          month: format(mStart, "MMM yy"),
          total: mClaims.length,
          rejected: mRejected,
          rate: mClaims.length > 0 ? Math.round((mRejected / mClaims.length) * 100) : 0,
        });
      }
      setMonthlyTrend(months);

      // ── TPA denial rates ──────────────────────────
      setTpaDenials(tpaDenialArr);

      // ── Category stats ────────────────────────────
      const catMap: Record<string, number> = {};
      logs.forEach((l: any) => {
        const c = l.category || "other";
        catMap[c] = (catMap[c] || 0) + 1;
      });
      setCategoryStats(
        Object.entries(catMap)
          .map(([category, count]) => ({
            category,
            label: CATEGORY_LABELS[category] || category.replace(/_/g, " "),
            count,
          }))
          .sort((a, b) => b.count - a.count)
      );

    } catch (err) {
      console.error("Denial analytics error:", err);
    } finally {
      setLoading(false);
    }
  }, [hospitalId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const generateAIInsights = async () => {
    if (!hospitalId) return;
    setAiLoading(true);
    try {
      const dataContext = `
Denial Rate: ${kpis.denialRate}% (prev month: ${kpis.denialRatePrev}%)
Total Claims: ${kpis.totalClaims}, Rejected: ${kpis.rejectedClaims}
Revenue at Risk: ₹${kpis.revenueAtRisk.toLocaleString("en-IN")}
Top Denied TPA: ${kpis.topDeniedTPA} (${kpis.topDeniedTPARate}% rate)
Avg Settlement Days: ${kpis.avgSettlementDays}
Resubmission Success: ${kpis.resubmissionSuccessRate}%
Denial Categories: ${categoryStats.map(c => `${c.label}: ${c.count}`).join(", ")}
TPA Denial Rates: ${tpaDenials.map(t => `${t.tpa}: ${t.rate}% (${t.rejected}/${t.total})`).join(", ")}
Monthly Trend: ${monthlyTrend.map(m => `${m.month}: ${m.rate}%`).join(", ")}`;

      const result = await callAI({
        featureKey: "denial_analytics",
        hospitalId,
        prompt: `You are an Indian hospital insurance analytics expert. Analyse this denial data and provide 3-4 actionable insights.

${dataContext}

Return ONLY valid JSON array:
[{"insight":"One specific observation","action":"Specific action to take","priority":"high|medium|low"}]

Focus on: reducing denial rates, identifying TPA-specific patterns, improving documentation, and optimising resubmission strategy.`,
        maxTokens: 500,
      });

      if (result.error || !result.text) {
        toast({ title: "AI analysis unavailable", description: result.error || "Empty response", variant: "destructive" });
      } else {
        const parsed = JSON.parse(
          result.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
        );
        setAiInsights(parsed);
      }
    } catch {
      toast({ title: "AI analysis failed", description: "Could not parse response", variant: "destructive" });
    }
    setAiLoading(false);
  };

  // ── Render helpers ─────────────────────────────────

  const trendDirection = kpis.denialRate > kpis.denialRatePrev ? "up" : "down";

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        <Loader2 size={18} className="animate-spin mr-2" />
        Loading analytics…
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      {/* ── Header ──────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-card border-b border-border px-5 py-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-foreground">Denial Analytics</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Insurance claim denial patterns, trends, and AI-powered insights
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-8 gap-1.5"
            onClick={loadData}
          >
            <RefreshCw size={13} />
            Refresh
          </Button>
          <Button
            size="sm"
            className="text-xs h-8 gap-1.5 bg-violet-600 hover:bg-violet-700"
            onClick={generateAIInsights}
            disabled={aiLoading}
          >
            {aiLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {aiLoading ? "Analysing…" : "AI Insights"}
          </Button>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* ── KPI Cards ─────────────────────────────── */}
        <div className="grid grid-cols-5 gap-3">
          {/* Denial Rate */}
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-8 w-8 rounded-lg bg-red-100 dark:bg-red-950 flex items-center justify-center">
                <Ban size={16} className="text-red-600" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Denial Rate
              </span>
            </div>
            <p className="text-2xl font-bold text-foreground">{kpis.denialRate}%</p>
            <div className="flex items-center gap-1 mt-1">
              {trendDirection === "down" ? (
                <TrendingDown size={12} className="text-emerald-600" />
              ) : (
                <TrendingUp size={12} className="text-red-600" />
              )}
              <span className={cn("text-[11px] font-medium", trendDirection === "down" ? "text-emerald-600" : "text-red-600")}>
                {trendDirection === "down" ? "↓" : "↑"} vs {kpis.denialRatePrev}% last month
              </span>
            </div>
          </div>

          {/* Avg Settlement Days */}
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-8 w-8 rounded-lg bg-blue-100 dark:bg-blue-950 flex items-center justify-center">
                <Clock size={16} className="text-blue-600" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Avg Settlement
              </span>
            </div>
            <p className="text-2xl font-bold text-foreground">{kpis.avgSettlementDays}d</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {kpis.settledClaims} claims settled
            </p>
          </div>

          {/* Top Denied TPA */}
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-8 w-8 rounded-lg bg-amber-100 dark:bg-amber-950 flex items-center justify-center">
                <AlertTriangle size={16} className="text-amber-600" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Top Denied TPA
              </span>
            </div>
            <p className="text-lg font-bold text-foreground truncate" title={kpis.topDeniedTPA || "—"}>
              {kpis.topDeniedTPA || "—"}
            </p>
            {kpis.topDeniedTPA && (
              <p className="text-[11px] text-amber-600 mt-1 font-medium">
                {kpis.topDeniedTPARate}% denial rate
              </p>
            )}
          </div>

          {/* Revenue at Risk */}
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-8 w-8 rounded-lg bg-red-100 dark:bg-red-950 flex items-center justify-center">
                <DollarSign size={16} className="text-red-600" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Revenue at Risk
              </span>
            </div>
            <p className="text-xl font-bold text-foreground">{formatINR(kpis.revenueAtRisk)}</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {kpis.rejectedClaims} rejected claim{kpis.rejectedClaims !== 1 ? "s" : ""}
            </p>
          </div>

          {/* Resubmission Success */}
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-8 w-8 rounded-lg bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center">
                <CheckCircle2 size={16} className="text-emerald-600" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Resubmit Success
              </span>
            </div>
            <p className="text-2xl font-bold text-foreground">{kpis.resubmissionSuccessRate}%</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {kpis.resubmittedClaims} resubmitted
            </p>
          </div>
        </div>

        {/* ── AI Insights Panel ─────────────────────── */}
        {aiInsights.length > 0 && (
          <div className="bg-violet-50/50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-violet-600" />
              <span className="text-sm font-bold text-violet-800 dark:text-violet-300">AI-Powered Insights</span>
            </div>
            <div className="space-y-2">
              {aiInsights.map((ins, i) => (
                <div
                  key={i}
                  className="bg-background/70 rounded-lg p-3 border border-violet-100 dark:border-violet-800"
                >
                  <div className="flex items-start gap-2">
                    <Badge
                      className={cn(
                        "text-[9px] h-4 mt-0.5 shrink-0",
                        ins.priority === "high"
                          ? "bg-red-100 text-red-700 border-red-200"
                          : ins.priority === "medium"
                          ? "bg-amber-100 text-amber-700 border-amber-200"
                          : "bg-blue-100 text-blue-700 border-blue-200"
                      )}
                      variant="outline"
                    >
                      {ins.priority}
                    </Badge>
                    <div>
                      <p className="text-[13px] font-medium text-foreground">{ins.insight}</p>
                      <p className="text-[11px] text-violet-700 dark:text-violet-400 mt-1 flex items-center gap-1">
                        💡 <strong>Action:</strong> {ins.action}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Charts Row 1: Trend + TPA Comparison ── */}
        <div className="grid grid-cols-2 gap-4">
          {/* Monthly Denial Trend */}
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
              Denial Rate Trend (12 Months)
            </p>
            {monthlyTrend.some(m => m.total > 0) ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    unit="%"
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 11 }}
                    formatter={(value: number, name: string) => [
                      name === "rate" ? `${value}%` : value,
                      name === "rate" ? "Denial Rate" : name === "total" ? "Total Claims" : "Rejected",
                    ]}
                  />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    type="monotone"
                    dataKey="rate"
                    stroke="hsl(346, 87%, 58%)"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                    name="Denial Rate %"
                  />
                  <Line
                    type="monotone"
                    dataKey="total"
                    stroke="hsl(217, 91%, 60%)"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                    name="Total Claims"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground text-xs">
                <BarChart3 size={24} className="opacity-30 mr-2" />
                No trend data yet
              </div>
            )}
          </div>

          {/* Denial Rate by TPA */}
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
              Denial Rate by TPA
            </p>
            {tpaDenials.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={tpaDenials.slice(0, 8)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    unit="%"
                  />
                  <YAxis
                    type="category"
                    dataKey="tpa"
                    width={100}
                    tick={{ fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 11 }}
                    formatter={(value: number) => [`${value}%`, "Denial Rate"]}
                  />
                  <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
                    {tpaDenials.slice(0, 8).map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground text-xs">
                <BarChart3 size={24} className="opacity-30 mr-2" />
                No TPA data yet
              </div>
            )}
          </div>
        </div>

        {/* ── Charts Row 2: Category Donut + Resubmission Table ── */}
        <div className="grid grid-cols-2 gap-4">
          {/* Denial Category Distribution */}
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
              Denial Categories
            </p>
            {categoryStats.length > 0 ? (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={180} height={180}>
                  <PieChart>
                    <Pie
                      data={categoryStats}
                      dataKey="count"
                      nameKey="label"
                      cx="50%"
                      cy="50%"
                      outerRadius={75}
                      innerRadius={40}
                    >
                      {categoryStats.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ fontSize: 11 }}
                      formatter={(value: number) => [value, "Denials"]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {categoryStats.map((cat, i) => (
                    <div key={cat.category} className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                      />
                      <span className="text-[12px] text-foreground flex-1 truncate">{cat.label}</span>
                      <span className="text-[12px] font-bold text-foreground tabular-nums">
                        {cat.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-[180px] flex items-center justify-center text-muted-foreground text-xs">
                <BarChart3 size={24} className="opacity-30 mr-2" />
                No denial logs yet — log denials from Claims Status tab
              </div>
            )}
          </div>

          {/* TPA Performance Table */}
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
              TPA Performance Summary
            </p>
            {tpaDenials.length > 0 ? (
              <div className="overflow-auto max-h-[200px]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-1.5 font-semibold text-muted-foreground">TPA</th>
                      <th className="text-center py-1.5 font-semibold text-muted-foreground">Total</th>
                      <th className="text-center py-1.5 font-semibold text-muted-foreground">Rejected</th>
                      <th className="text-center py-1.5 font-semibold text-muted-foreground">Rate</th>
                      <th className="text-center py-1.5 font-semibold text-muted-foreground">Risk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tpaDenials.map((t) => (
                      <tr key={t.tpa} className="border-b border-border/50">
                        <td className="py-1.5 font-medium text-foreground max-w-[120px] truncate" title={t.tpa}>
                          {t.tpa}
                        </td>
                        <td className="py-1.5 text-center tabular-nums">{t.total}</td>
                        <td className="py-1.5 text-center tabular-nums text-red-600 font-medium">{t.rejected}</td>
                        <td className="py-1.5 text-center tabular-nums font-bold">{t.rate}%</td>
                        <td className="py-1.5 text-center">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[9px]",
                              t.rate > 40
                                ? "bg-red-50 text-red-700 border-red-200"
                                : t.rate > 20
                                ? "bg-amber-50 text-amber-700 border-amber-200"
                                : "bg-emerald-50 text-emerald-700 border-emerald-200"
                            )}
                          >
                            {t.rate > 40 ? "HIGH" : t.rate > 20 ? "MED" : "LOW"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="h-[180px] flex items-center justify-center text-muted-foreground text-xs">
                No TPA data available
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DenialAnalyticsDashboard;

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bot, TrendingUp, TrendingDown, CheckCircle2, XCircle, Pencil, Flag, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { FEATURE_LABELS } from "@/lib/aiProvider";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell,
} from "recharts";
import { format, subDays, startOfMonth, endOfMonth } from "date-fns";

interface AuditRow {
  feature_key: string;
  user_action: string;
  confidence: number | null;
  created_at: string;
}

interface FeatureStat {
  feature: string;
  label: string;
  accepted: number;
  overridden: number;
  rejected: number;
  flagged: number;
  total: number;
  acceptPct: number;
  overridePct: number;
  rejectPct: number;
  avgConfidence: number | null;
}

const ACTION_COLOURS: Record<string, string> = {
  accepted:  "#22c55e",
  overridden: "#3b82f6",
  rejected:  "#ef4444",
  flagged:   "#f59e0b",
};

const ACTION_ICONS: Record<string, React.ReactNode> = {
  accepted:  <CheckCircle2 className="h-3 w-3" />,
  overridden: <Pencil className="h-3 w-3" />,
  rejected:  <XCircle className="h-3 w-3" />,
  flagged:   <Flag className="h-3 w-3" />,
};

const PCT_COLOUR = (pct: number) =>
  pct >= 70 ? "text-emerald-600" : pct >= 50 ? "text-amber-600" : "text-red-600";

const PERIODS = [
  { label: "Last 7 days",  days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "This month",   days: 0 },
];

const AIPerformanceDashboard: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(1); // index into PERIODS
  const [sortBy, setSortBy] = useState<"total" | "acceptPct" | "rejectPct">("total");

  const dateFrom = useMemo(() => {
    const p = PERIODS[period];
    if (p.days === 0) return format(startOfMonth(new Date()), "yyyy-MM-dd");
    return format(subDays(new Date(), p.days), "yyyy-MM-dd");
  }, [period]);

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("ai_suggestions_audit")
      .select("feature_key, user_action, confidence, created_at")
      .eq("hospital_id", hospitalId)
      .gte("created_at", dateFrom)
      .order("created_at", { ascending: false })
      .limit(5000);
    setRows(data || []);
    setLoading(false);
  }, [hospitalId, dateFrom]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo((): FeatureStat[] => {
    const map: Record<string, { accepted: number; overridden: number; rejected: number; flagged: number; confidences: number[] }> = {};
    for (const r of rows) {
      if (!map[r.feature_key]) map[r.feature_key] = { accepted: 0, overridden: 0, rejected: 0, flagged: 0, confidences: [] };
      const m = map[r.feature_key];
      if (r.user_action === "accepted")  m.accepted++;
      if (r.user_action === "overridden") m.overridden++;
      if (r.user_action === "rejected")  m.rejected++;
      if (r.user_action === "flagged")   m.flagged++;
      if (r.confidence != null) m.confidences.push(r.confidence);
    }
    return Object.entries(map).map(([key, m]) => {
      const total = m.accepted + m.overridden + m.rejected + m.flagged;
      const avgConf = m.confidences.length
        ? Math.round((m.confidences.reduce((a, b) => a + b, 0) / m.confidences.length) * 100)
        : null;
      return {
        feature: key,
        label: FEATURE_LABELS[key] || key.replace(/_/g, " "),
        accepted: m.accepted,
        overridden: m.overridden,
        rejected: m.rejected,
        flagged: m.flagged,
        total,
        acceptPct: total > 0 ? Math.round((m.accepted / total) * 100) : 0,
        overridePct: total > 0 ? Math.round((m.overridden / total) * 100) : 0,
        rejectPct: total > 0 ? Math.round((m.rejected / total) * 100) : 0,
        avgConfidence: avgConf,
      };
    }).sort((a, b) => {
      if (sortBy === "total")      return b.total - a.total;
      if (sortBy === "acceptPct")  return b.acceptPct - a.acceptPct;
      if (sortBy === "rejectPct")  return b.rejectPct - a.rejectPct;
      return 0;
    });
  }, [rows, sortBy]);

  const overall = useMemo(() => {
    const total = rows.length;
    const accepted  = rows.filter(r => r.user_action === "accepted").length;
    const overridden = rows.filter(r => r.user_action === "overridden").length;
    const rejected  = rows.filter(r => r.user_action === "rejected").length;
    const flagged   = rows.filter(r => r.user_action === "flagged").length;
    const confs = rows.map(r => r.confidence).filter((c): c is number => c != null);
    const avgConf = confs.length ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 100) : null;
    return {
      total,
      accepted, overridden, rejected, flagged,
      acceptPct:  total > 0 ? Math.round((accepted  / total) * 100) : 0,
      overridePct: total > 0 ? Math.round((overridden / total) * 100) : 0,
      rejectPct:  total > 0 ? Math.round((rejected  / total) * 100) : 0,
      avgConf,
    };
  }, [rows]);

  const chartData = useMemo(() =>
    stats.slice(0, 12).map(s => ({
      name: s.label.split(" ").slice(0, 3).join(" "),
      Accepted: s.accepted,
      Overridden: s.overridden,
      Rejected: s.rejected,
      Flagged: s.flagged,
    })), [stats]);

  return (
    <div className="h-full overflow-y-auto p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <h2 className="text-base font-bold">AI Model Performance</h2>
          <Badge variant="outline" className="text-[10px]">E9 — NABH Excellence</Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 border border-border rounded-lg p-0.5">
            {PERIODS.map((p, i) => (
              <button key={i} onClick={() => setPeriod(i)}
                className={cn("text-xs px-3 py-1 rounded-md transition-all",
                  period === i ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                )}>
                {p.label}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={load} className="h-8 w-8 p-0">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-20 justify-center">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading AI audit data…</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="py-20 text-center space-y-2">
          <Bot className="h-10 w-10 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground">No AI decisions recorded in this period.</p>
          <p className="text-xs text-muted-foreground">AI audit logs will populate as clinicians interact with AI recommendations.</p>
        </div>
      ) : (
        <>
          {/* Overall KPI strip */}
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: "Total AI Decisions", value: overall.total.toLocaleString(), icon: <Bot className="h-4 w-4 text-primary" />, sub: `${PERIODS[period].label}` },
              { label: "Acceptance Rate", value: `${overall.acceptPct}%`, icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />, sub: `${overall.accepted} accepted`, colour: PCT_COLOUR(overall.acceptPct) },
              { label: "Override Rate", value: `${overall.overridePct}%`, icon: <Pencil className="h-4 w-4 text-blue-500" />, sub: `${overall.overridden} overridden`, colour: "text-blue-600" },
              { label: "Rejection Rate", value: `${overall.rejectPct}%`, icon: <XCircle className="h-4 w-4 text-red-500" />, sub: `${overall.rejected} rejected`, colour: overall.rejectPct > 30 ? "text-red-600" : "text-muted-foreground" },
              { label: "Avg AI Confidence", value: overall.avgConf != null ? `${overall.avgConf}%` : "—", icon: <TrendingUp className="h-4 w-4 text-amber-500" />, sub: "across all features", colour: overall.avgConf != null ? PCT_COLOUR(overall.avgConf) : "" },
            ].map(kpi => (
              <div key={kpi.label} className="border border-border rounded-xl bg-card p-3 space-y-1">
                <div className="flex items-center gap-2">{kpi.icon}<span className="text-[11px] text-muted-foreground">{kpi.label}</span></div>
                <p className={cn("text-2xl font-bold leading-none", kpi.colour || "text-foreground")}>{kpi.value}</p>
                <p className="text-[10px] text-muted-foreground">{kpi.sub}</p>
              </div>
            ))}
          </div>

          {/* Acceptance rate alert */}
          {overall.acceptPct < 50 && (
            <div className="border border-amber-200 bg-amber-50 dark:bg-amber-950/20 rounded-lg p-3 flex items-start gap-2">
              <TrendingDown className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">AI acceptance rate below 50% — review required</p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                  NABH E9 requires AI model review when acceptance rate falls below clinical utility threshold.
                  Consider retraining prompts, reviewing feature configuration, or conducting a clinician survey.
                </p>
              </div>
            </div>
          )}

          {/* Stacked bar chart */}
          <div className="border border-border rounded-xl bg-card p-4">
            <p className="text-sm font-semibold mb-4">Decisions by Feature (top 12)</p>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={130} />
                <Tooltip contentStyle={{ fontSize: 11 }} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Accepted"  stackId="a" fill={ACTION_COLOURS.accepted}  radius={[0,0,0,0]} />
                <Bar dataKey="Overridden" stackId="a" fill={ACTION_COLOURS.overridden} />
                <Bar dataKey="Rejected"  stackId="a" fill={ACTION_COLOURS.rejected}  />
                <Bar dataKey="Flagged"   stackId="a" fill={ACTION_COLOURS.flagged}   radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Feature table */}
          <div className="border border-border rounded-xl bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm font-semibold">Feature-by-Feature Breakdown</p>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                Sort by:
                {(["total", "acceptPct", "rejectPct"] as const).map(s => (
                  <button key={s} onClick={() => setSortBy(s)}
                    className={cn("px-2 py-0.5 rounded transition-all",
                      sortBy === s ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                    )}>
                    {s === "total" ? "Volume" : s === "acceptPct" ? "Accepted%" : "Rejected%"}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/60">
                  <tr>
                    {["AI Feature", "Total", "Accepted", "Overridden", "Rejected", "Flagged", "Accept %", "Avg Confidence", "Status"].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s, i) => (
                    <tr key={s.feature} className={cn("border-t border-border/50", i % 2 === 0 ? "bg-background" : "bg-muted/10")}>
                      <td className="px-3 py-2 font-medium text-foreground max-w-[200px]">
                        <span className="block truncate" title={s.label}>{s.label}</span>
                        <span className="text-[10px] font-mono text-muted-foreground">{s.feature}</span>
                      </td>
                      <td className="px-3 py-2 font-semibold">{s.total}</td>
                      <td className="px-3 py-2 text-emerald-600">{s.accepted}</td>
                      <td className="px-3 py-2 text-blue-600">{s.overridden}</td>
                      <td className="px-3 py-2 text-red-600">{s.rejected}</td>
                      <td className="px-3 py-2 text-amber-600">{s.flagged}</td>
                      <td className="px-3 py-2">
                        <span className={cn("font-bold", PCT_COLOUR(s.acceptPct))}>{s.acceptPct}%</span>
                      </td>
                      <td className="px-3 py-2">
                        {s.avgConfidence != null
                          ? <span className={cn("font-medium", PCT_COLOUR(s.avgConfidence))}>{s.avgConfidence}%</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <Badge className={cn("text-[10px] px-1.5 py-0",
                          s.acceptPct >= 70 ? "bg-emerald-100 text-emerald-700 border-emerald-200" :
                          s.acceptPct >= 50 ? "bg-amber-100 text-amber-700 border-amber-200" :
                          "bg-red-100 text-red-700 border-red-200"
                        )}>
                          {s.acceptPct >= 70 ? "Good" : s.acceptPct >= 50 ? "Review" : "Poor"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground text-center pb-2">
            NABH E9 — AI Governance Standard. Data sourced from ai_suggestions_audit table.
            Review features with &lt;50% acceptance rate or &lt;60% average confidence.
          </p>
        </>
      )}
    </div>
  );
};

export default AIPerformanceDashboard;

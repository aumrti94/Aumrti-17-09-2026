import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { formatDateForQuery } from "@/pages/ot/OTPage";

interface Props {
  hospitalId: string | null;
}

interface UtilStats {
  total: number;
  completed: number;
  cancelled: number;
  in_progress: number;
  avgDurationMin: number;
  utilizationPct: number;
  byCategory: Record<string, number>;
  bySurgeon: Array<{ name: string; count: number }>;
  busyDays: Array<{ date: string; count: number }>;
}

const CATEGORY_COLORS: Record<string, string> = {
  general: "bg-slate-400",
  orthopaedic: "bg-blue-500",
  gynaecology: "bg-pink-400",
  neurosurgery: "bg-purple-500",
  cardiothoracic: "bg-red-500",
  emergency: "bg-orange-500",
};

const OTUtilizationTab: React.FC<Props> = ({ hospitalId }) => {
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);

  const [fromDate, setFromDate] = useState(formatDateForQuery(thirtyDaysAgo));
  const [toDate, setToDate] = useState(formatDateForQuery(today));
  const [stats, setStats] = useState<UtilStats | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchStats = useCallback(async () => {
    if (!hospitalId || !fromDate || !toDate) return;
    setLoading(true);

    const { data } = await (supabase as any)
      .from("ot_schedules")
      .select("status, surgery_category, estimated_duration_minutes, actual_start_time, actual_end_time, scheduled_date, surgeon:users!ot_schedules_surgeon_id_fkey(full_name)")
      .gte("scheduled_date", fromDate)
      .lte("scheduled_date", toDate)
      .order("scheduled_date");

    if (!data) { setLoading(false); return; }

    const total = data.length;
    const completed = data.filter((s: any) => s.status === "completed").length;
    const cancelled = data.filter((s: any) => s.status === "cancelled").length;
    const inProgress = data.filter((s: any) => s.status === "in_progress").length;

    // Average duration from actual times where available, else estimated
    const durationsWithData = data
      .filter((s: any) => s.actual_start_time && s.actual_end_time)
      .map((s: any) => (new Date(s.actual_end_time).getTime() - new Date(s.actual_start_time).getTime()) / 60000);

    const avgDurationMin = durationsWithData.length > 0
      ? Math.round(durationsWithData.reduce((a: number, b: number) => a + b, 0) / durationsWithData.length)
      : Math.round(data.reduce((s: number, c: any) => s + (c.estimated_duration_minutes || 0), 0) / Math.max(data.length, 1));

    // Utilization: assume 14 working hours/day, count distinct days in range
    const days = Math.max(1, Math.ceil((new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86400000) + 1);
    const totalAvailMin = days * 14 * 60;
    const usedMin = data
      .filter((s: any) => ["completed", "in_progress"].includes(s.status))
      .reduce((sum: number, s: any) => sum + (s.estimated_duration_minutes || 0), 0);
    const utilizationPct = Math.min(100, Math.round((usedMin / totalAvailMin) * 100));

    // By category
    const byCategory: Record<string, number> = {};
    data.forEach((s: any) => {
      const cat = s.surgery_category || "general";
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });

    // By surgeon (top 5)
    const surgeonMap: Record<string, number> = {};
    data.forEach((s: any) => {
      const name = s.surgeon?.full_name || "Unknown";
      surgeonMap[name] = (surgeonMap[name] || 0) + 1;
    });
    const bySurgeon = Object.entries(surgeonMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    // Busiest days (top 5)
    const dayMap: Record<string, number> = {};
    data.forEach((s: any) => {
      dayMap[s.scheduled_date] = (dayMap[s.scheduled_date] || 0) + 1;
    });
    const busyDays = Object.entries(dayMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([date, count]) => ({ date, count }));

    setStats({ total, completed, cancelled, in_progress: inProgress, avgDurationMin, utilizationPct, byCategory, bySurgeon, busyDays });
    setLoading(false);
  }, [hospitalId, fromDate, toDate]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const maxCatCount = stats ? Math.max(...Object.values(stats.byCategory), 1) : 1;
  const maxSurgeonCount = stats ? Math.max(...stats.bySurgeon.map((s) => s.count), 1) : 1;

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Date range */}
      <div className="flex items-center gap-3 bg-muted/40 rounded-lg px-4 py-2.5">
        <span className="text-xs font-medium text-muted-foreground">From</span>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="text-xs bg-background border border-border rounded px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <span className="text-xs text-muted-foreground">To</span>
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="text-xs bg-background border border-border rounded px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          onClick={fetchStats}
          className="ml-auto text-[11px] bg-primary text-white px-3 py-1.5 rounded-md font-semibold hover:bg-primary/90 active:scale-95 transition-all"
        >
          {loading ? "Loading…" : "Apply"}
        </button>
      </div>

      {!stats && !loading && (
        <p className="text-xs text-muted-foreground text-center py-8">Select a date range and click Apply</p>
      )}

      {stats && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total Cases", value: stats.total, color: "text-foreground" },
              { label: "Completed", value: stats.completed, color: "text-emerald-600" },
              { label: "Cancelled", value: stats.cancelled, color: "text-destructive" },
              { label: "Avg Duration", value: `${stats.avgDurationMin}m`, color: "text-blue-600" },
              { label: "Utilization", value: `${stats.utilizationPct}%`, color: stats.utilizationPct > 80 ? "text-emerald-600" : stats.utilizationPct > 50 ? "text-amber-600" : "text-destructive" },
              { label: "Cancel Rate", value: stats.total > 0 ? `${Math.round((stats.cancelled / stats.total) * 100)}%` : "0%", color: "text-rose-600" },
            ].map((k) => (
              <div key={k.label} className="bg-muted/40 rounded-lg p-2.5 text-center">
                <p className={cn("text-xl font-bold", k.color)}>{k.value}</p>
                <p className="text-[10px] text-muted-foreground">{k.label}</p>
              </div>
            ))}
          </div>

          {/* Utilization bar */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground font-medium">OT Utilization</span>
              <span className="text-[11px] font-bold text-foreground">{stats.utilizationPct}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  stats.utilizationPct > 80 ? "bg-emerald-500" :
                  stats.utilizationPct > 50 ? "bg-amber-400" : "bg-destructive/60"
                )}
                style={{ width: `${stats.utilizationPct}%` }}
              />
            </div>
            <p className="text-[9px] text-muted-foreground mt-0.5">Based on 14-hour OT window per day</p>
          </div>

          {/* By surgery category */}
          {Object.keys(stats.byCategory).length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground mb-2 tracking-wide">Cases by Category</p>
              <div className="space-y-1.5">
                {Object.entries(stats.byCategory)
                  .sort(([, a], [, b]) => b - a)
                  .map(([cat, count]) => (
                    <div key={cat} className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground capitalize w-24 shrink-0">{cat}</span>
                      <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                        <div
                          className={cn("h-full rounded transition-all", CATEGORY_COLORS[cat] || "bg-slate-400")}
                          style={{ width: `${(count / maxCatCount) * 100}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-semibold text-foreground w-6 text-right">{count}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Top surgeons */}
          {stats.bySurgeon.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground mb-2 tracking-wide">Top Surgeons</p>
              <div className="space-y-1.5">
                {stats.bySurgeon.map((s) => (
                  <div key={s.name} className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground truncate w-32 shrink-0">Dr. {s.name}</span>
                    <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                      <div
                        className="h-full rounded bg-primary/60 transition-all"
                        style={{ width: `${(s.count / maxSurgeonCount) * 100}%` }}
                      />
                    </div>
                    <span className="text-[11px] font-semibold text-foreground w-6 text-right">{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Busiest days */}
          {stats.busyDays.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground mb-2 tracking-wide">Busiest Days</p>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 text-muted-foreground font-medium">Date</th>
                      <th className="text-right px-3 py-2 text-muted-foreground font-medium">Cases</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.busyDays.map((d, idx) => (
                      <tr key={d.date} className={cn("border-t border-border/60", idx === 0 && "bg-amber-50/50")}>
                        <td className="px-3 py-2">{d.date}</td>
                        <td className="px-3 py-2 text-right font-semibold">{d.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default OTUtilizationTab;

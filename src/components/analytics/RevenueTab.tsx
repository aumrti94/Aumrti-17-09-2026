import React from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, Legend,
} from "recharts";
import AnalyticsKPICard from "./AnalyticsKPICard";
import {
  useRevenueKPIs, useRevenueTrend, useRevenueBreakdown,
  usePaymentModes, useInsuranceSummary, useDailyHeatmap, type DateRange,
} from "@/hooks/useAnalyticsData";
import { Skeleton } from "@/components/ui/skeleton";
import RevenueForecastCard from "./RevenueForecastCard";

const fmt = (n: number) => {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toLocaleString("en-IN")}`;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const RevenueTab: React.FC<{ range: DateRange }> = ({ range }) => {
  const { data: kpis, isLoading: kpiLoading } = useRevenueKPIs(range);
  const { data: trend } = useRevenueTrend(range);
  const { data: breakdown } = useRevenueBreakdown(range);
  const { data: payModes } = usePaymentModes(range);
  const { data: insurance } = useInsuranceSummary(range);
  const { data: heatmap } = useDailyHeatmap(range);

  if (kpiLoading) return <div className="p-5 space-y-4">{[1,2,3].map(i => <Skeleton key={i} className="h-28 w-full" />)}</div>;

  const k = kpis || { totalRevenue: 0, outstanding: 0, outstandingCount: 0, opdRevenue: 0, opdCount: 0, ipdRevenue: 0, ipdCount: 0, pharmacyRevenue: 0, pharmacyCount: 0 };

  // Build calendar grid from heatmap data
  const heatmapDays = heatmap || [];
  const maxHeat = Math.max(1, ...heatmapDays.map(d => d.amount));
  const todayStr = new Date().toISOString().split("T")[0];

  // Compute leading empty cells (Mon=0, Sun=6)
  const firstDayOfWeek = heatmapDays.length > 0
    ? ((new Date(heatmapDays[0].date).getDay() + 6) % 7) // Mon=0
    : 0;

  const calendarCells: (typeof heatmapDays[number] | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) calendarCells.push(null);
  heatmapDays.forEach(d => calendarCells.push(d));

  return (
    <div className="p-5 space-y-4 overflow-y-auto">
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <AnalyticsKPICard icon="💰" iconBg="bg-emerald-100" value={fmt(k.totalRevenue)} label="Total Collection" />
        <AnalyticsKPICard icon="⏳" iconBg="bg-amber-100" value={fmt(k.outstanding)} valueColor="text-amber-500" label="Outstanding" subtitle={`${k.outstandingCount} bills pending`} />
        <AnalyticsKPICard icon="🏥" iconBg="bg-blue-100" value={fmt(k.opdRevenue)} valueColor="text-blue-500" label="OPD Collections" subtitle={`${k.opdCount} consultations`} />
        <AnalyticsKPICard icon="🛏️" iconBg="bg-purple-100" value={fmt(k.ipdRevenue)} valueColor="text-purple-500" label="IPD Collections" subtitle={`${k.ipdCount} discharges`} />
        <AnalyticsKPICard icon="💊" iconBg="bg-red-100" value={fmt(k.pharmacyRevenue)} valueColor="text-red-500" label="Pharmacy Sales" subtitle={`${k.pharmacyCount} bills`} />
      </div>

      {/* AI Revenue Forecast */}
      <RevenueForecastCard />

      {/* Trend + Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Revenue Trend</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trend || []}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmt(v)} />
              <Tooltip formatter={(v: number) => fmt(v)} labelFormatter={l => `Date: ${l}`} />
              <defs>
                <linearGradient id="colCollected" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(217, 60%, 30%)" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="hsl(217, 60%, 30%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="collected" stroke="hsl(217, 60%, 30%)" fill="url(#colCollected)" strokeWidth={2} name="Collected" />
              <Area type="monotone" dataKey="billed" stroke="hsl(215, 14%, 60%)" strokeDasharray="5 5" fill="none" strokeWidth={1.5} name="Billed" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Collection by Type</h3>
          <ResponsiveContainer width="100%" height={140}>
            <PieChart>
              <Pie data={breakdown || []} dataKey="value" cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={2}>
                {(breakdown || []).map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => fmt(v)} />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-2 space-y-1.5">
            {(breakdown || []).map(item => (
              <div key={item.name} className="flex items-center gap-2 text-[11px]">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: item.fill }} />
                <span className="flex-1 text-muted-foreground">{item.name}</span>
                <span className="font-medium text-foreground">{fmt(item.value)}</span>
                <span className="text-muted-foreground">{item.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Payment Modes + Insurance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Collections by Payment Mode</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={payModes || []} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => fmt(v)} />
              <YAxis type="category" dataKey="mode" tick={{ fontSize: 10 }} width={80} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Bar dataKey="total" name="Amount" radius={[0, 4, 4, 0]}>
                {(payModes || []).map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Insurance & TPA</h3>
          {insurance ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Claims Submitted", count: insurance.submittedCount, amount: insurance.submittedAmount, color: "text-foreground" },
                  { label: "Claims Settled", count: insurance.settledCount, amount: insurance.settledAmount, color: "text-emerald-500" },
                  { label: "Claims Pending", count: insurance.pendingCount, amount: insurance.pendingAmount, color: "text-amber-500" },
                  { label: "Claims Rejected", count: insurance.rejectedCount, amount: insurance.rejectedAmount, color: "text-red-500" },
                ].map(item => (
                  <div key={item.label} className="flex flex-col">
                    <span className="text-[10px] text-muted-foreground">{item.label}</span>
                    <span className={`text-sm font-bold ${item.color}`}>{item.count} | {fmt(item.amount)}</span>
                  </div>
                ))}
              </div>
              {insurance.topTPAs.length > 0 && (
                <div className="border-t border-border pt-2">
                  <p className="text-[10px] font-medium text-muted-foreground mb-1">Top TPAs by Pending</p>
                  <table className="w-full text-[10px]">
                    <thead><tr className="text-muted-foreground"><th className="text-left pb-1">TPA</th><th className="text-right pb-1">Submitted</th><th className="text-right pb-1">Settled</th><th className="text-right pb-1">Pending</th></tr></thead>
                    <tbody>
                      {insurance.topTPAs.map(tpa => (
                        <tr key={tpa.name} className="border-t border-border/50">
                          <td className="py-1 text-foreground">{tpa.name}</td>
                          <td className="text-right">{fmt(tpa.submitted)}</td>
                          <td className="text-right text-emerald-500">{fmt(tpa.settled)}</td>
                          <td className="text-right text-amber-500">{fmt(tpa.pending)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : <Skeleton className="h-32 w-full" />}
        </div>
      </div>

      {/* Daily Collection Calendar Heatmap */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Daily Collection Heatmap</h3>
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map(d => (
            <div key={d} className="text-[9px] text-muted-foreground text-center font-medium pb-1">{d}</div>
          ))}
          {calendarCells.map((cell, i) => {
            if (!cell) {
              return <div key={`empty-${i}`} className="aspect-square" />;
            }
            const intensity = cell.amount / maxHeat;
            const dayNum = new Date(cell.date).getDate();
            return (
              <div
                key={cell.date}
                title={`${cell.date}: ${fmt(cell.amount)}`}
                className={`aspect-square rounded-sm cursor-default flex items-center justify-center text-[9px] font-medium ${
                  cell.date === todayStr ? "ring-2 ring-primary" : ""
                }`}
                style={{
                  backgroundColor: cell.amount === 0
                    ? "hsl(var(--muted))"
                    : `hsla(172, 66%, 40%, ${0.15 + intensity * 0.85})`,
                  color: intensity > 0.5 ? "white" : "hsl(var(--muted-foreground))",
                }}
              >
                {dayNum}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default RevenueTab;

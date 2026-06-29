import React, { useEffect, useState, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";

function formatRevShort(n: number) {
  if (n >= 10000000) return "₹" + (n / 10000000).toFixed(1) + "Cr";
  if (n >= 100000) return "₹" + (n / 100000).toFixed(1) + "L";
  return "₹" + n.toLocaleString("en-IN");
}

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface DayData {
  day: string;
  label: string;
  revenue: number;
  isToday: boolean;
}

const RevenueChart: React.FC = () => {
  const [data, setData] = useState<DayData[]>([]);
  const [todayRev, setTodayRev] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    const now = new Date();
    const days: DayData[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      days.push({
        day: d.toISOString().split("T")[0],
        label: dayNames[d.getDay()],
        revenue: 0,
        isToday: i === 0,
      });
    }

    const startDate = days[0].day;
    const { data: bills } = await supabase
      .from("bills")
      .select("bill_date, paid_amount")
      .gte("bill_date", startDate)
      .lte("bill_date", days[6].day);

    if (bills) {
      for (const b of bills) {
        const match = days.find((d) => d.day === b.bill_date);
        if (match) match.revenue += Number(b.paid_amount);
      }
    }

    setData(days);
    setTodayRev(days[6].revenue);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const total = data.reduce((s, d) => s + d.revenue, 0);
  const avg = data.length > 0 ? Math.round(total / data.length) : 0;
  const best = data.reduce((b, d) => (d.revenue > b.revenue ? d : b), data[0] || { label: "-", revenue: 0 });

  if (loading) return <div className="h-full animate-pulse bg-muted rounded-xl" />;

  return (
    <div className="flex flex-col h-full bg-card rounded-xl border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 shrink-0">
        <span className="text-[13px] font-bold text-foreground">Revenue — Last 7 Days</span>
        <span className="text-xs font-bold text-[hsl(174,82%,28%)]">
          {formatRevShort(todayRev)} collected today
        </span>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0 px-2 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(222,56%,23%)" stopOpacity={0.15} />
                <stop offset="100%" stopColor="hsl(222,56%,23%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "hsl(215,16%,62%)" }}
            />
            <Tooltip
              contentStyle={{
                background: "white",
                border: "1px solid hsl(214,32%,91%)",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 12,
              }}
              formatter={(value: number) => [formatRevShort(value), "Revenue"]}
              labelFormatter={(label: string) => label}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="hsl(222,56%,23%)"
              strokeWidth={2}
              fill="url(#revenueGradient)"
              dot={(props: any) => {
                const { cx, cy, payload, index } = props;
                if (payload.isToday) {
                  return <circle key={index} cx={cx} cy={cy} r={5} fill="hsl(174,82%,28%)" stroke="white" strokeWidth={2} />;
                }
                return <circle key={index} cx={cx} cy={cy} r={0} />;
              }}
              activeDot={{ r: 4, fill: "hsl(222,56%,23%)", stroke: "white", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Footer stats */}
      <div className="flex items-center gap-4 px-4 py-2 border-t border-border/50 bg-muted/30 shrink-0">
        <span className="text-[11px] font-medium text-muted-foreground">7-day total: {formatRevShort(total)}</span>
        <span className="text-[11px] font-medium text-muted-foreground">Avg/day: {formatRevShort(avg)}</span>
        <span className="text-[11px] font-medium text-muted-foreground">Best: {best?.label} {formatRevShort(best?.revenue || 0)}</span>
      </div>
    </div>
  );
};

export default RevenueChart;

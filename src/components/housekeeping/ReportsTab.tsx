import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Card } from "@/components/ui/card";

interface Props { hospitalId: string | null; }

const ReportsTab: React.FC<Props> = ({ hospitalId }) => {
  const [tatData, setTatData] = useState<any[]>([]);
  const [bmwTrend, setBmwTrend] = useState<any[]>([]);

  useEffect(() => {
    if (!hospitalId) return;

    // TAT by ward
    supabase.from("housekeeping_tasks").select("tat_minutes, wards(name)")
      .eq("hospital_id", hospitalId).eq("status", "completed").eq("task_type", "bed_turnover")
      .then(({ data }) => {
        const wardMap: Record<string, number[]> = {};
        (data || []).forEach((t: any) => {
          const name = t.wards?.name || "Unknown";
          if (!wardMap[name]) wardMap[name] = [];
          if (t.tat_minutes) wardMap[name].push(t.tat_minutes);
        });
        setTatData(Object.entries(wardMap).map(([ward, tats]) => ({
          ward, avgTat: Math.round(tats.reduce((a, b) => a + b, 0) / tats.length),
        })));
      });

    // BMW monthly trend
    supabase.from("bmw_records").select("record_date, total_kg")
      .eq("hospital_id", hospitalId).order("record_date", { ascending: true }).limit(90)
      .then(({ data }) => {
        const monthMap: Record<string, number> = {};
        (data || []).forEach((r: any) => {
          const month = r.record_date?.substring(0, 7);
          if (month) monthMap[month] = (monthMap[month] || 0) + Number(r.total_kg || 0);
        });
        setBmwTrend(Object.entries(monthMap).map(([month, total]) => ({ month, total: Math.round(total * 10) / 10 })));
      });
  }, [hospitalId]);

  return (
    <div className="h-full overflow-y-auto space-y-4">
      {/* TAT Report */}
      <Card className="p-4">
        <h3 className="text-sm font-bold mb-1">Bed Turnover TAT by Ward</h3>
        <p className="text-[10px] text-muted-foreground mb-3">NABH Target: &lt; 30 minutes</p>
        {tatData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={tatData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="ward" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="avgTat" fill="hsl(var(--primary))" name="Avg TAT (min)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : <p className="text-xs text-muted-foreground py-8 text-center">No data yet</p>}
      </Card>

      {/* BMW Trend */}
      <Card className="p-4">
        <h3 className="text-sm font-bold mb-1">BMW Generation Trend</h3>
        <p className="text-[10px] text-muted-foreground mb-3">Monthly total waste (kg)</p>
        {bmwTrend.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={bmwTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="total" fill="#F59E0B" name="Total kg" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : <p className="text-xs text-muted-foreground py-8 text-center">No BMW data yet</p>}
      </Card>
    </div>
  );
};

export default ReportsTab;

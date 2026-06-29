import React, { useState, useEffect } from "react";
import { callAI } from "@/lib/aiProvider";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { TrendingUp, Loader2 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, ReferenceLine, ResponsiveContainer, Dot } from "recharts";

interface TrendResult {
  anomaly_detected: boolean;
  trend_direction: string;
  clinical_significance: string;
  alert_level: string;
  suggested_action: string;
}

interface Props {
  testName: string;
  currentResult: number;
  unit: string | null;
  normalMin: number | null;
  normalMax: number | null;
  patientId: string;
  hospitalId: string;
}

const LabTrendPanel: React.FC<Props> = ({ testName, currentResult, unit, normalMin, normalMax, patientId, hospitalId }) => {
  const [loading, setLoading] = useState(true);
  const [trend, setTrend] = useState<TrendResult | null>(null);
  const [chartData, setChartData] = useState<{ date: string; value: number }[]>([]);

  useEffect(() => {
    const analyze = async () => {
      // Get patient's last 5 results for this test via lab_orders join
      const { data: patientOrders } = await supabase
        .from("lab_orders")
        .select("id")
        .eq("patient_id", patientId)
        .order("order_date", { ascending: false })
        .limit(20);

      const orderIds = (patientOrders || []).map((o: any) => o.id);
      if (orderIds.length === 0) { setLoading(false); return; }

      const { data: history } = await supabase
        .from("lab_order_items")
        .select("result_numeric, created_at, test_id, lab_test_master:lab_test_master!lab_order_items_test_id_fkey(test_name)")
        .in("lab_order_id", orderIds)
        .not("result_numeric", "is", null)
        .order("created_at", { ascending: false })
        .limit(50);

      // Filter to matching test name
      const matchingHistory = (history || []).filter((h: any) => h.lab_test_master?.test_name === testName);

      // Filter out current result to avoid double-counting, build chart
      const histValues = (matchingHistory || [])
        .map((h: any) => ({ value: Number(h.result_numeric), date: h.created_at?.split("T")[0] || "" }))
        .filter(h => !isNaN(h.value));

      if (histValues.length < 2) {
        setLoading(false);
        return;
      }

      // Add current as most recent
      const allData = [{ date: new Date().toISOString().split("T")[0], value: currentResult }, ...histValues].reverse();
      setChartData(allData);

      try {
        const response = await callAI({
          featureKey: "lab_anomaly",
          hospitalId,
          prompt: `Analyse this lab result trend for a patient.

Test: ${testName}
Current result: ${currentResult} ${unit || ""}
Normal range: ${normalMin ?? "?"}-${normalMax ?? "?"} ${unit || ""}

Patient's recent history (most recent first):
${histValues.map(v => `${v.date}: ${v.value}`).join(", ")}

Is this result:
1. Within normal range but unusually different from patient's baseline?
2. Trending in a concerning direction?
3. Requiring clinical attention despite being technically "normal"?

Return ONLY JSON:
{
  "anomaly_detected": true,
  "trend_direction": "rapidly_rising",
  "clinical_significance": "Creatinine rising 40% over 3 days — AKI trajectory",
  "alert_level": "warning",
  "suggested_action": "Nephrology review recommended"
}

Return {"anomaly_detected": false} if no significant trend.`,
          maxTokens: 200,
        });

        const parsed = JSON.parse(
          response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
        );
        setTrend(parsed);

        // Create clinical alert if anomaly detected
        if (parsed?.anomaly_detected) {
          await supabase.from("clinical_alerts").insert({
            hospital_id: hospitalId,
            patient_id: patientId,
            alert_type: "lab_trend",
            severity: parsed.alert_level === "critical" ? "critical" : "medium",
            alert_message: `Lab Trend Alert — ${testName}: ${parsed.clinical_significance}. Action: ${parsed.suggested_action}`,
          });
        }
      } catch {
        setTrend(null);
      }
      setLoading(false);
    };
    analyze();
  }, [testName, currentResult, patientId, hospitalId, unit, normalMin, normalMax]);

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground py-1">
        <Loader2 size={10} className="animate-spin" /> Analysing trend…
      </div>
    );
  }

  if (!trend?.anomaly_detected && chartData.length < 3) return null;

  return (
    <div className="space-y-1.5 mt-1">
      {/* Sparkline */}
      {chartData.length >= 3 && (
        <div className="h-[40px] w-[140px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 2, right: 4, bottom: 2, left: 4 }}>
              {normalMin != null && (
                <ReferenceLine y={normalMin} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 2" strokeWidth={0.5} />
              )}
              {normalMax != null && (
                <ReferenceLine y={normalMax} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 2" strokeWidth={0.5} />
              )}
              <Line
                type="monotone"
                dataKey="value"
                stroke={trend?.anomaly_detected ? "hsl(var(--destructive))" : "hsl(var(--primary))"}
                strokeWidth={1.5}
                dot={(props: any) => {
                  const { cx, cy, index } = props;
                  const isLast = index === chartData.length - 1;
                  return (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={isLast ? 3 : 1.5}
                      fill={isLast ? (trend?.anomaly_detected ? "hsl(var(--destructive))" : "hsl(var(--primary))") : "hsl(var(--muted-foreground))"}
                      stroke="none"
                    />
                  );
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Anomaly alert */}
      {trend?.anomaly_detected && (
        <div className="bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5 text-[11px]">
          <div className="flex items-center gap-1.5 font-bold text-amber-700">
            <TrendingUp size={12} /> Trend Alert
          </div>
          <p className="text-amber-800 mt-0.5">{trend.clinical_significance}</p>
          <p className="text-amber-600 mt-0.5">💡 {trend.suggested_action}</p>
        </div>
      )}
    </div>
  );
};

export default LabTrendPanel;

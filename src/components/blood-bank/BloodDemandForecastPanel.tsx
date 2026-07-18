import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { useAIFeature } from "@/hooks/useAIFeature";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Droplets, Loader2, AlertTriangle, Bot, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { addDays, format } from "date-fns";

interface DayForecast {
  date: string;
  blood_group: string;
  component: string;
  predicted_units: number;
  current_stock: number;
  shortage_risk: "critical" | "low" | "ok";
  surgery_count: number;
}

interface AISummary {
  overall_risk: "critical" | "moderate" | "low";
  shortage_groups: string[];
  priority_cross_matches: string[];
  recommendation: string;
}

const RISK_STYLE: Record<string, string> = {
  critical: "bg-red-50 border-red-200 text-red-900",
  low: "bg-amber-50 border-amber-200 text-amber-900",
  ok: "bg-emerald-50 border-emerald-200 text-emerald-900",
};

const BloodDemandForecastPanel: React.FC = () => {
  const __aiOn = useAIFeature("blood_demand_forecaster");
  const { hospitalId } = useHospitalId();
  const [loading, setLoading] = useState(false);
  const [forecasts, setForecasts] = useState<DayForecast[] | null>(null);
  const [summary, setSummary] = useState<AISummary | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);

  const runForecast = async () => {
    if (!hospitalId) return;
    setLoading(true);
    setForecasts(null);
    setSummary(null);
    setRawText(null);

    try {
      const today = new Date().toISOString().split("T")[0];
      const sevenDaysLater = addDays(new Date(), 7).toISOString().split("T")[0];

      // Fetch upcoming OT schedules with blood groups
      const { data: otSchedules } = await (supabase as any)
        .from("ot_schedules")
        .select("scheduled_date, surgery_category, surgery_name, patient:patients(full_name, blood_group)")
        .eq("hospital_id", hospitalId)
        .in("status", ["scheduled", "confirmed"])
        .gte("scheduled_date", today)
        .lte("scheduled_date", sevenDaysLater)
        .order("scheduled_date");

      // Fetch current blood unit stock
      const { data: bloodUnits } = await (supabase as any)
        .from("blood_units")
        .select("component, blood_group, rh_factor, status")
        .eq("hospital_id", hospitalId)
        .eq("status", "available");

      // Count available stock per blood group
      const stockByGroup: Record<string, number> = {};
      (bloodUnits || []).forEach((u: any) => {
        const key = `${u.blood_group}_${u.rh_factor}`;
        stockByGroup[key] = (stockByGroup[key] || 0) + 1;
      });

      if (!otSchedules || otSchedules.length === 0) {
        setRawText("No upcoming OT schedules found for the next 7 days.");
        setLoading(false);
        return;
      }

      // Units needed per surgery category
      const estimateUnits = (category: string): number => {
        const map: Record<string, number> = {
          major: 2, minor: 0, moderate: 1, emergency: 3, cardiac: 4, ortho: 2, neuro: 2, obstetric: 2,
        };
        return map[category?.toLowerCase()] || 1;
      };

      const otSummary = (otSchedules as any[]).map((ot, i) => {
        const bg = ot.patient?.blood_group || "Unknown";
        const units = estimateUnits(ot.surgery_category);
        const stockKey = bg.replace("+", "_positive").replace("-", "_negative");
        const available = stockByGroup[stockKey] || 0;
        return `${i + 1}. ${ot.scheduled_date} | ${ot.surgery_name} (${ot.surgery_category}) | Patient: ${ot.patient?.full_name || "Unknown"} | Blood group: ${bg} | Est. units needed: ${units} | Current stock (${bg}): ${available} units`;
      }).join("\n");

      const stockSummary = Object.entries(stockByGroup)
        .map(([k, v]) => `${k.replace("_", " ")}: ${v} units`)
        .join(", ") || "No blood stock data";

      const response = await callAI({
        featureKey: "blood_demand_forecaster",
        hospitalId,
        prompt: `You are a blood bank AI for an Indian hospital. Forecast blood demand for the next 7 days based on upcoming surgeries.

CURRENT BLOOD STOCK:
${stockSummary}

UPCOMING OT SCHEDULES (next 7 days):
${otSummary}

Analyse this data and provide:
1. Overall risk assessment (critical/moderate/low)
2. Blood groups at shortage risk
3. Priority cross-matches to prepare
4. A specific recommendation for the blood bank team

Return ONLY valid JSON:
{
  "overall_risk": "critical|moderate|low",
  "shortage_groups": ["A+ (2 surgeries, only 1 unit available)", "O- (emergency case, 0 units)"],
  "priority_cross_matches": ["Patient X — A+ — cardiac surgery tomorrow", "Patient Y — O- — emergency laparotomy"],
  "recommendation": "Specific action the blood bank should take TODAY (1-2 sentences)"
}`,
        maxTokens: 400,
      });

      if (response.error || !response.text) {
        setRawText("AI service unavailable.");
        setLoading(false);
        return;
      }

      try {
        const clean = response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(clean);
        setSummary(parsed);
      } catch {
        setRawText(response.text);
      }

      // Build day-by-day forecast
      const dayForecasts: DayForecast[] = [];
      const dayGroups: Record<string, any[]> = {};
      (otSchedules as any[]).forEach((ot: any) => {
        if (!dayGroups[ot.scheduled_date]) dayGroups[ot.scheduled_date] = [];
        dayGroups[ot.scheduled_date].push(ot);
      });

      Object.entries(dayGroups).forEach(([date, cases]) => {
        const bgCount: Record<string, number> = {};
        cases.forEach((ot: any) => {
          const bg = ot.patient?.blood_group || "Unknown";
          bgCount[bg] = (bgCount[bg] || 0) + estimateUnits(ot.surgery_category);
        });

        Object.entries(bgCount).forEach(([bg, units]) => {
          const stockKey = bg.replace("+", "_positive").replace("-", "_negative");
          const stock = stockByGroup[stockKey] || 0;
          const ratio = stock / Math.max(units, 1);
          dayForecasts.push({
            date,
            blood_group: bg,
            component: "RBC",
            predicted_units: units,
            current_stock: stock,
            shortage_risk: ratio < 0.5 ? "critical" : ratio < 1 ? "low" : "ok",
            surgery_count: cases.filter((c: any) => (c.patient?.blood_group || "Unknown") === bg).length,
          });
        });
      });

      setForecasts(dayForecasts.sort((a, b) => a.date.localeCompare(b.date)));
    } catch (err: any) {
      setRawText(`Forecast failed: ${err.message}`);
    }
    setLoading(false);
  };

  const criticalDays = forecasts?.filter(f => f.shortage_risk === "critical").length ?? 0;

  if (!__aiOn) return null;
  return (
    <div className="border rounded-lg overflow-hidden mt-4">
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b">
        <div className="flex items-center gap-2">
          <Droplets className="h-4 w-4 text-red-500" />
          <span className="text-[13px] font-bold">AI Blood Demand Forecaster</span>
          {criticalDays > 0 && (
            <Badge className="bg-red-100 text-red-700 border-red-300 text-[10px]">
              <AlertTriangle className="h-3 w-3 mr-1" />{criticalDays} shortage risk(s)
            </Badge>
          )}
        </div>
        <Button size="sm" className="h-7 text-xs gap-1.5" onClick={runForecast} disabled={loading || !hospitalId}>
          {loading
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Forecasting...</>
            : <><Bot className="h-3.5 w-3.5" /> Run 7-Day Forecast</>}
        </Button>
      </div>

      <div className="p-4 space-y-3">
        {forecasts === null && !rawText && !loading && (
          <p className="text-[12px] text-muted-foreground text-center py-4">
            Click "Run 7-Day Forecast" to predict blood demand based on upcoming OT schedule
          </p>
        )}

        {summary && (
          <div className={cn(
            "rounded-lg border px-4 py-3 text-sm",
            summary.overall_risk === "critical" ? "bg-red-50 border-red-200" :
            summary.overall_risk === "moderate" ? "bg-amber-50 border-amber-200" :
            "bg-emerald-50 border-emerald-200"
          )}>
            <div className="flex items-center gap-2 mb-2">
              {summary.overall_risk === "critical" ? (
                <AlertTriangle className="h-4 w-4 text-red-600" />
              ) : summary.overall_risk === "moderate" ? (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              )}
              <span className="font-bold text-[13px]">
                {summary.overall_risk === "critical" ? "Critical Shortage Risk" :
                 summary.overall_risk === "moderate" ? "Moderate Risk — Action Needed" :
                 "Blood Stock Looks Adequate"}
              </span>
            </div>
            {summary.shortage_groups.length > 0 && (
              <div className="mb-2">
                <p className="text-[11px] font-semibold mb-1">Blood groups at risk:</p>
                <ul className="space-y-0.5">
                  {summary.shortage_groups.map((g, i) => (
                    <li key={i} className="text-[11px]">• {g}</li>
                  ))}
                </ul>
              </div>
            )}
            {summary.priority_cross_matches.length > 0 && (
              <div className="mb-2">
                <p className="text-[11px] font-semibold mb-1">Priority cross-matches to prepare:</p>
                <ul className="space-y-0.5">
                  {summary.priority_cross_matches.map((c, i) => (
                    <li key={i} className="text-[11px]">• {c}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[12px] font-medium mt-1.5">→ {summary.recommendation}</p>
          </div>
        )}

        {forecasts && forecasts.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">Day-by-Day Blood Demand</p>
            <div className="space-y-1">
              {forecasts.map((f, i) => (
                <div key={i} className={cn("rounded border px-3 py-1.5 text-xs flex items-center gap-3", RISK_STYLE[f.shortage_risk])}>
                  <span className="font-mono text-[10px] text-muted-foreground w-20 shrink-0">
                    {format(new Date(f.date + "T00:00:00"), "dd MMM")}
                  </span>
                  <span className="font-semibold w-10 shrink-0">{f.blood_group}</span>
                  <span className="text-[10px]">{f.surgery_count} surgery(ies)</span>
                  <span>Need: <strong>{f.predicted_units} units</strong></span>
                  <span>Stock: <strong>{f.current_stock} units</strong></span>
                  {f.shortage_risk === "critical" && (
                    <Badge variant="outline" className="ml-auto text-[9px] border-red-400 text-red-700 shrink-0">
                      SHORTAGE
                    </Badge>
                  )}
                  {f.shortage_risk === "low" && (
                    <Badge variant="outline" className="ml-auto text-[9px] border-amber-400 text-amber-700 shrink-0">
                      LOW STOCK
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {rawText && (
          <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap rounded border p-2 max-h-32 overflow-auto">
            {rawText}
          </pre>
        )}
      </div>
    </div>
  );
};

export default BloodDemandForecastPanel;

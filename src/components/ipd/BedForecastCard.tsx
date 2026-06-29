import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { BarChart, Bar, XAxis, YAxis, ReferenceLine, ResponsiveContainer, Cell, Tooltip } from "recharts";
import { BedDouble, Brain, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface Props {
  hospitalId: string;
  totalBeds: number;
  currentOccupancy: number;
}

interface ForecastDay {
  day: string;
  expected_beds_needed: number;
  available: number;
}

interface ForecastResult {
  forecast: ForecastDay[];
  peak_day: string;
  shortage_risk: boolean;
  recommended_action: string;
}

const BedForecastCard: React.FC<Props> = ({ hospitalId, totalBeds, currentOccupancy }) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ForecastResult | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  // Load last persisted forecast on mount
  useEffect(() => {
    if (!hospitalId) return;
    const today = new Date().toISOString().split("T")[0];
    (supabase as any)
      .from("bed_demand_forecasts")
      .select("*")
      .eq("hospital_id", hospitalId)
      .eq("forecast_date", today)
      .order("created_at", { ascending: false })
      .limit(7)
      .then(({ data }: any) => {
        if (data && data.length > 0) {
          const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
          const forecast = data.map((row: any) => {
            const d = new Date(row.forecast_date);
            return {
              day: days[d.getDay()],
              expected_beds_needed: row.predicted_admissions || 0,
              available: Math.max(0, totalBeds - (row.predicted_admissions || 0)),
            };
          });
          setResult({
            forecast,
            peak_day: data.find((r: any) => r.predicted_admissions === Math.max(...data.map((x: any) => x.predicted_admissions || 0)))?.forecast_date || "",
            shortage_risk: data.some((r: any) => (r.predicted_admissions || 0) >= totalBeds),
            recommended_action: data[0]?.ai_reasoning || "",
          });
        }
      });
  }, [hospitalId, totalBeds]);

  const runForecast = async () => {
    setLoading(true);
    setIsOpen(true); // Open when running
    try {
      // Get 30-day admission/discharge counts
      const { data: admData } = await supabase
        .from("admissions")
        .select("admitted_at, discharged_at")
        .eq("hospital_id", hospitalId)
        .gte("admitted_at", new Date(Date.now() - 30 * 86400000).toISOString());

      const dailyMap: Record<string, { admissions: number; discharges: number }> = {};
      (admData || []).forEach((a: any) => {
        const admDay = a.admitted_at?.split("T")[0];
        if (admDay) {
          if (!dailyMap[admDay]) dailyMap[admDay] = { admissions: 0, discharges: 0 };
          dailyMap[admDay].admissions++;
        }
        if (a.discharged_at) {
          const disDay = a.discharged_at.split("T")[0];
          if (!dailyMap[disDay]) dailyMap[disDay] = { admissions: 0, discharges: 0 };
          dailyMap[disDay].discharges++;
        }
      });

      const history = Object.entries(dailyMap)
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, 30)
        .map(([date, v]) => `${date}: ${v.admissions} adm, ${v.discharges} dis`);

      const response = await callAI({
        featureKey: "bed_demand_forecaster",
        hospitalId,
        prompt: `Forecast hospital bed demand for next 7 days.
    
Hospital capacity: ${totalBeds} beds
Current occupancy: ${currentOccupancy} beds (${Math.round((currentOccupancy / totalBeds) * 100)}%)

Daily admissions/discharges last 30 days (recent first):
${history.join("\n") || "No data"}

Return ONLY JSON:
{
  "forecast": [
    {"day": "Mon", "expected_beds_needed": 42, "available": 8}
  ],
  "peak_day": "Thursday",
  "shortage_risk": false,
  "recommended_action": "Consider deferring 3 elective admissions on Thursday"
}`,
        maxTokens: 300,
      });

      if (response.error) return;
      const parsed = JSON.parse(
        response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
      );
      setResult(parsed);

      // Persist each forecast day to bed_demand_forecasts table
      const today = new Date();
      const upsertRows = (parsed.forecast || []).map((day: ForecastDay, i: number) => {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        return {
          hospital_id: hospitalId,
          ward_id: null,
          forecast_date: d.toISOString().split("T")[0],
          predicted_admissions: day.expected_beds_needed,
          confidence_pct: 70,
          ai_reasoning: i === 0 ? parsed.recommended_action : null,
        };
      });
      for (const row of upsertRows) {
        await (supabase as any)
          .from("bed_demand_forecasts")
          .upsert(row, { onConflict: "hospital_id,ward_id,forecast_date" });
      }
    } catch {
      /* graceful */
    } finally {
      setLoading(false);
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
      <Card className="border-border">
        <CardHeader className="pb-2 flex-row items-center justify-between cursor-pointer" onClick={() => setIsOpen(!isOpen)}>
          <div className="flex items-center gap-2">
            {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            <CardTitle className="text-sm flex items-center gap-2">
              <BedDouble className="h-4 w-4 text-primary" /> 7-Day Bed Forecast
            </CardTitle>
          </div>
          <Button 
            size="sm" 
            variant="outline" 
            onClick={(e) => {
              e.stopPropagation();
              runForecast();
            }} 
            disabled={loading} 
            className="text-xs h-7"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Brain className="h-3 w-3 mr-1" />}
            {loading ? "Forecasting..." : "Run Forecast"}
          </Button>
        </CardHeader>
        <CollapsibleContent>
          <CardContent>
        {!result && !loading && (
          <p className="text-xs text-muted-foreground text-center py-4">
            Click "Run Forecast" to predict bed occupancy for the next 7 days
          </p>
        )}
        {result && (
          <div className="space-y-3">
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={result.forecast} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 11 }} />
                <ReferenceLine y={totalBeds} stroke="hsl(var(--destructive))" strokeDasharray="3 3" label={{ value: `Capacity: ${totalBeds}`, fontSize: 9, fill: "hsl(var(--destructive))" }} />
                <Bar dataKey="expected_beds_needed" name="Beds Needed" radius={[3, 3, 0, 0]}>
                  {result.forecast.map((d, i) => (
                    <Cell key={i} fill={d.expected_beds_needed >= totalBeds ? "hsl(var(--destructive))" : "hsl(var(--primary))"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={result.shortage_risk ? "destructive" : "secondary"} className="text-[10px]">
                {result.shortage_risk ? "⚠️ Shortage Risk" : "✅ Capacity OK"}
              </Badge>
              <span className="text-[11px] text-muted-foreground">Peak: {result.peak_day}</span>
            </div>
            {result.recommended_action && (
              <p className="text-xs bg-muted/50 rounded p-2 text-muted-foreground">
                💡 {result.recommended_action}
              </p>
            )}
          </div>
        )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};

export default BedForecastCard;

import React, { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, TrendingUp, TrendingDown, Minus, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { format, addDays } from "date-fns";
import { cn } from "@/lib/utils";

interface WardForecast {
  ward_id: string | null;
  ward_name: string;
  forecast_date: string;
  predicted_occupancy: number;
  predicted_admissions: number;
  confidence_pct: number;
  factors: string[];
}

interface DayForecast {
  date: string;
  day_label: string;
  wards: WardForecast[];
  total_predicted: number;
}

interface Props {
  hospitalId: string | null;
}

/**
 * BedDemandForecastPanel — AI-powered 7-day bed occupancy forecaster.
 * Fetches last 90 days of admissions, calculates patterns, then asks
 * the AI for a 7-day ward-level prediction. Persists to bed_demand_forecasts.
 */
const BedDemandForecastPanel: React.FC<Props> = ({ hospitalId }) => {
  const [loading, setLoading] = useState(false);
  const [forecasts, setForecasts] = useState<DayForecast[]>([]);
  const [lastGenerated, setLastGenerated] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const runForecast = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    setError(null);

    try {
      const today = new Date();
      const ninetyDaysAgo = new Date(today);
      ninetyDaysAgo.setDate(today.getDate() - 90);

      // Fetch last 90 days of admissions grouped by ward
      const { data: admissions } = await (supabase as any)
        .from("admissions")
        .select("id, admitted_at, discharged_at, status, ward_id, wards(name)")
        .eq("hospital_id", hospitalId)
        .gte("admitted_at", ninetyDaysAgo.toISOString())
        .order("admitted_at", { ascending: false });

      const { data: beds } = await (supabase as any)
        .from("beds")
        .select("id, ward_id, status, wards(name)")
        .eq("hospital_id", hospitalId)
        .eq("is_active", true);

      // Compute ward capacity and historical avg
      const wardMap: Record<string, { name: string; total_beds: number; admissions: number[] }> = {};

      (beds || []).forEach((b: any) => {
        const wid = b.ward_id || "general";
        const wname = (b.wards as any)?.name || "General";
        if (!wardMap[wid]) wardMap[wid] = { name: wname, total_beds: 0, admissions: [] };
        wardMap[wid].total_beds++;
      });

      // Count admissions per ward per day of week (0=Sun..6=Sat)
      const dowAdmissions: Record<string, number[]> = {};
      (admissions || []).forEach((a: any) => {
        const wid = a.ward_id || "general";
        if (!wardMap[wid]) {
          wardMap[wid] = { name: (a.wards as any)?.name || "General", total_beds: 10, admissions: [] };
        }
        if (!dowAdmissions[wid]) dowAdmissions[wid] = [0, 0, 0, 0, 0, 0, 0];
        const dow = new Date(a.admitted_at).getDay();
        dowAdmissions[wid][dow]++;
      });

      // Build context string for AI
      const wardSummaries = Object.entries(wardMap).map(([wid, w]) => {
        const dow = dowAdmissions[wid] || [0, 0, 0, 0, 0, 0, 0];
        const avgDow = dow.map(d => Math.round(d / 13)); // 90 days ≈ 13 weeks
        return `Ward: ${w.name} | Beds: ${w.total_beds} | Avg admissions by weekday (Sun-Sat): ${avgDow.join(",")}`;
      }).join("\n");

      const upcoming = Array.from({ length: 7 }, (_, i) => {
        const d = addDays(today, i);
        return `${format(d, "yyyy-MM-dd")} (${format(d, "EEE")})`;
      }).join(", ");

      const prompt = `You are a hospital operations AI for an Indian hospital. Forecast 7-day bed demand.

Historical admission patterns (last 90 days):
${wardSummaries || "No historical data available — use conservative estimates"}

Forecast dates: ${upcoming}

For each ward for each of the 7 days, predict:
1. occupancy% (0-100) — expected bed occupancy percentage
2. admissions — expected new admissions
3. confidence (0-100) — confidence in the prediction
4. factors — 1-2 key drivers (e.g., "Weekend dip", "Post-holiday surge", "Seasonal pattern")

Return ONLY valid JSON:
{
  "forecasts": [
    {
      "ward_name": "General Medicine",
      "ward_id": null,
      "predictions": [
        { "date": "2026-05-08", "occupancy_pct": 82, "admissions": 5, "confidence": 75, "factors": ["Midweek peak", "Historical pattern"] }
      ]
    }
  ]
}`;

      const response = await callAI({
        featureKey: "bed_demand_forecaster",
        hospitalId,
        prompt,
        maxTokens: 800,
      });

      if (response.error || !response.text) {
        setError("AI provider not configured. Check Settings → API Hub.");
        return;
      }

      let parsed: any;
      try {
        const clean = response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        parsed = JSON.parse(clean);
      } catch {
        setError("AI returned unexpected format. Please retry.");
        return;
      }

      const aiForecasts: any[] = parsed?.forecasts || [];

      // Build 7-day view grouped by date
      const dayMap: Record<string, DayForecast> = {};
      const upsertRows: any[] = [];

      aiForecasts.forEach((wardF: any) => {
        (wardF.predictions || []).forEach((p: any) => {
          if (!dayMap[p.date]) {
            dayMap[p.date] = {
              date: p.date,
              day_label: format(new Date(p.date + "T00:00:00"), "EEE dd/MM"),
              wards: [],
              total_predicted: 0,
            };
          }
          const wardForecast: WardForecast = {
            ward_id: wardF.ward_id || null,
            ward_name: wardF.ward_name,
            forecast_date: p.date,
            predicted_occupancy: Math.min(100, Math.max(0, p.occupancy_pct)),
            predicted_admissions: p.admissions || 0,
            confidence_pct: p.confidence || 70,
            factors: p.factors || [],
          };
          dayMap[p.date].wards.push(wardForecast);
          dayMap[p.date].total_predicted += p.admissions || 0;

          upsertRows.push({
            hospital_id: hospitalId,
            ward_id: wardF.ward_id || null,
            ward_name: wardF.ward_name,
            forecast_date: p.date,
            predicted_occupancy: wardForecast.predicted_occupancy,
            predicted_admissions: wardForecast.predicted_admissions,
            confidence_pct: wardForecast.confidence_pct,
            factors: { drivers: wardForecast.factors },
            generated_at: new Date().toISOString(),
          });
        });
      });

      setForecasts(Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date)));
      setLastGenerated(format(new Date(), "dd/MM/yyyy HH:mm"));

      // Persist to bed_demand_forecasts
      if (upsertRows.length > 0) {
        await (supabase as any)
          .from("bed_demand_forecasts")
          .upsert(upsertRows, { onConflict: "hospital_id,ward_id,forecast_date" });
      }

      // Log AI feature usage
      await (supabase as any).from("ai_feature_logs").insert({
        hospital_id: hospitalId,
        module: "ipd",
        feature_key: "bed_demand_forecaster",
        success: true,
        input_summary: `${Object.keys(wardMap).length} wards, 90-day history`,
        output_summary: `${upsertRows.length} ward-day predictions generated`,
        tokens_used: (response as any).tokens_used ?? null,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Bed demand forecast error:", msg);
      setError("Forecast failed. Please retry.");
    } finally {
      setLoading(false);
    }
  }, [hospitalId]);

  const occupancyColor = (pct: number) => {
    if (pct >= 90) return "text-red-600 bg-red-50 dark:bg-red-950/30 border-red-200";
    if (pct >= 75) return "text-amber-600 bg-amber-50 dark:bg-amber-950/30 border-amber-200";
    return "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200";
  };

  const TrendIcon = ({ pct }: { pct: number }) =>
    pct >= 85 ? <TrendingUp className="h-3 w-3" /> :
    pct >= 70 ? <Minus className="h-3 w-3" /> :
    <TrendingDown className="h-3 w-3" />;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">🛏️ 7-Day Bed Demand Forecast</span>
          {lastGenerated && (
            <span className="text-[10px] text-muted-foreground">Generated {lastGenerated}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {forecasts.length > 0 && !loading && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={(e) => { e.stopPropagation(); runForecast(); }}
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          )}
          {collapsed ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-3">
          {forecasts.length === 0 && !loading && !error && (
            <div className="flex flex-col items-center gap-3 py-6">
              <p className="text-xs text-muted-foreground text-center">
                AI will analyse the last 90 days of admissions patterns and predict 7-day ward-level demand.
              </p>
              <Button size="sm" className="gap-2" onClick={runForecast}>
                <Sparkles className="h-3.5 w-3.5" />
                Generate Forecast
              </Button>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Analysing 90-day patterns &amp; forecasting...
            </div>
          )}

          {error && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-xs text-destructive flex items-center justify-between">
              <span>{error}</span>
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={runForecast}>Retry</Button>
            </div>
          )}

          {forecasts.length > 0 && !loading && (
            <>
              {/* 7-day strip */}
              <div className="grid grid-cols-7 gap-1">
                {forecasts.map(day => {
                  const avgOccupancy = day.wards.length > 0
                    ? Math.round(day.wards.reduce((s, w) => s + w.predicted_occupancy, 0) / day.wards.length)
                    : 0;
                  return (
                    <div
                      key={day.date}
                      className={cn(
                        "rounded-lg border p-2 text-center space-y-1",
                        occupancyColor(avgOccupancy)
                      )}
                    >
                      <p className="text-[9px] font-semibold uppercase tracking-wider opacity-70">
                        {day.day_label.split(" ")[0]}
                      </p>
                      <p className="text-[10px] font-mono opacity-60">{day.day_label.split(" ")[1]}</p>
                      <div className="flex items-center justify-center gap-0.5">
                        <TrendIcon pct={avgOccupancy} />
                        <span className="text-sm font-bold">{avgOccupancy}%</span>
                      </div>
                      <p className="text-[9px] opacity-70">+{day.total_predicted} adm.</p>
                    </div>
                  );
                })}
              </div>

              {/* Ward breakdown for today + tomorrow */}
              {forecasts.slice(0, 2).map(day => (
                <div key={day.date} className="space-y-1">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {day.day_label} — Ward Breakdown
                  </p>
                  {day.wards.map((w, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="w-28 truncate text-foreground font-medium">{w.ward_name}</span>
                      {/* Occupancy bar */}
                      <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            w.predicted_occupancy >= 90 ? "bg-red-500" :
                            w.predicted_occupancy >= 75 ? "bg-amber-500" : "bg-emerald-500"
                          )}
                          style={{ width: `${w.predicted_occupancy}%` }}
                        />
                      </div>
                      <Badge
                        variant="outline"
                        className={cn("text-[9px] h-4 px-1", occupancyColor(w.predicted_occupancy))}
                      >
                        {w.predicted_occupancy}%
                      </Badge>
                      {w.factors.length > 0 && (
                        <span className="text-[9px] text-muted-foreground truncate max-w-[80px]" title={w.factors.join(", ")}>
                          {w.factors[0]}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default BedDemandForecastPanel;

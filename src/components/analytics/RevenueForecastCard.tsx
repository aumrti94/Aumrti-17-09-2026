import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";

interface ForecastData {
  forecast_amount: number;
  growth_vs_last_month: number;
  confidence: string;
  key_driver: string;
  risk_factor: string;
}

const fmt = (n: number) => {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toLocaleString("en-IN")}`;
};

const RevenueForecastCard: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [forecast, setForecast] = useState<ForecastData | null>(null);

  const runForecast = async () => {
    setLoading(true);
    try {
      const { data: userData } = await supabase.from("users").select("hospital_id").limit(1).maybeSingle();
      if (!userData?.hospital_id) { setLoading(false); return; }
      const hospitalId = userData.hospital_id;

      // Get last 6 months revenue
      const months: { month: string; revenue: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = subMonths(new Date(), i);
        const from = format(startOfMonth(d), "yyyy-MM-dd");
        const to = format(endOfMonth(d), "yyyy-MM-dd");
        const { data } = await supabase
          .from("bills")
          .select("paid_amount")
          .eq("hospital_id", hospitalId)
          .gte("bill_date", from)
          .lte("bill_date", to);
        const total = (data || []).reduce((s: number, b: any) => s + Number(b.paid_amount || 0), 0);
        months.push({ month: format(d, "MMM yyyy"), revenue: total });
      }

      // Current admissions
      const { data: admissions } = await supabase
        .from("admissions")
        .select("id")
        .eq("hospital_id", hospitalId)
        .eq("status", "admitted");

      const response = await callAI({
        featureKey: "ai_digest",
        hospitalId,
        prompt: `Forecast next month's revenue for an Indian hospital.

Last 6 months revenue (most recent first):
${months.map(m => `${m.month}: ₹${m.revenue.toLocaleString("en-IN")}`).join("\n")}

Currently admitted: ${admissions?.length || 0} patients

Based on the trend, forecast next month:
Return ONLY JSON:
{"forecast_amount":4500000,"growth_vs_last_month":8.5,"confidence":"medium","key_driver":"IPD admissions trending upward","risk_factor":"Insurance AR delay may impact collection"}`,
        maxTokens: 200,
      });

      const parsed = JSON.parse(response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      setForecast(parsed);

      await supabase.from("ai_feature_logs").insert({
        hospital_id: hospitalId,
        module: "analytics",
        feature_key: "revenue_forecast",
        input_summary: `6-month trend, ${admissions?.length || 0} current admissions`,
        output_summary: `Forecast: ₹${parsed.forecast_amount}, Growth: ${parsed.growth_vs_last_month}%`,
        success: true,
      });
    } catch (e) {
      console.error("Forecast error:", e);
    }
    setLoading(false);
  };

  const growth = forecast?.growth_vs_last_month || 0;
  const isPositive = growth >= 0;

  const confidenceBadge = (c: string) => {
    if (c === "high") return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (c === "medium") return "bg-warning/10 text-warning border-warning/20";
    return "bg-muted text-muted-foreground";
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">📈 Next Month Revenue Forecast</h3>
        {!forecast && (
          <Button size="sm" className="text-[11px] h-7 gap-1" onClick={runForecast} disabled={loading}>
            {loading ? <Loader2 size={12} className="animate-spin" /> : <TrendingUp size={12} />}
            {loading ? "Forecasting..." : "Generate Forecast"}
          </Button>
        )}
      </div>

      {forecast ? (
        <>
          <div className="flex items-end gap-3">
            <span className="text-3xl font-bold text-accent tabular-nums">
              {fmt(forecast.forecast_amount)}
            </span>
            <div className={cn(
              "flex items-center gap-1 text-sm font-bold pb-1",
              isPositive ? "text-emerald-600" : "text-destructive"
            )}>
              {isPositive ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
              {isPositive ? "+" : ""}{growth.toFixed(1)}%
            </div>
            <Badge variant="outline" className={cn("text-[10px] ml-2", confidenceBadge(forecast.confidence))}>
              {forecast.confidence.toUpperCase()} confidence
            </Badge>
          </div>

          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <TrendingUp size={12} className="text-emerald-600 mt-0.5 flex-shrink-0" />
              <p className="text-[12px] text-foreground">{forecast.key_driver}</p>
            </div>
            <div className="flex items-start gap-2 bg-warning/5 border border-warning/20 rounded-lg px-3 py-2">
              <AlertTriangle size={12} className="text-warning mt-0.5 flex-shrink-0" />
              <p className="text-[11px] text-warning">{forecast.risk_factor}</p>
            </div>
          </div>

          <Button variant="ghost" size="sm" className="text-[11px] text-muted-foreground" onClick={runForecast} disabled={loading}>
            {loading ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
            Refresh Forecast
          </Button>
        </>
      ) : !loading ? (
        <p className="text-[12px] text-muted-foreground">
          AI will analyse 6 months of revenue trend + current admissions to predict next month's collection.
        </p>
      ) : (
        <div className="flex items-center gap-2 py-4 text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Analysing revenue trends...</span>
        </div>
      )}
    </div>
  );
};

export default RevenueForecastCard;

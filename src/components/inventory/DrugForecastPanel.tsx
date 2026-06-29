import React, { useState } from "react";
import { callAI } from "@/lib/aiProvider";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { BarChart3, Loader2, ShoppingCart, TrendingUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface ForecastResult {
  week1_forecast: number;
  week2_forecast: number;
  week3_forecast: number;
  week4_forecast: number;
  total_4_weeks: number;
  trend: string;
  reorder_recommended: boolean;
  recommended_order_qty: number;
  reasoning: string;
}

interface Props {
  itemId: string;
  itemName: string;
  currentStock: number;
  hospitalId: string;
  onClose: () => void;
}

const DrugForecastPanel: React.FC<Props> = ({ itemId, itemName, currentStock, hospitalId, onClose }) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [forecast, setForecast] = useState<ForecastResult | null>(null);

  const runForecast = async () => {
    setLoading(true);
    try {
      // Get recent dispensing/consumption data (last 12 weeks approximation)
      const twelveWeeksAgo = new Date(Date.now() - 84 * 86400000).toISOString();
      const { data: dispensing } = await supabase
        .from("pharmacy_dispensing_items")
        .select("quantity_dispensed, created_at")
        .eq("hospital_id", hospitalId)
        .eq("drug_name", itemName)
        .gte("created_at", twelveWeeksAgo)
        .order("created_at", { ascending: false });

      // Group by week
      const weeklyMap: Record<number, number> = {};
      (dispensing || []).forEach((d: any) => {
        const weekNum = Math.floor((Date.now() - new Date(d.created_at).getTime()) / (7 * 86400000));
        weeklyMap[weekNum] = (weeklyMap[weekNum] || 0) + (d.quantity_dispensed || 0);
      });
      const weeklyConsumption = Array.from({ length: 12 }, (_, i) => ({
        week: i + 1,
        units_used: weeklyMap[i] || 0,
      }));

      // Get upcoming OT schedule
      const today = new Date().toISOString().split("T")[0];
      const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
      const { data: otNext7 } = await supabase
        .from("ot_schedules")
        .select("surgery_type")
        .eq("hospital_id", hospitalId)
        .gte("scheduled_date", today)
        .lte("scheduled_date", nextWeek);

      const response = await callAI({
        featureKey: "ai_digest",
        hospitalId,
        prompt: `Forecast drug demand for next 4 weeks.

Drug: ${itemName}
Current stock: ${currentStock} units

Weekly consumption (recent → older):
${weeklyConsumption.map(c => `Week ${c.week}: ${c.units_used} units`).join("\n")}

Upcoming surgeries next 7 days: ${otNext7?.length || 0}

Forecast next 4 weeks demand:
Return ONLY JSON:
{
  "week1_forecast": 45,
  "week2_forecast": 48,
  "week3_forecast": 42,
  "week4_forecast": 50,
  "total_4_weeks": 185,
  "trend": "stable",
  "reorder_recommended": true,
  "recommended_order_qty": 200,
  "reasoning": "Stable consumption with slight OT-driven spike"
}`,
        maxTokens: 200,
      });

      const parsed = JSON.parse(
        response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
      );
      setForecast(parsed);
    } catch {
      toast({ title: "Forecast unavailable", description: "AI service could not generate forecast", variant: "destructive" });
    }
    setLoading(false);
  };

  const handleGenerateIndent = async () => {
    if (!forecast) return;
    try {
      const indentNum = `IND-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 9000) + 1000}`;
      await (supabase as any).from("department_indents").insert({
        hospital_id: hospitalId,
        indent_number: indentNum,
        department_name: "Pharmacy",
        status: "pending",
        items: [{ item_name: itemName, item_id: itemId, quantity: forecast.recommended_order_qty, reason: `AI Forecast: ${forecast.reasoning}` }],
      });
      toast({ title: `✓ Indent ${indentNum} created for ${forecast.recommended_order_qty} units` });
    } catch (err: any) {
      toast({ title: "Failed to create indent", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
      <div className="bg-card rounded-xl border border-border shadow-xl w-[440px] max-h-[80vh] overflow-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <BarChart3 size={16} className="text-primary" />
            <h3 className="text-sm font-bold text-foreground">Demand Forecast</h3>
          </div>
          <button onClick={onClose}><X size={16} className="text-muted-foreground" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <p className="text-sm font-bold text-foreground">{itemName}</p>
            <p className="text-xs text-muted-foreground">Current stock: {currentStock} units</p>
          </div>

          {!forecast && !loading && (
            <Button onClick={runForecast} className="w-full text-xs h-10">
              <BarChart3 size={14} className="mr-1.5" /> Generate 4-Week Forecast
            </Button>
          )}

          {loading && (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2">
              <Loader2 size={16} className="animate-spin" /> Analysing consumption patterns…
            </div>
          )}

          {forecast && (
            <>
              {/* Weekly breakdown */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "Week 1", val: forecast.week1_forecast },
                  { label: "Week 2", val: forecast.week2_forecast },
                  { label: "Week 3", val: forecast.week3_forecast },
                  { label: "Week 4", val: forecast.week4_forecast },
                ].map(w => (
                  <div key={w.label} className="bg-muted/50 rounded-lg p-2.5 text-center">
                    <p className="text-[10px] text-muted-foreground">{w.label}</p>
                    <p className="text-lg font-bold text-foreground">{w.val}</p>
                  </div>
                ))}
              </div>

              <div className="bg-primary/5 rounded-lg p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Total 4-week demand</span>
                  <span className="text-base font-bold text-primary">{forecast.total_4_weeks} units</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Trend</span>
                  <span className={cn("text-xs font-bold capitalize",
                    forecast.trend === "rising" ? "text-amber-600" :
                    forecast.trend === "falling" ? "text-blue-600" : "text-emerald-600"
                  )}>
                    <TrendingUp size={12} className="inline mr-1" />{forecast.trend}
                  </span>
                </div>
              </div>

              <p className="text-xs text-muted-foreground italic">{forecast.reasoning}</p>

              {forecast.reorder_recommended && currentStock < forecast.total_4_weeks && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-bold text-amber-700">⚠️ Stock insufficient for forecasted demand</p>
                  <p className="text-xs text-amber-600">
                    Current: {currentStock} | Needed: {forecast.total_4_weeks} | Shortfall: {forecast.total_4_weeks - currentStock}
                  </p>
                  <Button size="sm" className="text-xs w-full" onClick={handleGenerateIndent}>
                    <ShoppingCart size={14} className="mr-1.5" /> Generate Indent ({forecast.recommended_order_qty} units)
                  </Button>
                </div>
              )}

              {currentStock >= forecast.total_4_weeks && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  <p className="text-xs font-bold text-emerald-700">✓ Stock sufficient for 4-week forecast</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DrugForecastPanel;

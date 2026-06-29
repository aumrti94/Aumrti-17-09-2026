import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { TrendingDown, TrendingUp, AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface Anomaly {
  date: string;
  actual: number;
  expected: number;
  z_score: number;
  deviation: number;
  direction: "spike" | "drop";
}

interface Result {
  anomalies: Anomaly[];
  days_analyzed: number;
  mean_daily_revenue: number;
  stddev: number;
  message?: string;
}

const inr = (n: number) =>
  `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });

interface Props {
  hospitalId: string | null;
}

const FinancialAnomalyCard: React.FC<Props> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const runCheck = async () => {
    if (!hospitalId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("financial-anomaly-check", {
        body: {},
      });
      if (error) throw new Error(error.message);
      setResult(data as Result);
      const count = (data as Result).anomalies.length;
      toast({
        title: count > 0 ? `${count} revenue anomaly${count > 1 ? "ies" : ""} detected` : "No anomalies detected",
        description: count > 0 ? "Review the flagged dates below." : "Revenue is within normal range for the last 60 days.",
        variant: count > 0 ? "destructive" : "default",
      });
    } catch (err: any) {
      toast({ title: "Anomaly check failed", description: err.message, variant: "destructive" });
    }
    setLoading(false);
  };

  return (
    <div className="border border-border rounded-xl p-4 bg-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-500" />
          <div>
            <p className="text-[13px] font-bold">Financial Anomaly Detector</p>
            <p className="text-[11px] text-muted-foreground">Z-score on 60-day daily revenue baseline</p>
          </div>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={runCheck} disabled={loading}>
          {loading ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Checking...</> : "Run Check"}
        </Button>
      </div>

      {result && (
        <div className="space-y-2">
          {/* Stats row */}
          <div className="flex items-center gap-4 text-[11px] text-muted-foreground border-b pb-2 mb-2">
            <span><strong>{result.days_analyzed}</strong> days analysed</span>
            <span>Avg daily: <strong>{inr(result.mean_daily_revenue)}</strong></span>
            <span>Std dev: <strong>{inr(result.stddev)}</strong></span>
            <span>Threshold: <strong>|z| ≥ 2.5σ</strong></span>
          </div>

          {result.message && (
            <p className="text-[12px] text-muted-foreground italic">{result.message}</p>
          )}

          {result.anomalies.length === 0 && !result.message && (
            <p className="text-[12px] text-emerald-700 flex items-center gap-1.5">
              <span className="text-emerald-500">✓</span> Revenue is within normal range for the last 60 days.
            </p>
          )}

          {result.anomalies.length > 0 && (
            <div className="space-y-1.5">
              {result.anomalies.map(a => (
                <div
                  key={a.date}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-[12px]",
                    a.direction === "drop"
                      ? "bg-red-50 border border-red-200"
                      : "bg-amber-50 border border-amber-200",
                  )}
                >
                  {a.direction === "drop"
                    ? <TrendingDown className="h-3.5 w-3.5 text-red-500 shrink-0" />
                    : <TrendingUp className="h-3.5 w-3.5 text-amber-600 shrink-0" />}
                  <span className="font-medium w-20 shrink-0">{fmtDate(a.date)}</span>
                  <span className={a.direction === "drop" ? "text-red-700" : "text-amber-700"}>
                    {a.direction === "drop" ? "Drop" : "Spike"}: {inr(a.actual)} vs expected {inr(a.expected)}
                  </span>
                  <span className="ml-auto">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px]",
                        a.direction === "drop" ? "border-red-300 text-red-700" : "border-amber-300 text-amber-700",
                      )}
                    >
                      {a.deviation > 0 ? "+" : ""}{inr(a.deviation)} · z={a.z_score}
                    </Badge>
                  </span>
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground flex items-center gap-1 pt-1">
                <AlertTriangle className="h-3 w-3" />
                Investigate these dates for billing errors, data entry gaps, or fraud signals.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FinancialAnomalyCard;

import React, { useState } from "react";
import { callAI } from "@/lib/aiProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, Loader2, Bot, ArrowRight, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Snapshot {
  ward_id: string;
  ward_name?: string;
  patient_count: number;
  high_acuity: number;
  medium_acuity: number;
  low_acuity: number;
  avg_news2: number | null;
  nurses_on_duty: number;
  required_nurses: number;
  ratio_met: boolean;
}

interface Reassignment {
  from_ward: string;
  to_ward: string;
  nurses_to_move: number;
  reason: string;
}

interface OptimizationResult {
  overall_status: "understaffed" | "balanced" | "overstaffed";
  critical_wards: string[];
  reassignments: Reassignment[];
  recommendation: string;
}

interface Props {
  snapshots: Snapshot[];
  hospitalId: string;
}

const NurseWorkloadOptimizerPanel: React.FC<Props> = ({ snapshots, hospitalId }) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);

  if (snapshots.length === 0) return null;

  const runOptimizer = async () => {
    setLoading(true);
    setResult(null);
    setRawText(null);

    try {
      const wardSummary = snapshots.map(s => {
        const acuityDesc = [
          s.high_acuity > 0 ? `${s.high_acuity} high` : null,
          s.medium_acuity > 0 ? `${s.medium_acuity} medium` : null,
          s.low_acuity > 0 ? `${s.low_acuity} low` : null,
        ].filter(Boolean).join(", ");
        return `${s.ward_name || s.ward_id}: ${s.patient_count} patients (${acuityDesc || "none"}), ${s.nurses_on_duty} nurses on duty, required: ${s.required_nurses}, ratio_met: ${s.ratio_met}, avg NEWS2: ${s.avg_news2 ?? "N/A"}`;
      }).join("\n");

      const response = await callAI({
        featureKey: "nurse_workload_optimizer",
        hospitalId,
        prompt: `You are a nursing operations AI for an Indian hospital. Analyse ward acuity and nurse staffing, then suggest workload rebalancing.

CURRENT WARD SNAPSHOT:
${wardSummary}

Recommend nurse reassignments to:
1. Ensure all understaffed wards meet minimum nurse-patient ratios
2. Move nurses from overstaffed low-acuity wards to understaffed high-acuity wards
3. Prioritise wards with high NEWS2 scores or many high-acuity patients

Return ONLY valid JSON:
{
  "overall_status": "understaffed|balanced|overstaffed",
  "critical_wards": ["Ward name — reason"],
  "reassignments": [
    {
      "from_ward": "Ward A",
      "to_ward": "Ward B",
      "nurses_to_move": 1,
      "reason": "Ward B has 3 high-acuity patients and is 2 nurses short of required ratio"
    }
  ],
  "recommendation": "Overall 1-2 sentence action plan for the nursing supervisor"
}

If all wards are adequately staffed, return reassignments as [] and overall_status as "balanced".`,
        maxTokens: 500,
      });

      if (response.error || !response.text) {
        setRawText("AI service unavailable.");
        setLoading(false);
        return;
      }

      try {
        const clean = response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(clean);
        setResult(parsed);
      } catch {
        setRawText(response.text);
      }
    } catch (err: any) {
      setRawText(`Optimization failed: ${err.message}`);
    }
    setLoading(false);
  };

  return (
    <div className="border rounded-lg overflow-hidden mt-4">
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <span className="text-[13px] font-bold">Nurse Workload Optimizer</span>
          {result?.critical_wards && result.critical_wards.length > 0 && (
            <Badge className="bg-red-100 text-red-700 border-red-300 text-[10px]">
              {result.critical_wards.length} critical ward(s)
            </Badge>
          )}
        </div>
        <Button size="sm" className="h-7 text-xs gap-1.5" onClick={runOptimizer} disabled={loading}>
          {loading
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Optimizing...</>
            : <><Bot className="h-3.5 w-3.5" /> Optimize Workload</>}
        </Button>
      </div>

      <div className="p-4 space-y-3">
        {result === null && !rawText && !loading && (
          <p className="text-[12px] text-muted-foreground text-center py-3">
            Click "Optimize Workload" to get AI-powered nurse rebalancing recommendations
          </p>
        )}

        {result && (
          <>
            <div className={cn(
              "rounded-lg border px-4 py-3 text-sm",
              result.overall_status === "understaffed" ? "bg-red-50 border-red-200" :
              result.overall_status === "balanced" ? "bg-emerald-50 border-emerald-200" :
              "bg-blue-50 border-blue-200"
            )}>
              <div className="flex items-center gap-2 mb-1.5">
                {result.overall_status === "balanced"
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  : <Users className="h-4 w-4 text-primary" />}
                <span className="font-bold text-[13px]">
                  {result.overall_status === "understaffed" ? "Staffing Gaps Detected" :
                   result.overall_status === "balanced" ? "Staffing Balanced" :
                   "Review Allocation"}
                </span>
              </div>
              {result.critical_wards.length > 0 && (
                <ul className="space-y-0.5 mb-2">
                  {result.critical_wards.map((w, i) => (
                    <li key={i} className="text-[11px] text-red-700">• {w}</li>
                  ))}
                </ul>
              )}
              <p className="text-[12px]">→ {result.recommendation}</p>
            </div>

            {result.reassignments.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">
                  Suggested Reassignments
                </p>
                <div className="space-y-1.5">
                  {result.reassignments.map((r, i) => (
                    <div key={i} className="rounded border bg-card px-3 py-2 text-xs">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-semibold">{r.from_ward}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <span className="font-semibold">{r.to_ward}</span>
                        <Badge variant="outline" className="text-[9px] ml-auto">
                          {r.nurses_to_move} nurse{r.nurses_to_move > 1 ? "s" : ""}
                        </Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground">{r.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.reassignments.length === 0 && result.overall_status === "balanced" && (
              <div className="flex items-center gap-1.5 text-[11px] text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> All wards adequately staffed — no reassignments needed
              </div>
            )}

            <p className="text-[10px] text-muted-foreground italic">
              AI recommendation only. Nursing supervisor must approve all reassignments.
            </p>
          </>
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

export default NurseWorkloadOptimizerPanel;

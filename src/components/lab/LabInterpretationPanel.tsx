import React, { useState } from "react";
import { callAI } from "@/lib/aiProvider";
import { useAIFeature } from "@/hooks/useAIFeature";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FlaskConical, Loader2, Bot, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface LabItem {
  test_name: string;
  result_value: string | null;
  result_numeric: number | null;
  result_flag: string | null;
  unit?: string | null;
  normal_min?: number | null;
  normal_max?: number | null;
  reference_range?: string | null;
}

interface Differential {
  diagnosis: string;
  likelihood: "high" | "moderate" | "low";
  supporting_findings: string[];
  suggested_tests: string[];
  urgency: "immediate" | "routine" | "elective";
}

interface Props {
  results: LabItem[];
  hospitalId: string;
  patientId: string;
}

const LIKELIHOOD_STYLE: Record<string, string> = {
  high: "bg-red-50 border-red-200",
  moderate: "bg-amber-50 border-amber-200",
  low: "bg-blue-50 border-blue-200",
};

const LIKELIHOOD_BADGE: Record<string, string> = {
  high: "border-red-400 text-red-700",
  moderate: "border-amber-400 text-amber-700",
  low: "border-blue-400 text-blue-700",
};

const URGENCY_BADGE: Record<string, string> = {
  immediate: "bg-red-100 text-red-700 border-red-300",
  routine: "bg-amber-100 text-amber-700 border-amber-300",
  elective: "bg-muted text-muted-foreground",
};

const LabInterpretationPanel: React.FC<Props> = ({ results, hospitalId, patientId }) => {
  const __aiOn = useAIFeature("lab_auto_interpreter");
  const [loading, setLoading] = useState(false);
  const [differentials, setDifferentials] = useState<Differential[] | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);

  const hasResults = results.some(r => r.result_value);
  if (!hasResults) return null;

  const runInterpretation = async () => {
    setLoading(true);
    setDifferentials(null);
    setRawText(null);

    try {
      const abnormal = results.filter(r =>
        r.result_value && (r.result_flag === "high" || r.result_flag === "low" || r.result_flag === "critical")
      );
      const allResults = results.filter(r => r.result_value);

      const resultSummary = allResults.map(r => {
        const range = r.reference_range || (r.normal_min != null && r.normal_max != null ? `${r.normal_min}–${r.normal_max}` : "N/A");
        return `${r.test_name}: ${r.result_value} ${r.unit || ""} (Ref: ${range}) ${r.result_flag ? `[${r.result_flag.toUpperCase()}]` : ""}`;
      }).join("\n");

      const response = await callAI({
        featureKey: "lab_auto_interpreter",
        hospitalId,
        prompt: `You are a clinical pathologist AI for an Indian hospital. Interpret this lab panel and suggest differential diagnoses.

LAB RESULTS:
${resultSummary}

${abnormal.length > 0 ? `Key abnormals: ${abnormal.map(r => `${r.test_name} ${r.result_flag}`).join(", ")}` : "All values within reference range."}

Based on this pattern, provide differential diagnoses. Consider Indian epidemiology (TB, typhoid, dengue, malaria, etc.).

Return ONLY valid JSON array (max 4 differentials):
[{
  "diagnosis": "Condition name",
  "likelihood": "high|moderate|low",
  "supporting_findings": ["Finding 1 that supports this diagnosis"],
  "suggested_tests": ["Test 1 to confirm or rule out"],
  "urgency": "immediate|routine|elective"
}]

Return [] if all results are normal and no differential is warranted.`,
        maxTokens: 700,
      });

      if (response.error || !response.text) {
        setRawText("AI service unavailable.");
        setLoading(false);
        return;
      }

      try {
        const clean = response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(clean);
        setDifferentials(Array.isArray(parsed) ? parsed : []);
      } catch {
        setRawText(response.text);
      }
    } catch (err: any) {
      setRawText(`Interpretation failed: ${err.message}`);
    }
    setLoading(false);
  };

  if (!__aiOn) return null;
  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
          <FlaskConical className="h-3.5 w-3.5 text-primary" />
          Lab Auto-Interpretation
          <Badge variant="outline" className="text-[9px] px-1.5">SaMD Class B</Badge>
        </div>
        <Button
          size="sm"
          className="h-6 text-[10px] gap-1"
          onClick={runInterpretation}
          disabled={loading}
        >
          {loading
            ? <><Loader2 className="h-3 w-3 animate-spin" /> Interpreting...</>
            : <><Bot className="h-3 w-3" /> Generate Differential</>}
        </Button>
      </div>

      <div className="p-3 space-y-2">
        {differentials === null && !rawText && !loading && (
          <p className="text-[11px] text-muted-foreground text-center py-2">
            Click "Generate Differential" to get AI-powered differential diagnoses based on the current lab results
          </p>
        )}

        {differentials !== null && differentials.length === 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> All results within normal range — no differential diagnosis warranted
          </div>
        )}

        {differentials?.map((d, i) => (
          <div key={i} className={cn("rounded border px-3 py-2 text-xs space-y-1.5", LIKELIHOOD_STYLE[d.likelihood])}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-[13px]">{d.diagnosis}</span>
              <Badge variant="outline" className={cn("text-[9px] px-1.5", LIKELIHOOD_BADGE[d.likelihood])}>
                {d.likelihood.toUpperCase()} likelihood
              </Badge>
              <Badge variant="outline" className={cn("text-[9px] px-1.5 ml-auto", URGENCY_BADGE[d.urgency])}>
                {d.urgency.toUpperCase()}
              </Badge>
            </div>
            {d.supporting_findings.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground mb-0.5">Supporting findings:</p>
                <ul className="space-y-0.5">
                  {d.supporting_findings.map((f, j) => (
                    <li key={j} className="text-[10px]">• {f}</li>
                  ))}
                </ul>
              </div>
            )}
            {d.suggested_tests.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground mb-0.5">Suggested follow-up tests:</p>
                <div className="flex flex-wrap gap-1">
                  {d.suggested_tests.map((t, j) => (
                    <span key={j} className="text-[10px] bg-white/60 rounded px-1.5 py-0.5 border">{t}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}

        {rawText && (
          <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap rounded border p-2 max-h-32 overflow-auto">
            {rawText}
          </pre>
        )}

        {differentials !== null && differentials.length > 0 && (
          <p className="text-[10px] text-muted-foreground italic">
            AI differential only — physician clinical correlation, history, and examination are essential before diagnosis.
          </p>
        )}
      </div>
    </div>
  );
};

export default LabInterpretationPanel;

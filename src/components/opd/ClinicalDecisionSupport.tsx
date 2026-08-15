import React, { useState, useEffect } from "react";
import { callAI } from "@/lib/aiProvider";
import { toast } from "sonner";
import { useAIFeature } from "@/hooks/useAIFeature";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Brain, Loader2, FlaskConical, AlertTriangle, BookOpen, RefreshCw } from "lucide-react";

interface Props {
  diagnosis: string;
  icdCode: string;
  patientAge?: number;
  patientGender?: string;
  comorbidities?: string[];
  /**
   * The patient's history from the outside records they brought in, pre-formatted and
   * length-capped by formatDigestForPrompt (src/lib/historyDigest.ts).
   *
   * Matters most here of the three cards: "first-line treatment" is the wrong answer for a
   * patient who has already failed first line, and drug cautions are meaningless without
   * knowing what they are already taking. Neither fact exists anywhere in this hospital's
   * own records for a new patient.
   */
  priorHistory?: string;
  hospitalId: string | null;
  onAddLabOrder?: (testName: string) => void;
}

interface CDSResult {
  first_line_treatment: string;
  investigations_recommended: string[];
  drug_cautions: string[];
  referral_triggers: string[];
  guideline_source: string;
  red_flags: string[];
}

const ClinicalDecisionSupport: React.FC<Props> = ({
  diagnosis, icdCode, patientAge, patientGender, comorbidities, priorHistory,
  hospitalId, onAddLabOrder,
}) => {
  const __aiOn = useAIFeature("icd_coding");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CDSResult | null>(null);

  // Clear stale guidance when the diagnosis changes — the doctor regenerates on demand.
  useEffect(() => {
    setResult(null);
  }, [diagnosis, icdCode]);

  const fetchCDS = async () => {
    if (!hospitalId) return;
    setLoading(true);
    try {
      const response = await callAI({
        featureKey: "icd_coding",
        hospitalId,
        prompt: `Provide clinical decision support for this Indian hospital patient.

Diagnosis: ${diagnosis} ${icdCode ? `(${icdCode})` : ""}
Patient: ${patientAge || "Unknown"}yrs, ${patientGender || "Unknown"}
Comorbidities: ${comorbidities?.join(", ") || "None"}
${priorHistory ? `\n${priorHistory}\nAccount for what this patient is already taking and what has already been tried: do not propose a first-line agent they have already failed, and flag any interaction with their current medications under drug_cautions.\n` : ""}
Return ONLY JSON:
{"first_line_treatment":"...","investigations_recommended":["CBC","LFT"],"drug_cautions":["Avoid NSAIDs if renal impairment"],"referral_triggers":["Refer cardiology if EF < 40%"],"guideline_source":"AHA 2023","red_flags":["Chest pain radiating to jaw"]}`,
        maxTokens: 300,
      });

      // Never fail silently. This used to be a bare `return` inside a swallowing catch: the
      // doctor clicked Generate, the spinner stopped, nothing appeared and nothing was logged —
      // which teaches doctors to distrust the whole AI Guidance tab.
      if (response.error) {
        toast.error("Could not generate guidance. Check AI configuration.");
        return;
      }
      const parsed = JSON.parse(
        response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
      );
      setResult(parsed);
    } catch {
      toast.error("AI returned an unreadable response. Try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!__aiOn) return null; // AI master or clinical-decision-support disabled
  if (!diagnosis || diagnosis.length < 3) return null;

  return (
    <div className="border border-border rounded-lg p-3 bg-muted/20 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <span className="text-xs font-bold text-foreground">Clinical Guidance</span>
        </div>
        <button
          onClick={fetchCDS}
          disabled={loading || !hospitalId || diagnosis.length < 3}
          className="flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-semibold bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          {loading ? "Generating..." : result ? "Regenerate" : "Generate Guidance"}
        </button>
      </div>

      {loading && !result && (
        <p className="text-[11px] text-muted-foreground animate-pulse">Analysing clinical context...</p>
      )}

      {!loading && !result && (
        <p className="text-[11px] text-muted-foreground">Click <b>Generate Guidance</b> for AI first-line treatment, investigations, drug cautions and red flags for this diagnosis.</p>
      )}

      {result && (
        <>
          {/* First-line treatment */}
          <div>
            <p className="text-[10px] text-muted-foreground font-semibold uppercase">First-line Treatment</p>
            <p className="text-xs text-foreground mt-0.5">{result.first_line_treatment}</p>
          </div>

          {/* Investigations */}
          {result.investigations_recommended?.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase flex items-center gap-1">
                <FlaskConical className="h-3 w-3" /> Recommended Investigations
              </p>
              <div className="flex flex-wrap gap-1 mt-1">
                {result.investigations_recommended.map((test, i) => (
                  <button
                    key={i}
                    onClick={() => onAddLabOrder?.(test)}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors cursor-pointer"
                    title={`Click to add ${test} to lab orders`}
                  >
                    + {test}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Drug cautions */}
          {result.drug_cautions?.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase">Drug Cautions</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {result.drug_cautions.map((c, i) => (
                  <Badge key={i} variant="secondary" className="text-[9px] bg-amber-50 text-amber-700 border-amber-200">
                    ⚠️ {c}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Red flags */}
          {result.red_flags?.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-destructive" /> Red Flags
              </p>
              <div className="flex flex-wrap gap-1 mt-1">
                {result.red_flags.map((f, i) => (
                  <Badge key={i} variant="destructive" className="text-[9px]">
                    🚨 {f}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Source */}
          {result.guideline_source && (
            <p className="text-[9px] text-muted-foreground flex items-center gap-1">
              <BookOpen className="h-2.5 w-2.5" /> Source: {result.guideline_source}
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default ClinicalDecisionSupport;

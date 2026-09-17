import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { callAI } from "@/lib/aiProvider";
import { Bot, Loader2, AlertTriangle, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAIFeature } from "@/hooks/useAIFeature";

interface DenialPrediction {
  denial_probability: number;
  risk_level: string;
  top_denial_risks: string[];
  fix_before_submit: string[];
}

interface Props {
  claimData: {
    tpa_name?: string;
    scheme_name?: string;
    package_name?: string;
    procedure?: string;
    claimed_amount: number;
    icd_code?: string;
    los_days?: number;
    documents_count?: number;
  };
  preAuthNumber?: string | null;
  hospitalId: string;
  onProceedSubmit: () => void;
  onRiskAssessed?: (score: number) => void;
  /** Called when the hospital chooses to proceed without an AI assessment (e.g. AI call failed
   * or no credentials are configured) — must unblock submission the same as a real score. */
  onSkip?: () => void;
}

const DenialPredictorPanel: React.FC<Props> = ({ claimData, preAuthNumber, hospitalId, onProceedSubmit, onRiskAssessed, onSkip }) => {
  const { toast } = useToast();
  const aiOn = useAIFeature("denial_predictor");
  const [loading, setLoading] = useState(false);
  const [prediction, setPrediction] = useState<DenialPrediction | null>(null);
  const [aiFailed, setAiFailed] = useState(false);

  if (!aiOn) {
    // AI master or denial-predictor feature disabled — claim submission must not depend on a
    // feature the hospital doesn't have turned on. Offer the same manual-proceed path as an AI
    // failure below, rather than disappearing and leaving the Submit button permanently
    // disabled (KNOWN-BUG-208).
    return (
      <div className="bg-muted/40 border border-border rounded-lg p-4 flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">AI risk assessment is not enabled for this hospital.</p>
        <Button size="sm" variant="outline" className="text-[11px] h-8" onClick={onSkip}>
          Continue without AI review
        </Button>
      </div>
    );
  }

  const runPrediction = async () => {
    setLoading(true);
    setAiFailed(false);
    try {
      const response = await callAI({
        featureKey: "denial_predictor",
        hospitalId,
        prompt: `Predict denial probability for this Indian insurance claim.

Claim details:
- TPA/Scheme: ${claimData.tpa_name || claimData.scheme_name || "Unknown"}
- Procedure: ${claimData.package_name || claimData.procedure || "Not specified"}
- Claimed amount: ₹${claimData.claimed_amount}
- Pre-auth obtained: ${preAuthNumber ? "Yes — " + preAuthNumber : "No"}
- Documents attached: ${claimData.documents_count || 0}
- ICD code: ${claimData.icd_code || "Not coded"}
- Admission days: ${claimData.los_days || "Not known"}

Based on common Indian insurance denial patterns, predict:

Return ONLY JSON:
{"denial_probability":35,"risk_level":"medium","top_denial_risks":["Pre-auth number not matching claim","Missing clinical notes"],"fix_before_submit":["Attach updated clinical summary","Verify pre-auth number matches"]}`,
        maxTokens: 250,
      });

      if (response.error || !response.text) {
        toast({ title: "Denial prediction unavailable", description: response.error || "AI returned empty response", variant: "destructive" });
        setAiFailed(true);
      } else {
        const parsed = JSON.parse(response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
        setPrediction(parsed);
        onRiskAssessed?.(parsed.denial_probability);

        await supabase.from("ai_feature_logs").insert({
          hospital_id: hospitalId,
          module: "insurance",
          feature_key: "denial_predictor",
          input_summary: `TPA: ${claimData.tpa_name || "?"}, Amount: ₹${claimData.claimed_amount}`,
          output_summary: `Risk: ${parsed.risk_level}, Probability: ${parsed.denial_probability}%`,
          success: true,
        });
      }
    } catch {
      toast({ title: "Denial prediction failed", description: "Could not parse AI response", variant: "destructive" });
      setAiFailed(true);
    }
    setLoading(false);
  };

  if (!prediction) {
    return (
      <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot size={16} className="text-primary" />
            <span className="text-sm font-bold text-foreground">AI Claim Risk Assessment</span>
          </div>
          <Button
            size="sm"
            className="text-[11px] h-8 gap-1.5"
            onClick={runPrediction}
            disabled={loading}
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Bot size={12} />}
            {loading ? "Analysing..." : "Run AI Assessment"}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          Predict denial probability before submission
        </p>
        {aiFailed && (
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-primary/10">
            <p className="text-[11px] text-destructive">AI assessment unavailable right now.</p>
            <Button size="sm" variant="outline" className="text-[11px] h-7" onClick={onSkip}>
              Continue without AI review
            </Button>
          </div>
        )}
      </div>
    );
  }

  const prob = prediction.denial_probability;
  const isLow = prob < 25;
  const isHigh = prob > 50;

  return (
    <div className={cn(
      "border rounded-lg p-4 space-y-3",
      isLow ? "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800" :
      isHigh ? "bg-destructive/5 border-destructive/20" :
      "bg-warning/5 border-warning/20"
    )}>
      <div className="flex items-center gap-2">
        <Bot size={16} className="text-primary" />
        <span className="text-sm font-bold text-foreground">🤖 AI Claim Risk Assessment</span>
      </div>

      {/* Probability bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground">Denial Probability</span>
          <span className={cn(
            "text-sm font-bold",
            isLow ? "text-emerald-700" : isHigh ? "text-destructive" : "text-warning"
          )}>
            {prob}%
          </span>
        </div>
        <Progress
          value={prob}
          className={cn("h-2.5", isLow ? "[&>div]:bg-emerald-500" : isHigh ? "[&>div]:bg-destructive" : "[&>div]:bg-warning")}
        />
        <p className={cn(
          "text-[11px] font-medium",
          isLow ? "text-emerald-700" : isHigh ? "text-destructive" : "text-warning"
        )}>
          {isLow ? "LOW RISK — Submit with confidence" :
           isHigh ? "HIGH RISK — Fix issues before submitting" :
           "MODERATE RISK — Review flagged items"}
        </p>
      </div>

      {/* Top risks */}
      {prediction.top_denial_risks.length > 0 && (
        <div>
          <span className="text-[11px] font-bold uppercase text-muted-foreground">Top Denial Risks</span>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {prediction.top_denial_risks.map((risk, i) => (
              <Badge key={i} variant="outline" className="text-[10px] bg-destructive/5 border-destructive/20 text-destructive">
                <AlertTriangle size={10} className="mr-1" /> {risk}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Fix before submit */}
      {prediction.fix_before_submit.length > 0 && (
        <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
          <span className="text-[11px] font-bold text-warning">Fix Before Submitting</span>
          <ol className="mt-1.5 space-y-1">
            {prediction.fix_before_submit.map((fix, i) => (
              <li key={i} className="text-[11px] text-foreground flex items-start gap-1.5">
                <span className="font-bold text-warning">{i + 1}.</span> {fix}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-1">
        <Button size="sm" className="flex-1 gap-1.5 text-[11px]" onClick={onProceedSubmit}>
          <CheckCircle size={12} /> {isHigh ? "I've reviewed — Submit Claim" : "Submit Claim"}
        </Button>
        {isHigh && (
          <Button size="sm" variant="ghost" className="text-[11px] text-muted-foreground" onClick={onProceedSubmit}>
            Submit Anyway
          </Button>
        )}
      </div>
    </div>
  );
};

export default DenialPredictorPanel;

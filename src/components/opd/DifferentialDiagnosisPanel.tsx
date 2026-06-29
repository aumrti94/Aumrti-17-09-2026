import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, AlertTriangle, Stethoscope, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import AIAttestationModal from "@/components/ai/AIAttestationModal";
import { useAIFeatureFlag } from "@/hooks/useAIFeatureFlag";

interface Differential {
  rank: number;
  diagnosis: string;
  icd10: string;
  confidence: number;
  supporting_features: string[];
  against_features: string[];
  recommended_investigations: string[];
  urgency: "emergent" | "urgent" | "routine";
}

interface DDxResult {
  differentials: Differential[];
  red_flags_detected: string[];
  suggested_referral: string | null;
  overall_urgency: string;
}

interface Props {
  chiefComplaint: string;
  age?: number;
  gender?: string;
  vitals?: Record<string, any>;
  examination?: string;
  history?: string;
  patientContext?: string;
  hospitalId?: string | null;
  patientId?: string | null;
  encounterId?: string | null;
  onSelectDiagnosis?: (diagnosis: string, icd10: string) => void;
}

const URGENCY_COLORS = {
  emergent: "bg-red-100 text-red-700",
  urgent: "bg-amber-100 text-amber-700",
  routine: "bg-emerald-100 text-emerald-700",
};

const CONFIDENCE_COLOR = (c: number) =>
  c >= 0.7 ? "text-red-600" : c >= 0.5 ? "text-amber-600" : "text-slate-500";

const DifferentialDiagnosisPanel: React.FC<Props> = ({
  chiefComplaint, age, gender, vitals, examination, history, patientContext,
  hospitalId, patientId, encounterId,
  onSelectDiagnosis,
}) => {
  const ddxEnabled = useAIFeatureFlag("differential_dx");
  const [result, setResult] = useState<DDxResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [pendingDiff, setPendingDiff] = useState<Differential | null>(null);

  if (!ddxEnabled) {
    return (
      <div className="border rounded-lg px-3 py-2.5 bg-muted/30 flex items-center gap-2">
        <Stethoscope className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">AI Differential Diagnosis is disabled by your administrator.</span>
      </div>
    );
  }

  const generate = async () => {
    if (!chiefComplaint.trim()) {
      toast.error("Enter chief complaint first.");
      return;
    }
    setLoading(true);
    setResult(null);
    const { data, error } = await supabase.functions.invoke("ai-differential-diagnosis", {
      body: { chief_complaint: chiefComplaint, age, gender, vitals, examination, history, patient_context: patientContext, hospital_id: hospitalId },
    });
    if (error || !data?.differentials) {
      toast.error("Could not generate differentials. Check AI configuration.");
    } else {
      setResult(data);
    }
    setLoading(false);
  };

  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Stethoscope className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold">AI Differential Diagnosis</span>
          {result && (
            <Badge variant="secondary" className={cn("text-[9px]", URGENCY_COLORS[result.overall_urgency as keyof typeof URGENCY_COLORS] || "")}>
              {result.overall_urgency}
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant={result ? "ghost" : "default"}
          className="h-7 text-xs gap-1"
          onClick={generate}
          disabled={loading}
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          {loading ? "Generating..." : result ? "Regenerate" : "Generate DDx"}
        </Button>
      </div>

      {result && (
        <div className="p-3 space-y-2">
          {/* Red flags */}
          {result.red_flags_detected?.length > 0 && (
            <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-red-700">Red Flags Detected</p>
                <p className="text-xs text-red-600">{result.red_flags_detected.join(" · ")}</p>
              </div>
            </div>
          )}

          {/* Differentials list */}
          <div className="space-y-1.5">
            {result.differentials.map((d, i) => (
              <div key={i} className={cn(
                "border rounded-lg overflow-hidden",
                d.rank === 1 ? "border-primary/30 bg-primary/5" : "border-border"
              )}>
                <div
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/30"
                  onClick={() => setExpanded(expanded === i ? null : i)}
                >
                  <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold shrink-0">
                    {d.rank}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold truncate">{d.diagnosis}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">{d.icd10}</span>
                      <Badge variant="secondary" className={cn("text-[9px]", URGENCY_COLORS[d.urgency] || "")}>
                        {d.urgency}
                      </Badge>
                    </div>
                  </div>
                  <span className={cn("text-xs font-bold shrink-0", CONFIDENCE_COLOR(d.confidence))}>
                    {Math.round(d.confidence * 100)}%
                  </span>
                  {expanded === i
                    ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                </div>

                {expanded === i && (
                  <div className="px-3 pb-3 pt-1 space-y-2 border-t">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {d.supporting_features.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-emerald-700 mb-1">Supporting</p>
                          {d.supporting_features.map((f, j) => (
                            <p key={j} className="text-muted-foreground">✓ {f}</p>
                          ))}
                        </div>
                      )}
                      {d.against_features.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-amber-700 mb-1">Against</p>
                          {d.against_features.map((f, j) => (
                            <p key={j} className="text-muted-foreground">✗ {f}</p>
                          ))}
                        </div>
                      )}
                    </div>

                    {d.recommended_investigations.length > 0 && (
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground mb-1">Investigations</p>
                        <div className="flex flex-wrap gap-1">
                          {d.recommended_investigations.map((inv, j) => (
                            <Badge key={j} variant="secondary" className="text-[9px]">{inv}</Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {onSelectDiagnosis && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs w-full mt-1"
                        onClick={() => setPendingDiff(d)}
                      >
                        → Use as Diagnosis
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {result.suggested_referral && (
            <div className="flex items-start gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
              <AlertTriangle className="h-3.5 w-3.5 text-blue-600 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700">Referral suggested: {result.suggested_referral}</p>
            </div>
          )}
        </div>
      )}

      {pendingDiff && onSelectDiagnosis && (
        <AIAttestationModal
          open={!!pendingDiff}
          title="AI Differential Diagnosis — Doctor Review Required"
          feature="differential_dx"
          sourceId={encounterId ?? undefined}
          hospitalId={hospitalId ?? ""}
          aiOutput={pendingDiff as unknown as Record<string, unknown>}
          previewContent={[
            `Diagnosis: ${pendingDiff.diagnosis} (${pendingDiff.icd10})`,
            `Urgency: ${pendingDiff.urgency} | Confidence: ${Math.round(pendingDiff.confidence * 100)}%`,
            pendingDiff.supporting_features.length > 0
              ? `\nSupporting:\n${pendingDiff.supporting_features.map(f => `  + ${f}`).join("\n")}`
              : "",
            pendingDiff.against_features.length > 0
              ? `\nAgainst:\n${pendingDiff.against_features.map(f => `  - ${f}`).join("\n")}`
              : "",
            pendingDiff.recommended_investigations.length > 0
              ? `\nInvestigations: ${pendingDiff.recommended_investigations.join(", ")}`
              : "",
          ].filter(Boolean).join("\n")}
          initialEditableText={pendingDiff.diagnosis}
          editableLabel="Diagnosis Text (edit before saving)"
          onAccept={(editedText) => {
            onSelectDiagnosis(editedText, pendingDiff.icd10);
            toast.success(`Diagnosis set to ${editedText}`);
            setPendingDiff(null);
          }}
          onDiscard={() => setPendingDiff(null)}
        />
      )}
    </div>
  );
};

export default DifferentialDiagnosisPanel;

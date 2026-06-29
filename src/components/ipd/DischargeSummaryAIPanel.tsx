import React, { useState } from "react";
import { Bot, Loader2, ChevronDown, ChevronUp, Copy, AlertTriangle, Pill, Calendar, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAIAudit } from "@/hooks/useAIAudit";
import { useAIFeatureFlag } from "@/hooks/useAIFeatureFlag";
import AIAttestationModal from "@/components/ai/AIAttestationModal";
import { cn } from "@/lib/utils";

interface DischargeMed {
  drug: string;
  dose: string;
  frequency: string;
  duration: string;
  instructions: string;
}

interface StructuredSummary {
  final_diagnosis: string;
  procedures_performed: string[];
  hospital_course: string;
  discharge_medications: DischargeMed[];
  diet_instructions: string;
  activity_restrictions: string;
  follow_up_appointments: string[];
  red_flag_symptoms: string[];
  emergency_contact_note: string;
  patient_friendly_summary: string;
  confidence: number;
  reasoning?: string;
}

interface Props {
  admissionId: string;
  hospitalId: string;
  patientId?: string;
}

const DischargeSummaryAIPanel: React.FC<Props> = ({ admissionId, hospitalId, patientId }) => {
  const { logAudit } = useAIAudit();
  const dischargeSummaryEnabled = useAIFeatureFlag("discharge_summary");
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<StructuredSummary | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [actioned, setActioned] = useState(false);
  const [showAttestation, setShowAttestation] = useState(false);

  const generate = async () => {
    setLoading(true);
    setSummary(null);
    try {
      const { data, error } = await supabase.functions.invoke("ai-discharge-summary", {
        body: { admission_id: admissionId },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      setSummary(data.structured as StructuredSummary);
      setExpanded(true);
    } catch (e: any) {
      toast.error(`AI discharge summary failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async () => {
    if (!summary) return;
    setShowAttestation(true);
  };

  const finalizeAccept = async () => {
    if (!summary) return;
    await logAudit(
      {
        hospitalId,
        patientId,
        featureKey: "discharge_summary_structured",
        aiOutput: summary as unknown as Record<string, unknown>,
        confidence: summary.confidence,
        reasoning: summary.reasoning,
      },
      "accepted"
    );
    toast.success("Structured summary accepted and logged");
    setActioned(true);
    setShowAttestation(false);
  };

  const handleDismiss = async () => {
    if (!summary) return;
    await logAudit(
      {
        hospitalId,
        patientId,
        featureKey: "discharge_summary_structured",
        aiOutput: summary as unknown as Record<string, unknown>,
        confidence: summary.confidence,
      },
      "rejected"
    );
    setSummary(null);
    setActioned(false);
  };

  const copyPatientFriendly = () => {
    if (!summary?.patient_friendly_summary) return;
    navigator.clipboard.writeText(summary.patient_friendly_summary);
    toast.success("Patient summary copied");
  };

  const confidenceColor = summary
    ? summary.confidence >= 0.8 ? "bg-emerald-100 text-emerald-700"
      : summary.confidence >= 0.6 ? "bg-amber-100 text-amber-700"
      : "bg-red-100 text-red-700"
    : "";

  if (!dischargeSummaryEnabled) {
    return (
      <div className="border rounded-lg px-3 py-2.5 bg-muted/30 flex items-center gap-2">
        <Bot className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">AI Discharge Summary is disabled by your administrator.</span>
      </div>
    );
  }

  const summaryPreviewText = summary ? [
    `Final Diagnosis: ${summary.final_diagnosis}`,
    summary.procedures_performed?.length > 0 ? `Procedures: ${summary.procedures_performed.join(", ")}` : "",
    `Hospital Course:\n${summary.hospital_course}`,
    summary.discharge_medications?.length > 0
      ? `Medications:\n${summary.discharge_medications.map(m => `  ${m.drug} ${m.dose} ${m.frequency} × ${m.duration}`).join("\n")}`
      : "",
    `Diet: ${summary.diet_instructions}`,
    `Activity: ${summary.activity_restrictions}`,
    summary.follow_up_appointments?.length > 0 ? `Follow-up: ${summary.follow_up_appointments.join("; ")}` : "",
    summary.red_flag_symptoms?.length > 0 ? `Return if: ${summary.red_flag_symptoms.join(", ")}` : "",
  ].filter(Boolean).join("\n\n") : "";

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 bg-muted/40 cursor-pointer"
        onClick={() => summary && setExpanded(v => !v)}
      >
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">AI Structured Discharge Summary</span>
          {summary && (
            <Badge variant="secondary" className={cn("text-[10px]", confidenceColor)}>
              {Math.round(summary.confidence * 100)}% confidence
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!summary && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); generate(); }} disabled={loading}>
              {loading ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Generating...</> : <><Bot className="h-3 w-3 mr-1" /> Generate</>}
            </Button>
          )}
          {summary && (expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />)}
        </div>
      </div>

      {/* Structured output */}
      {summary && expanded && (
        <div className="p-3 space-y-3 bg-card">
          {summary.reasoning && (
            <p className="text-[11px] italic text-muted-foreground border-l-2 border-primary/30 pl-2">
              {summary.reasoning}
            </p>
          )}

          {/* Diagnosis */}
          <Section label="Final Diagnosis">
            <p className="text-sm">{summary.final_diagnosis}</p>
          </Section>

          {/* Procedures */}
          {summary.procedures_performed?.length > 0 && (
            <Section label="Procedures Performed">
              <ul className="list-disc list-inside text-sm space-y-0.5">
                {summary.procedures_performed.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </Section>
          )}

          {/* Hospital Course */}
          <Section label="Hospital Course">
            <p className="text-sm leading-relaxed">{summary.hospital_course}</p>
          </Section>

          {/* Medications */}
          {summary.discharge_medications?.length > 0 && (
            <Section label="Discharge Medications" icon={<Pill className="h-3.5 w-3.5" />}>
              <div className="space-y-1">
                {summary.discharge_medications.map((m, i) => (
                  <div key={i} className="flex items-start gap-2 bg-muted/30 rounded px-2 py-1.5">
                    <span className="text-[10px] font-bold text-muted-foreground shrink-0 mt-0.5">{i + 1}.</span>
                    <div className="text-xs">
                      <span className="font-semibold">{m.drug}</span>
                      {m.dose && <span className="text-muted-foreground"> — {m.dose}</span>}
                      {m.frequency && <span className="ml-1 text-[10px] bg-secondary px-1 rounded">{m.frequency}</span>}
                      {m.duration && <span className="text-muted-foreground"> × {m.duration}</span>}
                      {m.instructions && <div className="text-[10px] text-muted-foreground italic mt-0.5">{m.instructions}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Diet + Activity */}
          <div className="grid grid-cols-2 gap-3">
            {summary.diet_instructions && (
              <Section label="Diet">
                <p className="text-xs">{summary.diet_instructions}</p>
              </Section>
            )}
            {summary.activity_restrictions && (
              <Section label="Activity" icon={<Activity className="h-3.5 w-3.5" />}>
                <p className="text-xs">{summary.activity_restrictions}</p>
              </Section>
            )}
          </div>

          {/* Follow-up */}
          {summary.follow_up_appointments?.length > 0 && (
            <Section label="Follow-up" icon={<Calendar className="h-3.5 w-3.5" />}>
              <ul className="text-xs space-y-0.5">
                {summary.follow_up_appointments.map((f, i) => <li key={i} className="flex items-center gap-1">→ {f}</li>)}
              </ul>
            </Section>
          )}

          {/* Red flags */}
          {summary.red_flag_symptoms?.length > 0 && (
            <Section label="Return Immediately If" icon={<AlertTriangle className="h-3.5 w-3.5 text-red-500" />}>
              <div className="flex flex-wrap gap-1">
                {summary.red_flag_symptoms.map((s, i) => (
                  <Badge key={i} variant="secondary" className="text-[10px] bg-red-50 text-red-700">{s}</Badge>
                ))}
              </div>
            </Section>
          )}

          {/* Patient-friendly summary */}
          {summary.patient_friendly_summary && (
            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold text-blue-700">Patient-Friendly Summary</span>
                <Button size="sm" variant="ghost" className="h-6 text-[10px] text-blue-600 gap-1 px-2" onClick={copyPatientFriendly}>
                  <Copy className="h-3 w-3" /> Copy
                </Button>
              </div>
              <p className="text-xs text-blue-800 leading-relaxed">{summary.patient_friendly_summary}</p>
              <p className="text-[10px] text-blue-600 mt-1 italic">{summary.emergency_contact_note}</p>
            </div>
          )}

          {/* Action buttons */}
          {!actioned && (
            <div className="flex gap-2 pt-1">
              <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={handleAccept}>
                Accept Summary
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={generate} disabled={loading}>
                {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null} Regenerate
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" onClick={handleDismiss}>
                Dismiss
              </Button>
            </div>
          )}
          {actioned && (
            <p className="text-xs text-emerald-600 font-medium">✓ Summary accepted and logged</p>
          )}
        </div>
      )}

      {summary && (
        <AIAttestationModal
          open={showAttestation}
          title="AI Discharge Summary — Doctor Attestation Required"
          feature="discharge_summary"
          sourceId={admissionId}
          hospitalId={hospitalId}
          aiOutput={summary as unknown as Record<string, unknown>}
          previewContent={summaryPreviewText}
          initialEditableText={summary.patient_friendly_summary || ""}
          editableLabel="Patient-Friendly Summary (edit before saving)"
          onAccept={() => finalizeAccept()}
          onDiscard={() => setShowAttestation(false)}
        />
      )}
    </div>
  );
};

const Section: React.FC<{ label: string; children: React.ReactNode; icon?: React.ReactNode }> = ({ label, children, icon }) => (
  <div>
    <div className="flex items-center gap-1 mb-1">
      {icon}
      <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">{label}</span>
    </div>
    {children}
  </div>
);

export default DischargeSummaryAIPanel;

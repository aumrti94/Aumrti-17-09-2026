import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { X, Check, Copy, RefreshCw, Loader2, AlertTriangle, Globe } from "lucide-react";
import { useVoiceScribe, SUPPORTED_LANGUAGES } from "@/contexts/VoiceScribeContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAIAudit } from "@/hooks/useAIAudit";

interface DrugItem {
  drug_name: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  instructions: string;
}

const VoiceScribePanel: React.FC = () => {
  const {
    isPanelOpen, setIsPanelOpen, panelState, setPanelState,
    rawTranscript, setRawTranscript, structuredOutput, setStructuredOutput,
    currentSessionType, currentPatientId, applyToCurrentScreen, resetSession,
    selectedLanguage, fallbackReason, setFallbackReason,
  } = useVoiceScribe();
  const { toast } = useToast();
  const { logAudit } = useAIAudit();

  // Editable local state from structured output
  const [editableData, setEditableData] = useState<Record<string, unknown>>({});
  const [retrying, setRetrying] = useState(false);
  const [hospitalId, setHospitalId] = useState<string>("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      (supabase as any).from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle()
        .then(({ data }: any) => { if (data?.hospital_id) setHospitalId(data.hospital_id); });
    });
  }, []);

  useEffect(() => {
    if (structuredOutput) {
      setEditableData({ ...structuredOutput });
    }
  }, [structuredOutput]);

  const currentLangOption = SUPPORTED_LANGUAGES.find(l => l.code === selectedLanguage);
  const isSarvam = currentLangOption?.engine === "sarvam";

  if (!isPanelOpen) return null;

  const confidence = typeof editableData.confidence === "number" ? editableData.confidence : 1;
  const confidencePercent = Math.round(confidence * 100);

  const updateField = (key: string, value: unknown) => {
    const next = { ...editableData, [key]: value };
    setEditableData(next);
    setStructuredOutput(next);
  };

  const updateDrug = (index: number, field: string, value: string) => {
    const drugs = [...((editableData.prescription as DrugItem[]) || [])];
    drugs[index] = { ...drugs[index], [field]: value };
    updateField("prescription", drugs);
  };

  const removeDrug = (index: number) => {
    const drugs = ((editableData.prescription as DrugItem[]) || []).filter((_, i) => i !== index);
    updateField("prescription", drugs);
  };

  const addEmptyDrug = () => {
    const drugs = [...((editableData.prescription as DrugItem[]) || []),
      { drug_name: "", dose: "", route: "Oral", frequency: "OD", duration: "", instructions: "" }];
    updateField("prescription", drugs);
  };

  const removeInvestigation = (index: number) => {
    const inv = ((editableData.investigations as string[]) || []).filter((_, i) => i !== index);
    updateField("investigations", inv);
  };

  const handleApply = () => {
    applyToCurrentScreen();
    if (hospitalId && structuredOutput) {
      logAudit(
        {
          hospitalId,
          featureKey: `voice_scribe_${currentSessionType}`,
          aiOutput: structuredOutput,
          confidence: typeof structuredOutput.confidence === "number" ? structuredOutput.confidence : undefined,
          reasoning: typeof structuredOutput.reasoning === "string" ? structuredOutput.reasoning : undefined,
        },
        "accepted"
      );
    }
    toast({ title: "✓ Notes applied to consultation" });
    setTimeout(() => {
      setIsPanelOpen(false);
      resetSession();
    }, 1500);
  };

  const applyLabel = currentSessionType === "opd_consultation" ? "Apply to Consultation"
    : currentSessionType === "ward_round" ? "Apply to Ward Round"
    : currentSessionType === "emergency" ? "Apply to Emergency Entry"
    : currentSessionType === "nursing_note" ? "Apply to Nursing Task"
    : "Apply to Screen";

  const handleCopyText = () => {
    let text = "";
    if (currentSessionType === "opd_consultation") {
      text = `Chief Complaint: ${editableData.chief_complaint || ""}
History of Present Illness: ${editableData.history_of_present_illness || ""}
Examination Findings: ${editableData.examination_findings || ""}
Diagnosis: ${editableData.diagnosis || ""}
${editableData.icd_suggestion ? `ICD-10: ${editableData.icd_suggestion}` : ""}
Prescription:
${((editableData.prescription as DrugItem[]) || []).map(d =>
  `- ${d.drug_name} ${d.dose} ${d.frequency} × ${d.duration} days${d.instructions ? ` (${d.instructions})` : ""}`
).join("\n") || "None"}
Plan: ${editableData.plan || ""}
Follow Up: ${editableData.follow_up || ""}
Investigations: ${((editableData.investigations as string[]) || []).join(", ") || "None"}`;
    } else if (currentSessionType === "ward_round") {
      text = `S: ${editableData.subjective || ""}
O: ${editableData.objective || ""}
A: ${editableData.assessment || ""}
P: ${editableData.plan || ""}`;
    } else if (currentSessionType === "emergency") {
      text = `Presenting Complaint: ${editableData.presenting_complaint || ""}
History: ${editableData.history || ""}
Working Diagnosis: ${editableData.working_diagnosis || ""}
Immediate Management: ${editableData.immediate_management || ""}
Investigations: ${((editableData.investigations_ordered as string[]) || []).join(", ") || "None"}`;
    } else if (currentSessionType === "nursing_note") {
      text = `Observation: ${editableData.observation || ""}
Interventions: ${editableData.interventions || ""}
Patient Response: ${editableData.patient_response || ""}
Handover: ${editableData.handover_note || ""}`;
    } else {
      text = JSON.stringify(editableData, null, 2);
    }
    navigator.clipboard.writeText(text.trim());
    toast({ title: "Notes copied to clipboard ✓" });
  };

  const handleRetry = async () => {
    if (!rawTranscript.trim()) return;
    setRetrying(true);
    setFallbackReason("");
    setPanelState("processing");
    try {
      const { data, error } = await supabase.functions.invoke("ai-clinical-voice", {
        body: { transcript: rawTranscript, context_type: currentSessionType, patient_id: currentPatientId ?? undefined },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      setStructuredOutput(data.structured);
      setPanelState("output");
    } catch (err) {
      const reason = err instanceof Error ? err.message : "AI structuring failed";
      setFallbackReason(reason);
      setPanelState("fallback");
    } finally {
      setRetrying(false);
    }
  };

  const handleReRecord = () => {
    if (hospitalId && structuredOutput) {
      logAudit(
        {
          hospitalId,
          featureKey: `voice_scribe_${currentSessionType}`,
          aiOutput: structuredOutput,
          confidence: typeof structuredOutput.confidence === "number" ? structuredOutput.confidence : undefined,
        },
        "rejected"
      );
    }
    resetSession();
    setIsPanelOpen(false);
  };

  // -- RENDER --
  return (
    <div className="fixed right-4 bottom-20 z-50 w-[380px] bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col max-h-[520px] overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
      {/* HEADER */}
      <div className={cn(
        "flex items-center justify-between px-4 py-3 flex-shrink-0",
        panelState === "output" ? "bg-emerald-500" :
        panelState === "processing" || panelState === "transcribing" ? "bg-[#1A2F5A]" :
        panelState === "fallback" ? "bg-amber-500" :
        panelState === "recording" && isSarvam ? "bg-red-600" : "bg-slate-600"
      )}>
        <div className="flex items-center gap-2">
          {(panelState === "processing" || panelState === "transcribing") && <Loader2 className="h-4 w-4 text-white animate-spin" />}
          {panelState === "recording" && isSarvam && <Globe className="h-4 w-4 text-white" />}
          <span className="text-sm font-bold text-white">
            {panelState === "transcribing" ? `Transcribing ${currentLangOption?.label || ""}…` :
             panelState === "processing" ? "AI structuring your notes…" :
             panelState === "output" ? "✓ Notes Structured" :
             panelState === "fallback" ? "⚠ Raw Transcript" :
             panelState === "recording" && isSarvam ? `🎤 Recording in ${currentLangOption?.label}` :
             "Voice Scribe"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {panelState === "recording" && currentLangOption && (
            <span className="text-[10px] text-white bg-white/20 rounded-full px-2 py-0.5">
              {currentLangOption.flag} {currentLangOption.label}
            </span>
          )}
          {panelState === "output" && (
            <span className="text-[11px] text-white bg-white/20 rounded-full px-2 py-0.5">
              {confidencePercent}%
            </span>
          )}
          <button onClick={() => setIsPanelOpen(false)} className="text-white/70 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* RECORDING STATE — Sarvam batch info */}
      {panelState === "recording" && isSarvam && (
        <div className="flex-1 flex flex-col items-center justify-center py-12">
          <div className="flex gap-1 mb-4">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse [animation-delay:150ms]" />
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse [animation-delay:300ms]" />
          </div>
          <p className="text-sm text-muted-foreground font-medium">Recording in {currentLangOption?.label}…</p>
          <p className="text-xs text-muted-foreground/60 mt-1.5">Transcript will appear after you stop recording</p>
        </div>
      )}

      {/* TRANSCRIBING STATE (Sarvam processing) */}
      {panelState === "transcribing" && (
        <div className="flex-1 flex flex-col items-center justify-center py-16">
          <Loader2 className="h-8 w-8 text-primary animate-spin mb-3" />
          <p className="text-sm text-muted-foreground">Transcribing your {currentLangOption?.label || ""} dictation…</p>
          <p className="text-xs text-muted-foreground/60 mt-1">This takes a few seconds</p>
        </div>
      )}

      {/* PROCESSING STATE */}
      {panelState === "processing" && (
        <div className="flex-1 flex flex-col items-center justify-center py-16">
          <Loader2 className="h-8 w-8 text-primary animate-spin mb-3" />
          <p className="text-sm text-muted-foreground">Structuring your dictation…</p>
          <p className="text-xs text-muted-foreground/60 mt-1">This takes a few seconds</p>
        </div>
      )}

      {/* OUTPUT STATE */}
      {panelState === "output" && (
        <>
          {/* Confidence warning */}
          {confidence < 0.6 && (
            <div className="mx-3 mt-3 bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-amber-800">Low confidence ({confidencePercent}%) — please review carefully</p>
                <p className="text-[10px] text-amber-600 mt-0.5">The transcript may have been unclear. Edit as needed.</p>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {currentSessionType === "opd_consultation" && (
              <>
                {/* Chief Complaint */}
                <FieldSection label="Chief Complaint">
                  <textarea
                    rows={2}
                    value={(editableData.chief_complaint as string) || ""}
                    onChange={(e) => updateField("chief_complaint", e.target.value)}
                    className="w-full border border-slate-200 rounded-md p-2 text-[13px] resize-none outline-none focus:border-[#1A2F5A]"
                  />
                </FieldSection>

                {/* History of Present Illness */}
                <FieldSection label="History of Present Illness">
                  <textarea
                    rows={3}
                    value={(editableData.history_of_present_illness as string) || ""}
                    onChange={(e) => updateField("history_of_present_illness", e.target.value)}
                    placeholder="All symptoms, duration, and history mentioned…"
                    className="w-full border border-slate-200 rounded-md p-2 text-[13px] resize-none outline-none focus:border-[#1A2F5A]"
                  />
                </FieldSection>

                {/* Examination Findings */}
                <FieldSection label="Examination Findings">
                  <textarea
                    rows={2}
                    value={(editableData.examination_findings as string) || ""}
                    onChange={(e) => updateField("examination_findings", e.target.value)}
                    className="w-full border border-slate-200 rounded-md p-2 text-[13px] resize-none outline-none focus:border-[#1A2F5A]"
                  />
                </FieldSection>

                {/* Diagnosis */}
                <FieldSection label="Diagnosis">
                  <input
                    value={(editableData.diagnosis as string) || ""}
                    onChange={(e) => updateField("diagnosis", e.target.value)}
                    className="w-full border border-slate-200 rounded-md p-2 text-[13px] outline-none focus:border-[#1A2F5A]"
                  />
                  {editableData.icd_suggestion && (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                        🔖 ICD: {editableData.icd_suggestion as string}
                      </span>
                      <button
                        onClick={() => updateField("diagnosis",
                          `${editableData.diagnosis || ""} [${editableData.icd_suggestion}]`)}
                        className="text-[10px] text-blue-600 hover:underline"
                      >
                        Use This
                      </button>
                    </div>
                  )}
                </FieldSection>

                {/* Prescription */}
                <FieldSection label="Prescription">
                  {((editableData.prescription as DrugItem[]) || []).length > 0 ? (
                    <div className="space-y-1">
                      {((editableData.prescription as DrugItem[]) || []).map((drug, i) => (
                        <div key={i} className="bg-slate-50 rounded-md p-2 relative group">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-bold text-slate-900">{drug.drug_name || "Unnamed"}</span>
                          </div>
                          <div className="flex gap-1 mt-1 flex-wrap text-[11px] text-slate-500">
                            {[drug.dose, drug.route, drug.frequency, drug.duration ? `${drug.duration} days` : ""].filter(Boolean).map((v, j) => (
                              <span key={j} className="bg-slate-200 text-slate-600 px-1.5 py-px rounded">{v}</span>
                            ))}
                          </div>
                          {drug.instructions && (
                            <p className="text-[10px] italic text-slate-400 mt-1">{drug.instructions}</p>
                          )}
                          <button onClick={() => removeDrug(i)}
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <X className="h-3 w-3 text-slate-400 hover:text-red-500" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-400 italic">No prescription detected</p>
                  )}
                  <button onClick={addEmptyDrug}
                    className="text-[11px] text-[#1A2F5A] mt-1 hover:underline">
                    + Add Drug
                  </button>
                </FieldSection>

                {/* Plan & Investigations */}
                <FieldSection label="Plan & Investigations">
                  <textarea
                    rows={2}
                    value={(editableData.plan as string) || ""}
                    onChange={(e) => updateField("plan", e.target.value)}
                    className="w-full border border-slate-200 rounded-md p-2 text-[13px] resize-none outline-none focus:border-[#1A2F5A]"
                  />
                  {((editableData.investigations as string[]) || []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {((editableData.investigations as string[]) || []).map((inv, i) => (
                        <span key={i} className="inline-flex items-center gap-1 text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                          {inv}
                          <button onClick={() => removeInvestigation(i)}>
                            <X className="h-2.5 w-2.5 hover:text-red-500" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </FieldSection>

                {/* Follow Up */}
                <FieldSection label="Follow Up">
                  <input
                    value={(editableData.follow_up as string) || ""}
                    onChange={(e) => updateField("follow_up", e.target.value)}
                    className="w-full border border-slate-200 rounded-md p-2 text-[13px] outline-none focus:border-[#1A2F5A]"
                  />
                </FieldSection>
              </>
            )}

            {currentSessionType === "ward_round" && (
              <>
                {["subjective", "objective", "assessment", "plan"].map((key) => (
                  <FieldSection key={key} label={key.charAt(0).toUpperCase() + key.slice(1)}>
                    <textarea
                      rows={2}
                      value={(editableData[key] as string) || ""}
                      onChange={(e) => updateField(key, e.target.value)}
                      className="w-full border border-slate-200 rounded-md p-2 text-[13px] resize-none outline-none focus:border-[#1A2F5A]"
                    />
                  </FieldSection>
                ))}
              </>
            )}

            {(currentSessionType === "emergency" || currentSessionType === "nursing_note") && (
              <div className="space-y-2">
                {Object.entries(editableData).filter(([k]) => k !== "confidence").map(([key, val]) => (
                  <FieldSection key={key} label={key.replace(/_/g, " ")}>
                    {typeof val === "string" ? (
                      <textarea
                        rows={2}
                        value={val}
                        onChange={(e) => updateField(key, e.target.value)}
                        className="w-full border border-slate-200 rounded-md p-2 text-[13px] resize-none outline-none focus:border-[#1A2F5A]"
                      />
                    ) : (
                      <p className="text-xs text-slate-600">{JSON.stringify(val)}</p>
                    )}
                  </FieldSection>
                ))}
              </div>
            )}

            {/* Full transcript — the complete dictation, kept so nothing is ever lost */}
            {rawTranscript.trim() && (
              <FieldSection label="Full Transcript (everything you dictated)">
                <textarea
                  readOnly
                  rows={4}
                  value={rawTranscript}
                  className="w-full border border-slate-200 rounded-md p-2 text-[12px] resize-none outline-none bg-slate-50 text-slate-600"
                />
                <button
                  onClick={() => { navigator.clipboard.writeText(rawTranscript); toast({ title: "Transcript copied ✓" }); }}
                  className="text-[11px] text-[#1A2F5A] mt-1 hover:underline flex items-center gap-1"
                >
                  <Copy className="h-3 w-3" /> Copy full transcript
                </button>
              </FieldSection>
            )}
          </div>

          {/* ACTION BUTTONS */}
          <div className="flex-shrink-0 border-t border-slate-100 p-3 space-y-2">
            <button onClick={handleApply}
              className="w-full h-11 bg-[#1A2F5A] text-white text-sm font-semibold rounded-lg hover:bg-[#152647] active:scale-[0.98] transition-all flex items-center justify-center gap-2">
              <Check className="h-4 w-4" /> {applyLabel}
            </button>
            <div className="flex items-center justify-between">
              <button onClick={handleCopyText}
                className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
                <Copy className="h-3 w-3" /> Copy as Text
              </button>
              <button onClick={handleReRecord}
                className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
                <RefreshCw className="h-3 w-3" /> Re-record
              </button>
            </div>
          </div>
        </>
      )}

      {/* FALLBACK STATE */}
      {panelState === "fallback" && (
        <>
          <div className="mx-3 mt-3 bg-amber-50 border border-amber-200 rounded-lg p-2.5 space-y-1">
            <p className="text-xs text-amber-800 font-semibold">AI structuring unavailable — showing raw transcript</p>
            {fallbackReason ? (
              <p className="text-[11px] text-amber-700 leading-snug">
                {fallbackReason.includes("No AI provider") || fallbackReason.includes("Edge Function returned a non-2xx")
                  ? "No AI provider configured. Go to Settings → API Hub to add an OpenAI, Claude, or Gemini API key."
                  : fallbackReason}
              </p>
            ) : null}
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            <textarea
              value={rawTranscript}
              onChange={(e) => setRawTranscript(e.target.value)}
              className="w-full h-40 border border-slate-200 rounded-md p-2 text-[13px] resize-none outline-none"
            />
          </div>
          <div className="flex-shrink-0 border-t border-slate-100 p-3 flex gap-2">
            <button onClick={() => {
              navigator.clipboard.writeText(rawTranscript);
              toast({ title: "Transcript copied ✓" });
            }} className="flex-1 h-9 border border-slate-200 text-sm rounded-lg hover:bg-slate-50 flex items-center justify-center gap-1.5">
              <Copy className="h-3.5 w-3.5" /> Copy Transcript
            </button>
            <button onClick={handleRetry} disabled={retrying}
              className="flex-1 h-9 bg-[#1A2F5A] text-white text-sm rounded-lg hover:bg-[#152647] flex items-center justify-center gap-1.5">
              {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Re-try Structuring
            </button>
          </div>
        </>
      )}
    </div>
  );
};

// Helper component
const FieldSection: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1 block">{label}</label>
    {children}
  </div>
);

export default VoiceScribePanel;

import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { X, Check, Copy, RefreshCw, Loader2, AlertTriangle, Globe, Wand2, ShieldAlert } from "lucide-react";
import { useVoiceScribe, SUPPORTED_LANGUAGES } from "@/contexts/VoiceScribeContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { unwrapFunctionError } from "@/lib/invokeError";
import { useAIAudit } from "@/hooks/useAIAudit";
import {
  computeScribeConfidence, populatedSections, toPercent,
  LOW_CONFIDENCE_THRESHOLD, type ScribeSection,
} from "@/lib/scribeConfidence";

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
    selectedLanguage, fallbackReason, setFallbackReason, getExistingDataForCurrentScreen,
    scribeSignals, nativeTranscript, setNativeTranscript, segmentBlobsRef, rescueState,
  } = useVoiceScribe();
  const { toast } = useToast();
  const { logAudit } = useAIAudit();

  // Editable local state from structured output
  const [editableData, setEditableData] = useState<Record<string, unknown>>({});
  const [retrying, setRetrying] = useState(false);
  const [hospitalId, setHospitalId] = useState<string>("");
  // Which version of the dictation the transcript box is showing.
  const [transcriptView, setTranscriptView] = useState<"english" | "native">("english");
  const [loadingNative, setLoadingNative] = useState(false);

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

  // Confidence is MEASURED, not self-reported.
  //
  // This used to render whatever float the structuring model emitted about itself,
  // which meant a model that hallucinated confidently reported high confidence, and a
  // transcript that came back as one Telugu phrase repeated a dozen times still got a
  // number that looked like a real score. The composite blends the model's per-field
  // claim with signals actually observed: Sarvam's language probability, runaway
  // repetition in the transcript, and how much of the clinical vocabulary resolved
  // against this hospital's own catalogue. See src/lib/scribeConfidence.ts.
  const scribeConfidence = computeScribeConfidence({
    segments: scribeSignals?.segments,
    repetition: scribeSignals?.repetition ?? null,
    lexiconHitRate: scribeSignals?.lexiconHitRate ?? null,
    fieldConfidence: (editableData.field_confidence as Record<ScribeSection, number | null>) ?? null,
    populatedSections: populatedSections(editableData),
  });
  const confidence = scribeConfidence.overall;
  const confidencePercent = toPercent(confidence);
  const sectionScore = (section: ScribeSection) =>
    scribeConfidence.sections.find(s => s.section === section) ?? null;

  const repairs = scribeSignals?.repairs ?? [];
  const safetyFlags = (scribeSignals?.safetyCheck?.flags ?? []) as Record<string, unknown>[];

  // The engine returned English directly, so the original-language audio can still be
  // re-transcribed on demand. Only worth offering when we actually kept the audio.
  const canShowNative = Boolean(
    scribeSignals?.preTranslated && segmentBlobsRef.current.length > 0 && selectedLanguage !== "en-IN",
  );

  /**
   * Fetch the dictation in its original language, once, on demand.
   *
   * Saaras returns English in a single call; getting the native text means a SECOND
   * billable transcription of the same audio. Doing it lazily means the hospital pays
   * for it only when a doctor actually wants to check what they said.
   */
  const loadNativeTranscript = async () => {
    if (nativeTranscript !== null) { setTranscriptView("native"); return; }
    const blobs = segmentBlobsRef.current;
    if (blobs.length === 0) return;

    setLoadingNative(true);
    try {
      const parts: string[] = [];
      for (const blob of blobs) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        const { data, error } = await supabase.functions.invoke("sarvam-transcribe", {
          body: {
            audio_base64: base64,
            language_code: selectedLanguage,
            model: "saaras:v3",
            mode: "transcribe",   // native script, as opposed to the default translate
          },
        });
        if (error || data?.error) throw new Error(data?.error || error?.message);
        if (data.transcript?.trim()) parts.push(data.transcript.trim());
      }
      setNativeTranscript(parts.join(" "));
      setTranscriptView("native");
    } catch (err) {
      console.error("Native transcript fetch failed:", err);
      toast({
        title: "Couldn't load the original",
        description: "The English transcript is still available.",
        variant: "destructive",
      });
    } finally {
      setLoadingNative(false);
    }
  };

  const displayedTranscript = transcriptView === "native" && nativeTranscript !== null
    ? nativeTranscript
    : rawTranscript;

  // Did the model extract any clinical content at all? A conversation with nothing
  // extractable yields a valid-but-empty JSON; surface that honestly instead of
  // rendering a green "structured" note with all fields blank.
  const isExtractionEmpty = (() => {
    const anyText = Object.entries(editableData).some(
      ([k, v]) => k !== "confidence" && k !== "reasoning" && k !== "icd_suggestion" &&
        typeof v === "string" && v.trim().length > 0
    );
    const anyList = Object.values(editableData).some((v) => Array.isArray(v) && v.length > 0);
    return !anyText && !anyList;
  })();

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
    : currentSessionType === "ipd_workspace" ? "Apply to Rx & Orders"
    : currentSessionType === "nursing_note" ? "Apply to Nursing Task"
    : "Apply to Screen";

  const handleCopyText = () => {
    let text = "";
    if (currentSessionType === "opd_consultation") {
      text = `Chief Complaint: ${editableData.chief_complaint || ""}
History of Present Illness: ${editableData.history_of_present_illness || ""}
Examination Findings: ${editableData.examination_findings || ""}
Systemic Examination: ${editableData.systemic_examination || ""}
Diagnosis: ${editableData.diagnosis || ""}
${editableData.suggested_diagnosis ? `AI-suggested (unconfirmed): ${editableData.suggested_diagnosis}` : ""}
${editableData.icd_suggestion ? `ICD-10: ${editableData.icd_suggestion}` : ""}
Prescription:
${((editableData.prescription as DrugItem[]) || []).map(d =>
  `- ${d.drug_name} ${d.dose} ${d.frequency} × ${d.duration} days${d.instructions ? ` (${d.instructions})` : ""}`
).join("\n") || "None"}
Plan: ${editableData.plan || ""}
Follow Up: ${editableData.follow_up || ""}
Investigations: ${((editableData.investigations as string[]) || []).join(", ") || "None"}`;
    } else if (currentSessionType === "ipd_workspace") {
      text = `Prescription:
${((editableData.prescription as DrugItem[]) || []).map(d =>
  `- ${d.drug_name} ${d.dose} ${d.route} ${d.frequency} × ${d.duration} days${d.instructions ? ` (${d.instructions})` : ""}`
).join("\n") || "None"}
Investigations: ${((editableData.investigations as string[]) || []).join(", ") || "None"}
Plan: ${editableData.plan || ""}
Advice: ${editableData.advice_notes || ""}
Follow Up: ${editableData.follow_up || ""}`;
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
        body: { transcript: rawTranscript, context_type: currentSessionType, language_code: selectedLanguage, existing_data: getExistingDataForCurrentScreen() ?? undefined, patient_id: currentPatientId ?? undefined },
      });
      if (error || data?.error) throw new Error(await unwrapFunctionError(error, data));
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
          {panelState === "output" && confidencePercent !== null && (
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
          {/* Empty-extraction notice — nothing clinical could be pulled from the conversation */}
          {isExtractionEmpty && (
            <div className="mx-3 mt-3 bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-amber-800">No clinical details could be extracted from this conversation</p>
                <p className="text-[10px] text-amber-600 mt-0.5">Review the full transcript below, edit the fields manually, or re-record.</p>
              </div>
            </div>
          )}

          {/* Confidence warning — now says WHY, from measured signal rather than a guess */}
          {!isExtractionEmpty && confidence !== null && confidence < LOW_CONFIDENCE_THRESHOLD && (
            <div className="mx-3 mt-3 bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-amber-800">Low confidence ({confidencePercent}%) — please review carefully</p>
                {scribeConfidence.warnings.length > 0 ? (
                  <ul className="text-[10px] text-amber-600 mt-0.5 space-y-0.5">
                    {scribeConfidence.warnings.map((w) => <li key={w}>• {w}</li>)}
                  </ul>
                ) : (
                  <p className="text-[10px] text-amber-600 mt-0.5">The transcript may have been unclear. Edit as needed.</p>
                )}
              </div>
            </div>
          )}

          {/* Safety flags. ai-clinical-voice has always run extracted prescriptions through
              ai-safety-guard for allergy cross-reactivity, dose limits and controlled
              substances — but the result was never rendered, so every flag was discarded
              on the way to the clinician. */}
          {safetyFlags.length > 0 && (
            <div className="mx-3 mt-3 bg-red-50 border border-red-200 rounded-lg p-2 flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-red-800">
                  {safetyFlags.length} safety {safetyFlags.length === 1 ? "flag" : "flags"} on this prescription
                </p>
                <ul className="text-[10px] text-red-700 mt-0.5 space-y-0.5">
                  {safetyFlags.slice(0, 4).map((f, i) => (
                    <li key={i} className="break-words">
                      • {String(f.message ?? f.reason ?? f.type ?? "Review this prescription")}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Background audio rescue. The note below is already usable; this says a second
              pass is re-listening to the worst-heard part rather than leaving the doctor
              wondering whether anything is still happening. */}
          {rescueState !== "idle" && (
            <div className={cn(
              "mx-3 mt-3 rounded-lg p-2 flex items-start gap-2 border",
              rescueState === "running" ? "bg-slate-50 border-slate-200" : "bg-emerald-50 border-emerald-200",
            )}>
              {rescueState === "running"
                ? <Loader2 className="h-4 w-4 text-slate-500 flex-shrink-0 mt-0.5 animate-spin" />
                : <Check className="h-4 w-4 text-emerald-600 flex-shrink-0 mt-0.5" />}
              <div>
                <p className={cn("text-xs font-medium", rescueState === "running" ? "text-slate-700" : "text-emerald-800")}>
                  {rescueState === "running"
                    ? "Re-listening to the unclear part…"
                    : "Improved — please re-check the note"}
                </p>
                <p className={cn("text-[10px] mt-0.5", rescueState === "running" ? "text-slate-500" : "text-emerald-600")}>
                  {rescueState === "running"
                    ? "You can review and edit below in the meantime."
                    : "Some terms were recovered from the audio and the note was updated."}
                </p>
              </div>
            </div>
          )}

          {/* Applied vocabulary repairs — every silent correction stays visible and auditable */}
          {repairs.length > 0 && (
            <div className="mx-3 mt-3 bg-sky-50 border border-sky-200 rounded-lg p-2 flex items-start gap-2">
              <Wand2 className="h-4 w-4 text-sky-600 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-sky-800">
                  Corrected {repairs.length} medical {repairs.length === 1 ? "term" : "terms"}
                </p>
                <ul className="text-[10px] text-sky-700 mt-0.5 space-y-0.5">
                  {repairs.slice(0, 5).map((r, i) => (
                    <li key={i} className="break-words">
                      <span className="font-medium">{r.to}</span>
                      <span className="text-sky-600/70"> ← “{r.from}”</span>
                    </li>
                  ))}
                  {repairs.length > 5 && (
                    <li className="text-sky-600/70">…and {repairs.length - 5} more</li>
                  )}
                </ul>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {currentSessionType === "opd_consultation" && (
              <>
                {/* Chief Complaint */}
                <FieldSection label="Chief Complaint" confidence={sectionScore("chief_complaint")}>
                  <textarea
                    rows={2}
                    value={(editableData.chief_complaint as string) || ""}
                    onChange={(e) => updateField("chief_complaint", e.target.value)}
                    className="w-full border border-slate-200 rounded-md p-2 text-[13px] resize-none outline-none focus:border-[#1A2F5A]"
                  />
                </FieldSection>

                {/* History of Present Illness */}
                <FieldSection label="History of Present Illness" confidence={sectionScore("history_of_present_illness")}>
                  <textarea
                    rows={3}
                    value={(editableData.history_of_present_illness as string) || ""}
                    onChange={(e) => updateField("history_of_present_illness", e.target.value)}
                    placeholder="All symptoms, duration, and history mentioned…"
                    className="w-full border border-slate-200 rounded-md p-2 text-[13px] resize-none outline-none focus:border-[#1A2F5A]"
                  />
                </FieldSection>

                {/* Examination Findings */}
                <FieldSection label="Examination Findings" confidence={sectionScore("examination_findings")}>
                  <textarea
                    rows={2}
                    value={(editableData.examination_findings as string) || ""}
                    onChange={(e) => updateField("examination_findings", e.target.value)}
                    className="w-full border border-slate-200 rounded-md p-2 text-[13px] resize-none outline-none focus:border-[#1A2F5A]"
                  />
                </FieldSection>

                {/* Systemic Examination — maps to the consultation's "Systemic Examination /
                    Clinical Notes" box, which no AI field targeted before. */}
                <FieldSection label="Systemic Examination" confidence={sectionScore("systemic_examination")}>
                  <textarea
                    rows={2}
                    value={(editableData.systemic_examination as string) || ""}
                    onChange={(e) => updateField("systemic_examination", e.target.value)}
                    placeholder="CVS, RS, P/A, CNS or local site findings…"
                    className="w-full border border-slate-200 rounded-md p-2 text-[13px] resize-none outline-none focus:border-[#1A2F5A]"
                  />
                </FieldSection>

                {/* AI-suggested diagnosis. Kept visually separate from the Diagnosis field,
                    which records only what was actually spoken. It is applied to the chart as
                    an unconfirmed suggestion — never primary, and not coded or billed until
                    the doctor confirms it on the Examination tab. */}
                {typeof editableData.suggested_diagnosis === "string" &&
                 (editableData.suggested_diagnosis as string).trim() && (
                  <div className="bg-violet-50 border border-violet-200 border-dashed rounded-lg p-2">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-violet-500 mb-1">
                      AI suggestion — not yet confirmed
                    </p>
                    <input
                      value={(editableData.suggested_diagnosis as string) || ""}
                      onChange={(e) => updateField("suggested_diagnosis", e.target.value)}
                      className="w-full border border-violet-200 rounded-md p-2 text-[13px] outline-none focus:border-violet-400 bg-white"
                    />
                    {typeof editableData.diagnosis_basis === "string" && (editableData.diagnosis_basis as string).trim() && (
                      <p className="text-[10px] text-violet-600 mt-1 leading-snug">
                        Based on: {editableData.diagnosis_basis as string}
                      </p>
                    )}
                  </div>
                )}

                {/* Diagnosis */}
                <FieldSection label="Diagnosis" confidence={sectionScore("diagnosis")}>
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
                <FieldSection label="Prescription" confidence={sectionScore("prescription")}>
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
                <FieldSection label="Plan & Investigations" confidence={sectionScore("plan")}>
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
                <FieldSection label="Follow Up" confidence={sectionScore("follow_up")}>
                  <input
                    value={(editableData.follow_up as string) || ""}
                    onChange={(e) => updateField("follow_up", e.target.value)}
                    className="w-full border border-slate-200 rounded-md p-2 text-[13px] outline-none focus:border-[#1A2F5A]"
                  />
                </FieldSection>
              </>
            )}

            {/* IPD workspace — a ward doctor dictating ORDERS for an admitted patient.
                This session type previously had no prompt server-side and no branch here,
                so an inpatient dictation produced OPD-shaped output that the panel never
                rendered. Drugs in particular must be reviewable before they are applied. */}
            {currentSessionType === "ipd_workspace" && (
              <>
                <FieldSection label="Prescription" confidence={sectionScore("prescription")}>
                  {((editableData.prescription as DrugItem[]) || []).length > 0 ? (
                    <div className="space-y-1">
                      {((editableData.prescription as DrugItem[]) || []).map((drug, i) => (
                        <div key={i} className="bg-slate-50 rounded-md p-2 relative group">
                          <span className="text-[13px] font-bold text-slate-900">{drug.drug_name || "Unnamed"}</span>
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
                  <button onClick={addEmptyDrug} className="text-[11px] text-[#1A2F5A] mt-1 hover:underline">
                    + Add Drug
                  </button>
                </FieldSection>

                <FieldSection label="Plan & Investigations" confidence={sectionScore("plan")}>
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

                <FieldSection label="Advice for Nursing Staff">
                  <textarea
                    rows={2}
                    value={(editableData.advice_notes as string) || ""}
                    onChange={(e) => updateField("advice_notes", e.target.value)}
                    className="w-full border border-slate-200 rounded-md p-2 text-[13px] resize-none outline-none focus:border-[#1A2F5A]"
                  />
                </FieldSection>

                <FieldSection label="Follow Up" confidence={sectionScore("follow_up")}>
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
                {/* `field_confidence` and `reasoning` are scoring metadata, not clinical
                    content — rendering them here would show the doctor a raw JSON blob. */}
                {Object.entries(editableData)
                  .filter(([k]) => k !== "confidence" && k !== "field_confidence" && k !== "reasoning")
                  .map(([key, val]) => (
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

            {/* Full transcript — the complete dictation, kept so nothing is ever lost.
                Sarvam now returns English directly, so this shows English by default with
                the original a tap away: the doctor needs the original precisely when the
                score is low and they must judge whether the AI mangled what they said. */}
            {rawTranscript.trim() && (
              <FieldSection label="Full Transcript (everything you dictated)">
                {canShowNative && (
                  <div className="flex items-center gap-1 mb-1">
                    <button
                      onClick={() => setTranscriptView("english")}
                      className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full transition-colors",
                        transcriptView === "english"
                          ? "bg-[#1A2F5A] text-white"
                          : "bg-slate-100 text-slate-500 hover:bg-slate-200",
                      )}
                    >
                      English
                    </button>
                    <button
                      onClick={loadNativeTranscript}
                      disabled={loadingNative}
                      className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full transition-colors flex items-center gap-1",
                        transcriptView === "native"
                          ? "bg-[#1A2F5A] text-white"
                          : "bg-slate-100 text-slate-500 hover:bg-slate-200",
                        loadingNative && "opacity-60 cursor-wait",
                      )}
                      title={`Show what you actually said in ${currentLangOption?.label ?? "the original language"}`}
                    >
                      {loadingNative && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                      {currentLangOption?.label ?? "Original"}
                    </button>
                  </div>
                )}
                <textarea
                  readOnly
                  rows={4}
                  value={displayedTranscript}
                  className="w-full border border-slate-200 rounded-md p-2 text-[12px] resize-none outline-none bg-slate-50 text-slate-600"
                />
                <button
                  onClick={() => { navigator.clipboard.writeText(displayedTranscript); toast({ title: "Transcript copied ✓" }); }}
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
                {fallbackReason.includes("No AI provider")
                  ? "No AI provider configured. Go to Settings → API Hub to configure an AI provider."
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
//
// `confidence` is optional so the many call sites that have no per-section score (the
// emergency/nursing layouts, the transcript box) keep working unchanged. A section that
// was never dictated shows "not dictated" rather than 0% — silence and mishearing are
// different problems and lead the doctor to different actions.
const FieldSection: React.FC<{
  label: string;
  children: React.ReactNode;
  confidence?: { score: number | null; notDictated: boolean } | null;
}> = ({ label, children, confidence }) => {
  const percent = confidence ? toPercent(confidence.score) : null;
  const low = percent !== null && percent < LOW_CONFIDENCE_THRESHOLD * 100;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block">{label}</label>
        {confidence?.notDictated ? (
          <span className="text-[9px] text-slate-300 uppercase tracking-wider">not dictated</span>
        ) : percent !== null ? (
          <span
            className={cn(
              "text-[9px] font-semibold rounded-full px-1.5 py-0.5 tabular-nums",
              low ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500",
            )}
            title={low ? "Low confidence — please check this field" : "Confidence for this field"}
          >
            {percent}%
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
};

export default VoiceScribePanel;

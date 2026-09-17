import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { X, AlertTriangle, ShieldAlert, ShieldX, Copy, Sparkles, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import type { DrugSafetyResult, DrugInteraction, AllergyConflict } from "@/lib/drugSafetyCheck";
import { callAI } from "@/lib/aiProvider";
import { useAIFeature } from "@/hooks/useAIFeature";
// `toast` was called in runAIAnalysis without ever being imported — a ReferenceError that
// the surrounding catch swallowed, so an AI failure silently rendered the generic
// "unavailable" text instead of the real reason. Found by tsc while fixing KNOWN-BUG-113.
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  drugName: string;
  result: DrugSafetyResult;
  hospitalId?: string;
  onClose: () => void;
  onAddAnyway: () => void;
  onOverride: (reason: string) => void;
}

const severityConfig: Record<string, { bg: string; border: string; icon: React.ReactNode; label: string; textColor: string }> = {
  contraindicated: {
    bg: "bg-red-50",
    border: "border-destructive",
    icon: <ShieldX className="h-5 w-5 text-destructive" />,
    label: "🚫 CONTRAINDICATION DETECTED",
    textColor: "text-destructive",
  },
  major: {
    bg: "bg-amber-50",
    border: "border-amber-500",
    icon: <ShieldAlert className="h-5 w-5 text-amber-600" />,
    label: "⚠️ MAJOR DRUG INTERACTION",
    textColor: "text-amber-700",
  },
  moderate: {
    bg: "bg-yellow-50",
    border: "border-yellow-400",
    icon: <AlertTriangle className="h-5 w-5 text-yellow-600" />,
    label: "⚠️ DRUG INTERACTION",
    textColor: "text-yellow-700",
  },
  minor: {
    bg: "bg-blue-50",
    border: "border-blue-300",
    icon: <AlertTriangle className="h-5 w-5 text-blue-500" />,
    label: "ℹ️ MINOR INTERACTION",
    textColor: "text-blue-700",
  },
};

const severityBadge: Record<string, string> = {
  contraindicated: "bg-red-100 text-destructive border-red-200",
  major: "bg-amber-100 text-amber-700 border-amber-200",
  moderate: "bg-yellow-100 text-yellow-700 border-yellow-200",
  minor: "bg-blue-100 text-blue-600 border-blue-200",
  high: "bg-red-100 text-destructive border-red-200",
};

const DrugSafetyAlertModal: React.FC<Props> = ({ open, drugName, result, hospitalId, onClose, onAddAnyway, onOverride }) => {
  const __aiOn = useAIFeature("drug_interaction_analysis");
  const { toast } = useToast();
  const [showOverride, setShowOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const runAIAnalysis = async () => {
    if (!hospitalId) return;
    setAiLoading(true);
    const interactionLines = result.interactions
      .map((i) => `- ${i.drug_a} + ${i.drug_b}: ${i.clinical_effect || ""} (${i.severity})`)
      .join("\n");
    const allergyLines = result.allergyConflicts
      .map((a) => `- Patient allergy to ${a.allergy}, ${a.type} conflict with ${a.drug} (${a.severity})`)
      .join("\n");
    const prompt = `Drug being prescribed: ${drugName}\nWorst severity: ${result.worstSeverity}\n\nInteractions:\n${interactionLines || "None"}\n\nAllergy conflicts:\n${allergyLines || "None"}\n\nDuplicates: ${result.duplicates.join(", ") || "None"}\n\nProvide a concise clinical summary (3–5 sentences): explain the mechanism, patient risk, and safe alternative drug options if any.`;
    try {
      const res = await callAI({ featureKey: "drug_interaction_analysis", prompt, hospitalId, maxTokens: 400 });
      if (res.error || !res.text) {
        toast({ title: "AI analysis failed", description: res.error || "Empty response", variant: "destructive" });
      } else {
        setAiAnalysis(res.text);
      }
    } catch {
      setAiAnalysis("AI analysis unavailable. Please configure an AI provider in Settings.");
    }
    setAiLoading(false);
  };

  // KNOWN-BUG-113. This used to read `if (!__aiOn) return null;` — the ENTIRE drug
  // interaction and allergy warning was hidden whenever the hospital lacked the `ai_suite`
  // entitlement. On those tenants a contraindicated prescription produced no modal at all:
  // RxOrdersTab set showSafetyModal(true), nothing rendered, and the drug was not added, so
  // the prescriber saw a click that did nothing rather than a contraindication.
  //
  // `useAIFeature` is documented as a gate for "the visible AI UI" — the analysis button
  // below, not the safety alert. CLAUDE.md: drug interaction and allergy checks are never
  // mocked or skipped, and clinical alerts are never silenced. An add-on entitlement must
  // not be able to switch one off.
  if (!open) return null;

  const config = severityConfig[result.worstSeverity] || severityConfig.moderate;
  const isContraindicated = result.worstSeverity === "contraindicated";

  // A degraded check raises worstSeverity to 'major' so any gate stops (KNOWN-BUG-108), but
  // "MAJOR DRUG INTERACTION" would be the wrong thing to tell a prescriber when the real
  // finding is that the check could not complete. Say which it is.
  const onlyUnavailable =
    result.checkUnavailable &&
    result.interactions.length === 0 &&
    result.allergyConflicts.length === 0 &&
    result.duplicates.length === 0;
  const headerLabel = onlyUnavailable ? "⚠️ SAFETY CHECK INCOMPLETE" : config.label;

  const handleOverrideSubmit = () => {
    if (overrideReason.trim() && acknowledged) {
      onOverride(overrideReason.trim());
      setShowOverride(false);
      setOverrideReason("");
      setAcknowledged(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-background rounded-2xl shadow-2xl w-[520px] max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className={cn("px-5 py-4 border-b-2 flex items-center gap-3", config.bg, config.border)}>
          {config.icon}
          <span className={cn("text-base font-bold flex-1", config.textColor)}>{headerLabel}</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Drug name */}
        <div className="px-5 py-3 border-b border-border bg-muted/30 text-center">
          <span className="text-sm text-muted-foreground">Adding: </span>
          <span className="text-sm font-bold text-foreground">{drugName}</span>
        </div>

        {/* Issues */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Incomplete check (KNOWN-BUG-108). A reference lookup failed, so what is shown
              below is not the whole picture — and "nothing found" here does not mean safe. */}
          {result.checkUnavailable && (
            <div className="bg-amber-50 border-2 border-amber-400 rounded-xl p-3.5">
              <div className="flex items-center gap-2 mb-1.5">
                <ShieldAlert className="h-4 w-4 text-amber-600" />
                <span className="text-xs font-bold text-amber-700 uppercase">Safety check incomplete</span>
              </div>
              <p className="text-sm font-semibold text-foreground">
                Part of the drug safety check could not run. Treat this result as unverified.
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {result.unavailableReasons.map((reason, i) => (
                  <li key={i} className="text-xs text-muted-foreground">• {reason}</li>
                ))}
              </ul>
              <p className="text-xs font-bold text-amber-700 mt-1.5">
                Verify interactions and allergies manually before prescribing.
              </p>
            </div>
          )}

          {/* Allergy conflicts */}
          {result.allergyConflicts.length > 0 && (
            <div className="space-y-2">
              {result.allergyConflicts.map((ac, i) => (
                <div key={i} className="bg-red-50 border border-red-200 rounded-xl p-3.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-destructive border border-red-200 uppercase">
                      {ac.type === "direct" ? "Allergy Match" : "Cross-Reactivity"}
                    </span>
                    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase", severityBadge[ac.severity] || severityBadge.high)}>
                      {ac.severity}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    Patient is allergic to <span className="text-destructive">{ac.allergy}</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {ac.type === "direct"
                      ? `${ac.drug} directly matches the known allergy.`
                      : `${ac.drug} has known cross-reactivity with ${ac.allergy}.`}
                  </p>
                  {ac.severity === "contraindicated" && (
                    <p className="text-xs font-bold text-destructive mt-1.5">⛔ CONTRAINDICATED — Do not administer</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Drug interactions */}
          {result.interactions.length > 0 && (
            <div className="space-y-2">
              {result.interactions.map((inter, i) => (
                <div key={i} className="border border-border rounded-xl p-3.5 bg-background">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase", severityBadge[inter.severity])}>
                      {inter.severity}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    {inter.drug_a} + {inter.drug_b}
                  </p>
                  {inter.mechanism && (
                    <p className="text-xs italic text-muted-foreground mt-1">{inter.mechanism}</p>
                  )}
                  {inter.clinical_effect && (
                    <p className="text-[13px] text-foreground mt-1">{inter.clinical_effect}</p>
                  )}
                  {inter.recommendation && (
                    <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <p className="text-xs text-amber-800">💡 {inter.recommendation}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Duplicates */}
          {result.duplicates.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3.5">
              <div className="flex items-center gap-2 mb-1">
                <Copy className="h-3.5 w-3.5 text-yellow-600" />
                <span className="text-xs font-bold text-yellow-700 uppercase">Duplicate Drug</span>
              </div>
              <p className="text-sm text-foreground">
                <span className="font-semibold">{drugName}</span> is already on this prescription
              </p>
            </div>
          )}

          {/* AI Analysis — the one part of this modal the ai_suite entitlement governs. */}
          {hospitalId && __aiOn && (
            <div className="border border-primary/20 rounded-xl p-3 bg-primary/5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-primary flex items-center gap-1">
                  <Sparkles className="h-3.5 w-3.5" /> AI Clinical Analysis
                </span>
                {!aiAnalysis && (
                  <button
                    onClick={runAIAnalysis}
                    disabled={aiLoading}
                    className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    {aiLoading ? "Analysing…" : "Get AI Analysis"}
                  </button>
                )}
              </div>
              {aiAnalysis && (
                <p className="text-xs text-foreground leading-relaxed whitespace-pre-line">{aiAnalysis}</p>
              )}
              {!aiAnalysis && !aiLoading && (
                <p className="text-[11px] text-muted-foreground">Click to get a clinical explanation and safe alternatives from AI.</p>
              )}
            </div>
          )}

          {/* Override form */}
          {showOverride && (
            <div className="border-2 border-destructive/30 rounded-xl p-4 bg-red-50/50 space-y-3">
              <p className="text-xs font-bold text-destructive uppercase">Override Safety Alert</p>
              <p className="text-xs text-muted-foreground">This override will be logged in the patient record.</p>
              <Textarea
                placeholder="Clinical justification for overriding this alert..."
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                className="text-xs min-h-[60px] bg-background"
                rows={3}
              />
              <div className="flex items-start gap-2">
                <Checkbox
                  id="ack"
                  checked={acknowledged}
                  onCheckedChange={(v) => setAcknowledged(v === true)}
                  className="mt-0.5"
                />
                <label htmlFor="ack" className="text-xs text-foreground leading-relaxed cursor-pointer">
                  I confirm I am aware of the risk and take clinical responsibility for this decision
                </label>
              </div>
              <button
                onClick={handleOverrideSubmit}
                disabled={!overrideReason.trim() || !acknowledged}
                className="w-full text-xs font-semibold py-2 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Override and Add Drug
              </button>
            </div>
          )}
        </div>

        {/* Footer actions */}
        {!showOverride && (
          <div className="px-5 py-4 border-t border-border bg-muted/20">
            {isContraindicated ? (
              <div className="space-y-2">
                <button
                  onClick={onClose}
                  className="w-full text-sm font-semibold py-2.5 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                >
                  ✗ Remove {drugName} — Do Not Add
                </button>
                <button
                  onClick={() => setShowOverride(true)}
                  className="w-full text-xs text-muted-foreground hover:text-foreground py-1 transition-colors"
                >
                  Override with clinical justification...
                </button>
              </div>
            ) : (
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 text-sm font-medium py-2.5 rounded-lg border border-border text-foreground hover:bg-muted transition-colors"
                >
                  ✗ Cancel — Don't Add
                </button>
                <button
                  onClick={onAddAnyway}
                  className="flex-1 text-sm font-semibold py-2.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors"
                >
                  ✓ Add Anyway
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DrugSafetyAlertModal;

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, AlertOctagon, Siren, ChevronRight, ChevronDown, ChevronUp, Bot, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getNEWS2Level, getNEWS2Label } from "@/lib/news2";
import AIAttestationModal from "@/components/ai/AIAttestationModal";

interface Props {
  admissionId: string;
  // qSOFA — requires hospitalId to fetch nursing vitals
  hospitalId?: string | null;
  patientAge?: number | null;
  currentDiagnosis?: string | null;
  // NEWS2 escalation (passed directly from IPDOverviewTab)
  news2Score?: number | null;
  onTabChange?: (tab: string) => void;
}

interface LatestVitals {
  gcs_total: number | null;
  respiratory_rate: number | null;
  bp_systolic: number | null;
  temperature: number | null;
  pulse: number | null;
}

interface AIResult {
  differentials?: Array<{ diagnosis: string; confidence: number; recommended_investigations: string[] }>;
  red_flags_detected?: string[];
  overall_urgency?: string;
}

function calcQSOFA(v: LatestVitals) {
  const mentation = v.gcs_total !== null && v.gcs_total < 15;
  const rrHigh = v.respiratory_rate !== null && v.respiratory_rate >= 22;
  const sbpLow = v.bp_systolic !== null && v.bp_systolic <= 100;
  return { score: (mentation ? 1 : 0) + (rrHigh ? 1 : 0) + (sbpLow ? 1 : 0), mentation, rrHigh, sbpLow };
}

function sirsCount(v: LatestVitals): number {
  let n = 0;
  if (v.temperature !== null && (v.temperature > 38 || v.temperature < 36)) n++;
  if (v.pulse !== null && v.pulse > 90) n++;
  if (v.respiratory_rate !== null && v.respiratory_rate > 20) n++;
  return n;
}

// ── qSOFA + AI Sepsis Section ──────────────────────────────────────────────────
const QSOFAAlert: React.FC<{
  vitals: LatestVitals & { respiratory_rate: number | null };
  qsofa: ReturnType<typeof calcQSOFA>;
  sirs: number;
  admissionId: string;
  hospitalId: string;
  patientAge: number | null;
  currentDiagnosis?: string | null;
}> = ({ vitals, qsofa, sirs, admissionId, hospitalId, patientAge, currentDiagnosis }) => {
  const [expanded, setExpanded] = useState(false);
  const [aiResult, setAiResult] = useState<AIResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [showAttestation, setShowAttestation] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleAIAnalysis = async () => {
    setAiLoading(true);
    try {
      const start = Date.now();
      const { data, error } = await supabase.functions.invoke("ai-differential-diagnosis", {
        body: {
          chief_complaint: "Possible sepsis — qSOFA ≥ 2",
          age: patientAge ?? "unknown",
          vitals: {
            bp_systolic: vitals.bp_systolic,
            respiratory_rate: vitals.respiratory_rate,
            gcs: vitals.gcs_total,
            temperature: vitals.temperature,
            heart_rate: vitals.pulse,
          },
          history: currentDiagnosis || "See admission diagnosis",
          patient_context: `Sepsis screening positive. qSOFA = ${qsofa.score}/3 (${qsofa.mentation ? "altered mentation, " : ""}${qsofa.rrHigh ? `RR ${vitals.respiratory_rate}/min, ` : ""}${qsofa.sbpLow ? `SBP ${vitals.bp_systolic} mmHg` : ""}). SIRS criteria met: ${sirs}/3. Age: ${patientAge ?? "unknown"}. Current diagnosis: ${currentDiagnosis || "undocumented"}. Identify likely sepsis source and immediate management priorities.`,
        },
      });
      if (error) throw new Error(error.message);
      setAiResult(data);

      await (supabase as any).from("ai_feature_logs").insert({
        hospital_id: hospitalId,
        module: "ipd",
        feature_key: "sepsis_screening",
        success: true,
        input_summary: `Admission ${admissionId} | qSOFA ${qsofa.score} | BP ${vitals.bp_systolic}, RR ${vitals.respiratory_rate}, GCS ${vitals.gcs_total}`,
        output_summary: `Top sepsis source: ${data?.differentials?.[0]?.diagnosis || "unknown"}`,
        latency_ms: Date.now() - start,
      });
    } catch (e: any) {
      console.error("Sepsis AI failed:", e);
    } finally {
      setAiLoading(false);
    }
  };

  const previewText = aiResult
    ? [
        `qSOFA Score: ${qsofa.score}/3`,
        ...(aiResult.differentials?.map((d, i) => `${i + 1}. ${d.diagnosis} (${Math.round(d.confidence * 100)}%)`) || []),
        aiResult.red_flags_detected?.length ? `Red flags: ${aiResult.red_flags_detected.join(", ")}` : "",
        aiResult.differentials?.[0]?.recommended_investigations?.length
          ? `Investigations: ${aiResult.differentials[0].recommended_investigations.join(", ")}`
          : "",
      ].filter(Boolean).join("\n")
    : `qSOFA ${qsofa.score}/3 — Sepsis screening positive`;

  return (
    <>
      <div className="rounded-lg border-2 border-orange-500 bg-orange-50 dark:bg-orange-950/20 mb-3 overflow-hidden">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-4 py-2.5 flex items-center gap-2 text-left hover:bg-orange-100/60 dark:hover:bg-orange-950/40 transition-colors"
        >
          <AlertOctagon className="h-4 w-4 text-orange-600 shrink-0 animate-pulse" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-orange-800 dark:text-orange-200">
              ⚠️ SEPSIS ALERT — qSOFA {qsofa.score}/3
            </p>
            <p className="text-xs text-orange-700 dark:text-orange-300">
              {[qsofa.mentation && "Altered mentation", qsofa.rrHigh && `RR ${vitals.respiratory_rate}/min ≥22`, qsofa.sbpLow && `SBP ${vitals.bp_systolic} mmHg ≤100`].filter(Boolean).join(" · ")}
              {sirs >= 2 && ` · SIRS ${sirs}/3`}
            </p>
          </div>
          {expanded ? <ChevronUp className="h-4 w-4 text-orange-600 shrink-0" /> : <ChevronDown className="h-4 w-4 text-orange-600 shrink-0" />}
        </button>

        {expanded && (
          <div className="border-t border-orange-200 px-4 py-3 space-y-3 bg-white/60 dark:bg-gray-900/30">
            {/* qSOFA criteria chips */}
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: "Altered mentation (GCS<15)", active: qsofa.mentation },
                { label: `RR ≥22 (currently ${vitals.respiratory_rate ?? "?"}min)`, active: qsofa.rrHigh },
                { label: `SBP ≤100 (currently ${vitals.bp_systolic ?? "?"} mmHg)`, active: qsofa.sbpLow },
              ].map((c, i) => (
                <span key={i} className={cn("text-[11px] px-2 py-0.5 rounded-full font-medium border",
                  c.active ? "bg-red-100 text-red-700 border-red-300" : "bg-gray-100 text-gray-500 border-gray-200")}>
                  {c.active ? "✓" : "○"} {c.label}
                </span>
              ))}
              <span className={cn("text-[11px] px-2 py-0.5 rounded-full font-medium border",
                sirs >= 2 ? "bg-amber-100 text-amber-700 border-amber-300" : "bg-gray-100 text-gray-500 border-gray-200")}>
                SIRS {sirs}/3
              </span>
            </div>

            {/* AI result */}
            {aiResult && (
              <div className="bg-white dark:bg-gray-900 border border-orange-200 rounded-lg p-3 space-y-1.5 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-orange-700 mb-2">
                  <Bot className="h-3.5 w-3.5" />
                  AI Sepsis Source Analysis
                  <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-normal ml-1">
                    Physician review required
                  </span>
                </div>
                {aiResult.differentials?.slice(0, 3).map((d, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-orange-500 font-bold shrink-0">{i + 1}.</span>
                    <div>
                      <span className="font-medium">{d.diagnosis}</span>
                      {d.recommended_investigations?.slice(0, 4).length > 0 && (
                        <p className="text-muted-foreground mt-0.5">{d.recommended_investigations.slice(0, 4).join(" · ")}</p>
                      )}
                    </div>
                  </div>
                ))}
                {(aiResult.red_flags_detected?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1.5 border-t border-orange-100 mt-1.5">
                    {aiResult.red_flags_detected!.map((f, i) => (
                      <span key={i} className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded">{f}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              {!aiResult && (
                <Button size="sm" variant="outline"
                  className="h-7 text-xs gap-1.5 border-orange-300 text-orange-700 hover:bg-orange-50"
                  onClick={handleAIAnalysis} disabled={aiLoading}>
                  {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bot className="h-3 w-3" />}
                  AI Sepsis Analysis
                </Button>
              )}
              {aiResult && (
                <Button size="sm" className="h-7 text-xs bg-orange-600 hover:bg-orange-700 text-white"
                  onClick={() => setShowAttestation(true)}>
                  Acknowledge with Attestation
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-7 text-xs text-orange-600 hover:bg-orange-50"
                onClick={() => setDismissed(true)}>
                Dismiss
              </Button>
            </div>
          </div>
        )}
      </div>

      {showAttestation && aiResult && (
        <AIAttestationModal
          open={showAttestation}
          title="Sepsis Screening — AI Analysis"
          feature="sepsis_screening"
          sourceId={admissionId}
          hospitalId={hospitalId}
          aiOutput={aiResult as Record<string, unknown>}
          previewContent={previewText}
          initialEditableText={`Sepsis alert reviewed. qSOFA ${qsofa.score}/3. AI suggested source: ${aiResult.differentials?.[0]?.diagnosis || "unknown"}. Plan: [Document sepsis bundle actions here]`}
          editableLabel="Acknowledgement & Action Plan"
          onAccept={() => { setShowAttestation(false); setDismissed(true); }}
          onDiscard={() => setShowAttestation(false)}
        />
      )}
    </>
  );
};

// ── Main component ─────────────────────────────────────────────────────────────
const SepsisWarningBanner: React.FC<Props> = ({
  admissionId, hospitalId, patientAge, currentDiagnosis, news2Score, onTabChange,
}) => {
  const [vitals, setVitals] = useState<LatestVitals | null>(null);

  const fetchVitals = useCallback(async () => {
    if (!hospitalId) return;
    const { data } = await (supabase as any)
      .from("nursing_vitals")
      .select("gcs_total, respiratory_rate, bp_systolic, temperature, pulse")
      .eq("admission_id", admissionId)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setVitals(data || null);
  }, [admissionId, hospitalId]);

  useEffect(() => { fetchVitals(); }, [fetchVitals]);

  const qsofa = vitals ? calcQSOFA(vitals) : null;
  const sirs = vitals ? sirsCount(vitals) : 0;

  // NEWS2-based alert (existing behaviour)
  const renderNEWS2 = () => {
    if (!news2Score || news2Score < 5) return null;
    const level = getNEWS2Level(news2Score);
    const label = getNEWS2Label(news2Score);
    const handleView = () => onTabChange?.("vitals");

    if (level === "medium") {
      return (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-amber-300 bg-amber-50 mb-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800">{label}</p>
            <p className="text-xs text-amber-700">Urgent clinical review required — monitor closely</p>
          </div>
          <Button size="sm" variant="outline" className="shrink-0 border-amber-400 text-amber-800 hover:bg-amber-100 h-7 text-xs" onClick={handleView}>
            View Vitals <ChevronRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
      );
    }
    if (level === "high") {
      return (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-red-400 bg-red-50 mb-3">
          <AlertOctagon className="h-5 w-5 text-red-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-red-800">{label}</p>
            <p className="text-xs text-red-700">Immediate review required — escalate to senior clinician</p>
          </div>
          <Button size="sm" variant="outline" className="shrink-0 border-red-400 text-red-800 hover:bg-red-100 h-7 text-xs" onClick={handleView}>
            View Vitals <ChevronRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg border-2 border-red-600 bg-red-100 mb-3 animate-pulse">
        <Siren className="h-5 w-5 text-red-700 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-red-900">{label}</p>
          <p className="text-xs text-red-800 font-medium">Emergency response required — consider ICU transfer</p>
        </div>
        <Button size="sm" className="shrink-0 bg-red-700 hover:bg-red-800 text-white h-7 text-xs" onClick={handleView}>
          View Vitals <ChevronRight className="h-3 w-3 ml-1" />
        </Button>
      </div>
    );
  };

  if (!news2Score && (!qsofa || qsofa.score < 2)) return null;

  return (
    <>
      {/* qSOFA sepsis alert — shown when qSOFA ≥ 2 and vitals are available */}
      {qsofa && qsofa.score >= 2 && vitals && hospitalId && (
        <QSOFAAlert
          vitals={vitals}
          qsofa={qsofa}
          sirs={sirs}
          admissionId={admissionId}
          hospitalId={hospitalId}
          patientAge={patientAge ?? null}
          currentDiagnosis={currentDiagnosis}
        />
      )}
      {/* NEWS2 escalation alerts */}
      {renderNEWS2()}
    </>
  );
};

export default SepsisWarningBanner;

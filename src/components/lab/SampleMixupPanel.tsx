import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Loader2, ShieldAlert, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import {
  checkDeterministicMixupIndicators,
  runAiMixupAssessment,
  type MixupIndicator,
  type AiMixupAssessment,
  type MixupCheckItem,
} from "@/lib/labSampleIntegrity";

// Wrong-blood-in-tube / sample mix-up detection panel (lab plan Phase 13).
// Deterministic indicators (blood-group conflict, sex-specific test violation, Hb/Hct
// ratio) are always computed and, if any is HIGH severity, gate release until a human
// acknowledges with a reason — this mirrors the QC-override pattern (Phase 11). The
// optional AI holistic assessment is advisory only and never blocks.

interface Props {
  orderId: string;
  hospitalId: string;
  patientId: string;
  patientGender: string | null;
  patientBloodGroup: string | null;
  items: MixupCheckItem[];
  currentUserId: string | null;
  onAcknowledged: () => void;
  acknowledged: { by: string | null; reason: string | null; at: string | null };
}

const SampleMixupPanel: React.FC<Props> = ({
  orderId, hospitalId, patientId, patientGender, patientBloodGroup, items, currentUserId, onAcknowledged, acknowledged,
}) => {
  const { toast } = useToast();
  const [aiResult, setAiResult] = useState<AiMixupAssessment | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiRan, setAiRan] = useState(false);
  const [ackReason, setAckReason] = useState("");
  const [ackSaving, setAckSaving] = useState(false);
  const [showAck, setShowAck] = useState(false);

  const indicators: MixupIndicator[] = useMemo(
    () => checkDeterministicMixupIndicators({ patientGender, patientRecordedBloodGroup: patientBloodGroup, items }),
    [patientGender, patientBloodGroup, items]
  );
  const hasHigh = indicators.some(i => i.severity === "high");
  const hasModerate = indicators.some(i => i.severity === "moderate");
  const isAcknowledged = !!acknowledged.at;

  // Auto-run the AI holistic layer when there's a deterministic high indicator, or when
  // 2+ items have a delta flag already (a stronger holistic signal than any single delta).
  const deltaCount = items.filter((i: any) => i.delta_flag).length;
  useEffect(() => {
    if (aiRan || aiLoading) return;
    if (!hasHigh && deltaCount < 2) return;
    setAiRan(true);
    setAiLoading(true);
    runAiMixupAssessment({ hospitalId, patientId, orderId, deterministicIndicators: indicators, currentItems: items })
      .then(setAiResult)
      .finally(() => setAiLoading(false));
  }, [hasHigh, deltaCount, aiRan, aiLoading, hospitalId, patientId, orderId, indicators, items]);

  const runManualAiCheck = async () => {
    setAiLoading(true);
    const result = await runAiMixupAssessment({ hospitalId, patientId, orderId, deterministicIndicators: indicators, currentItems: items });
    setAiResult(result);
    setAiLoading(false);
  };

  const submitAck = async () => {
    if (!currentUserId || !ackReason.trim()) return;
    setAckSaving(true);
    const at = new Date().toISOString();
    await (supabase as any).from("lab_orders").update({
      mixup_acknowledged_by: currentUserId,
      mixup_ack_reason: ackReason.trim(),
      mixup_acknowledged_at: at,
    }).eq("id", orderId);
    await logNABHEvidence(
      hospitalId,
      "QPS.2",
      `Sample mix-up indicator acknowledged for order ${orderId}: ${ackReason.trim()} (indicators: ${indicators.map(i => i.rule).join(", ")})`,
      "compliant"
    );
    setAckSaving(false);
    setShowAck(false);
    setAckReason("");
    toast({ title: "Acknowledged", description: "Release is now permitted for this order." });
    onAcknowledged();
  };

  if (indicators.length === 0 && !aiResult && !aiLoading) return null;

  return (
    <div className={cn(
      "rounded-lg border p-3 space-y-2 mx-4 mb-3",
      hasHigh && !isAcknowledged ? "bg-red-50 border-red-300" : hasModerate ? "bg-amber-50 border-amber-200" : "bg-blue-50 border-blue-200"
    )}>
      <div className="flex items-center gap-1.5 text-xs font-bold">
        <ShieldAlert size={14} className={hasHigh && !isAcknowledged ? "text-red-600" : "text-amber-600"} />
        Sample Integrity Check {hasHigh && !isAcknowledged && "— RELEASE BLOCKED"}
      </div>

      {indicators.length > 0 && (
        <ul className="space-y-1">
          {indicators.map((ind, i) => (
            <li key={i} className={cn("text-[11px]", ind.severity === "high" ? "text-red-700 font-semibold" : "text-amber-700")}>
              [{ind.severity.toUpperCase()}] {ind.message}
            </li>
          ))}
        </ul>
      )}

      {isAcknowledged && (
        <p className="text-[11px] text-emerald-700 flex items-center gap-1">
          <CheckCircle2 size={12} /> Acknowledged — {acknowledged.reason}
        </p>
      )}

      {hasHigh && !isAcknowledged && (
        showAck ? (
          <div className="space-y-1.5">
            <textarea
              value={ackReason}
              onChange={e => setAckReason(e.target.value)}
              placeholder="Reason for proceeding (required) — e.g. confirmed with ward, patient history reviewed"
              className="w-full text-[11px] border border-red-300 rounded-md px-2 py-1.5 bg-white"
              rows={2}
            />
            <div className="flex gap-2">
              <button onClick={() => setShowAck(false)} className="text-[11px] px-2.5 py-1 rounded border border-border text-muted-foreground hover:bg-muted">Cancel</button>
              <button
                onClick={submitAck}
                disabled={!ackReason.trim() || ackSaving}
                className="text-[11px] px-2.5 py-1 rounded bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {ackSaving ? "Recording…" : "Acknowledge & Permit Release"}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAck(true)} className="text-[11px] px-2.5 py-1 rounded bg-red-600 text-white font-semibold hover:bg-red-700">
            Review & Acknowledge…
          </button>
        )
      )}

      {/* AI holistic layer — advisory only, never blocks */}
      <div className="pt-1 border-t border-black/5">
        {aiLoading ? (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Running AI pattern check…</p>
        ) : aiResult ? (
          <div className="text-[11px]">
            <p className={cn("font-semibold", aiResult.risk === "high" ? "text-red-700" : aiResult.risk === "moderate" ? "text-amber-700" : "text-emerald-700")}>
              <Sparkles size={10} className="inline mr-1" /> AI assessment: {aiResult.risk} risk (advisory)
            </p>
            {aiResult.indicators.length > 0 && (
              <ul className="mt-0.5 list-disc list-inside opacity-80">
                {aiResult.indicators.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            )}
            <p className="mt-0.5 italic opacity-80">{aiResult.recommendation}</p>
          </div>
        ) : (
          <button onClick={runManualAiCheck} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1">
            <Sparkles size={11} /> Run deeper AI pattern check
          </button>
        )}
      </div>
    </div>
  );
};

export default SampleMixupPanel;

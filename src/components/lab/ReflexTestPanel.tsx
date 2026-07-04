import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { suggestReflexTests, type ReflexSuggestion } from "@/lib/labReflexTests";
import NewLabOrderModal from "./NewLabOrderModal";

// AI reflex-test suggestion panel (lab plan Phase 14). Advisory only — proposes
// follow-on tests for an abnormal panel; a human orders or dismisses each one.
// "Order" reuses NewLabOrderModal's existing preselectedTestNames prop so the test is
// pre-picked and just needs payment/confirmation, not re-entered from scratch.

interface Props {
  hospitalId: string;
  patientId: string;
  patientName: string;
  patientUhid: string;
  patientGender?: string | null;
  patientDob?: string | null;
  encounterId?: string | null;
  admissionId?: string | null;
  abnormalResults: Array<{ test_name: string; result_value: string | null; result_flag: string | null; unit: string | null }>;
  clinicalNotes?: string | null;
}

const URGENCY_STYLE: Record<string, string> = {
  priority: "border-amber-300 bg-amber-50",
  routine: "border-border bg-card",
};

const ReflexTestPanel: React.FC<Props> = ({
  hospitalId, patientId, patientName, patientUhid, patientGender, patientDob,
  encounterId, admissionId, abnormalResults, clinicalNotes,
}) => {
  const [suggestions, setSuggestions] = useState<ReflexSuggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [orderingTest, setOrderingTest] = useState<string | null>(null);

  if (abnormalResults.length === 0) return null;

  const run = async () => {
    setLoading(true);
    const result = await suggestReflexTests({ hospitalId, patientId, abnormalResults, clinicalNotes });
    setSuggestions(result);
    setLoading(false);

    (supabase as any).from("ai_feature_logs").insert({
      hospital_id: hospitalId,
      module: "lab",
      feature_key: "lab_reflex_tests",
      patient_id: patientId,
      input_summary: `${abnormalResults.length} abnormal result(s)`,
      output_summary: `${result.length} reflex suggestion(s)`,
      success: true,
    }).then(() => {});
  };

  const visible = (suggestions || []).filter(s => !dismissed.has(s.suggested_test));

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2 mx-4 mb-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <Sparkles size={13} className="text-primary" /> AI Reflex Test Suggestions
        </span>
        {suggestions === null && (
          <button onClick={run} disabled={loading} className="text-[11px] px-2.5 py-1 rounded bg-primary text-primary-foreground font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-1">
            {loading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            {loading ? "Analysing…" : "Suggest Follow-on Tests"}
          </button>
        )}
      </div>

      {suggestions !== null && visible.length === 0 && (
        <p className="text-[11px] text-muted-foreground">No additional reflex tests suggested for this abnormal pattern.</p>
      )}

      {visible.map((s, i) => (
        <div key={i} className={cn("rounded-md border px-3 py-2 text-[11px] flex items-start justify-between gap-2", URGENCY_STYLE[s.urgency] || URGENCY_STYLE.routine)}>
          <div className="min-w-0">
            <p className="font-semibold text-foreground">
              {s.suggested_test}
              {s.urgency === "priority" && <span className="ml-1.5 text-[9px] font-bold text-amber-700 uppercase">Priority</span>}
            </p>
            <p className="text-muted-foreground mt-0.5">Triggered by: {s.trigger_finding}</p>
            <p className="text-muted-foreground">{s.rationale}</p>
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <button
              onClick={() => setOrderingTest(s.suggested_test)}
              className="text-[10px] px-2 py-1 rounded bg-primary text-primary-foreground font-semibold hover:opacity-90 flex items-center gap-1"
            >
              <Plus size={10} /> Order
            </button>
            <button
              onClick={() => setDismissed(prev => new Set(prev).add(s.suggested_test))}
              className="text-[10px] px-2 py-1 rounded border border-border text-muted-foreground hover:bg-muted"
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}

      {orderingTest && (
        <NewLabOrderModal
          hospitalId={hospitalId}
          preselectedPatient={{ id: patientId, full_name: patientName, uhid: patientUhid, gender: patientGender, dob: patientDob }}
          preselectedTestNames={[orderingTest]}
          linkedEncounterId={encounterId}
          linkedAdmissionId={admissionId}
          onClose={() => setOrderingTest(null)}
          onCreated={() => {
            setDismissed(prev => new Set(prev).add(orderingTest));
            setOrderingTest(null);
          }}
        />
      )}
    </div>
  );
};

export default ReflexTestPanel;

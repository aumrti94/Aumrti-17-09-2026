import React, { useState, useEffect } from "react";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check, Pause, X, AlertTriangle } from "lucide-react";
import type { NursingTask } from "@/pages/nursing/NursingPage";
import { isHighAlert } from "@/lib/high-alert-meds";
import HighAlertDoubleCheckModal from "./HighAlertDoubleCheckModal";
import AllergyBanner from "@/components/clinical/AllergyBanner";
import { useCredentialGate } from "@/components/hr/useCredentialGate";

interface Props {
  task: NursingTask;
  onComplete: () => void;
}

const fiveRights = (task: NursingTask) => [
  { key: "patient", label: "Right PATIENT", detail: task.patientName },
  { key: "drug", label: "Right DRUG", detail: `${task.drugName} ${task.dose || ""}` },
  { key: "dose", label: "Right DOSE", detail: task.dose || "—" },
  { key: "route", label: "Right ROUTE", detail: task.route || "Oral" },
  { key: "time", label: "Right TIME", detail: task.scheduledTime },
];

const holdReasons = [
  "Patient refused",
  "Patient sleeping",
  "Doctor order to hold",
  "Drug not available",
  "Patient NBM",
  "Other",
];

const NursingMedicationTask: React.FC<Props> = ({ task, onComplete }) => {
  const { toast } = useToast();
  const { guard, gateElement } = useCredentialGate(task.hospitalId || null);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [showHold, setShowHold] = useState(false);
  const [showNotGiven, setShowNotGiven] = useState(false);
  const [reason, setReason] = useState("");
  const [showDoubleCheck, setShowDoubleCheck] = useState(false);
  const [patientAllergies, setPatientAllergies] = useState<string | null>(null);

  const drugIsHighAlert = isHighAlert(task.drugName);

  useEffect(() => {
    if (!task.patientId) return;
    supabase
      .from("patients")
      .select("allergies")
      .eq("id", task.patientId)
      .maybeSingle()
      .then(({ data }) => setPatientAllergies(data?.allergies ?? null));
  }, [task.patientId]);

  const allChecked = fiveRights(task).every((r) => checks[r.key]);

  // License-validity gate on the administering nurse before "given"
  const initiateGive = async () => {
    const proceed = () => { if (drugIsHighAlert) setShowDoubleCheck(true); else saveOutcome("given"); };
    const { data: u } = await supabase.auth.getUser();
    const { data: cu } = await supabase.from("users").select("id").eq("auth_user_id", u.user?.id || "").maybeSingle();
    guard({ clinicianId: cu?.id || "", module: "nursing", action: "medication_admin", recordId: task.medicationId || null }, proceed);
  };

  // Returns the new/updated nursing_mar row's id on success, or undefined on failure — callers
  // that need to link a follow-up record (e.g. the high-alert double-check) to this exact dose
  // use the id. mar_records is now populated by a DB trigger on nursing_mar — no manual mirror
  // insert here. Upsert (not insert) because Kardex's "Generate Today's MAR" may have already
  // created a "pending" placeholder row for this same dose — this overwrites it with the real
  // outcome instead of colliding with the unique constraint.
  const saveOutcome = async (outcome: string, omissionReason?: string): Promise<string | undefined> => {
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;

    const { data: marRow, error } = await supabase.from("nursing_mar").upsert({
      hospital_id: task.hospitalId!,
      admission_id: task.admissionId,
      medication_id: task.medicationId!,
      scheduled_date: task.scheduledDate,
      scheduled_time: task.scheduledTime,
      administered_at: outcome === "given" ? new Date().toISOString() : null,
      administered_by: userId,
      outcome,
      omission_reason: omissionReason || null,
      five_rights_verified: allChecked,
    }, { onConflict: "admission_id,medication_id,scheduled_date,scheduled_time" }).select("id").single();

    setSaving(false);
    if (error) {
      toast({ title: "Error saving record", description: error.message, variant: "destructive" });
      return undefined;
    } else {
      toast({
        title: outcome === "given"
          ? `✓ Administered: ${task.drugName} ${task.dose || ""}`
          : `${task.drugName} — ${outcome.toUpperCase()}`,
        description: outcome === "given" ? "5 Rights verified. Recorded to MAR." : undefined,
      });
      if (outcome === "given" && task.hospitalId) {
        logNABHEvidence(task.hospitalId, "MOM.3",
          `Medication administered: ${task.drugName} ${task.dose || ""} to ${task.patientName || "patient"}. 5 Rights verified.`);
      }
      onComplete();
      return marRow?.id;
    }
  };

  const handleDoubleCheckConfirmed = async (
    secondNurseId: string,
    verifiedRights: { right_patient: boolean; right_drug: boolean; right_dose: boolean; right_route: boolean; right_time: boolean; confirmed_at: string },
  ) => {
    setShowDoubleCheck(false);
    const { data: userData } = await supabase.auth.getUser();
    const marId = await saveOutcome("given");
    if (!marId || !task.hospitalId) return;
    await (supabase as any).from("mar_double_checks").insert({
      hospital_id: task.hospitalId,
      mar_id: marId,
      first_nurse_id: userData?.user?.id || null,
      second_nurse_id: secondNurseId,
      second_nurse_confirmed_at: verifiedRights.confirmed_at,
      five_rights_both: true,
      second_nurse_verified_rights: verifiedRights,
    });
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {gateElement}
      {/* Allergy Banner — always shown before medication administration */}
      <AllergyBanner allergies={patientAllergies} />

      {/* 5 Rights */}
      <div>
        <h3 className="text-sm font-bold text-foreground mb-3">5 Rights Verification</h3>
        <div className="space-y-2">
          {fiveRights(task).map((r) => (
            <button
              key={r.key}
              onClick={() => setChecks((c) => ({ ...c, [r.key]: !c[r.key] }))}
              className={cn(
                "w-full flex items-center gap-3 h-12 rounded-lg px-4 border-[1.5px] transition-colors text-left active:scale-[0.98]",
                checks[r.key]
                  ? "border-green-500 bg-green-50"
                  : "border-border bg-card"
              )}
            >
              <div className={cn(
                "h-6 w-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                checks[r.key] ? "border-green-500 bg-green-500 text-white" : "border-muted-foreground/40"
              )}>
                {checks[r.key] && <Check size={14} />}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-semibold text-muted-foreground">{r.label}</span>
                <p className="text-sm text-foreground truncate">{r.detail}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Drug detail card */}
      <div className="bg-card rounded-lg border border-border p-4">
        <p className="text-base font-bold text-foreground">{task.drugName}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-sm font-semibold text-primary">{task.dose}</span>
          {task.route && <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{task.route}</span>}
          {task.frequency && <span className="text-xs text-muted-foreground">{task.frequency}</span>}
        </div>
        {task.instructions && <p className="text-xs text-muted-foreground mt-2 italic">{task.instructions}</p>}
      </div>

      {task.isNdps && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">NDPS Drug — Dual nurse verification required</p>
        </div>
      )}

      {drugIsHighAlert && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 font-medium">⚠ High-Alert Medication — Second nurse double-check required before administration</p>
        </div>
      )}

      {/* Outcome buttons */}
      {!showHold && !showNotGiven && (
        <div className="flex gap-3">
          <Button
            onClick={initiateGive}
            disabled={!allChecked || saving}
            className="flex-1 h-[52px] text-sm font-bold bg-green-600 hover:bg-green-700"
          >
            <Check size={18} /> GIVEN
          </Button>
          <Button
            onClick={() => setShowHold(true)}
            variant="outline"
            className="flex-1 h-[52px] text-sm font-bold border-amber-400 text-amber-700 hover:bg-amber-50"
          >
            <Pause size={18} /> HOLD
          </Button>
          <Button
            onClick={() => setShowNotGiven(true)}
            variant="outline"
            className="flex-1 h-[52px] text-sm font-bold border-destructive text-destructive hover:bg-destructive/5"
          >
            <X size={18} /> NOT GIVEN
          </Button>
        </div>
      )}

      {/* Hold reason */}
      {showHold && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <p className="text-sm font-bold text-foreground">Reason for hold</p>
          <div className="flex flex-wrap gap-2">
            {holdReasons.map((r) => (
              <button
                key={r}
                onClick={() => setReason(r)}
                className={cn(
                  "px-3 py-2 rounded-lg text-xs font-medium border transition-colors",
                  reason === r ? "bg-amber-100 border-amber-400 text-amber-800" : "bg-muted border-border text-foreground"
                )}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button onClick={() => saveOutcome("held", reason)} disabled={!reason || saving} className="flex-1 h-11 bg-amber-600 hover:bg-amber-700">
              Confirm Hold
            </Button>
            <Button variant="ghost" onClick={() => { setShowHold(false); setReason(""); }}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Not given reason */}
      {showNotGiven && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <p className="text-sm font-bold text-foreground">Reason not given</p>
          <div className="flex flex-wrap gap-2">
            {holdReasons.map((r) => (
              <button
                key={r}
                onClick={() => setReason(r)}
                className={cn(
                  "px-3 py-2 rounded-lg text-xs font-medium border transition-colors",
                  reason === r ? "bg-destructive/10 border-destructive/40 text-destructive" : "bg-muted border-border text-foreground"
                )}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button onClick={() => saveOutcome("refused", reason)} disabled={!reason || saving} variant="destructive" className="flex-1 h-11">
              Confirm
            </Button>
            <Button variant="ghost" onClick={() => { setShowNotGiven(false); setReason(""); }}>Cancel</Button>
          </div>
        </div>
      )}

      <HighAlertDoubleCheckModal
        open={showDoubleCheck}
        drugName={task.drugName}
        dose={task.dose}
        onConfirmed={handleDoubleCheckConfirmed}
        onCancel={() => setShowDoubleCheck(false)}
      />
    </div>
  );
};

export default NursingMedicationTask;

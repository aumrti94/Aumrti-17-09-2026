import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import MedReconciliationPanel from "@/components/ipd/MedReconciliationPanel";
import { Activity, Pill, ClipboardList, CheckCircle2, Stethoscope, CreditCard, Package, FileText, Loader2, Receipt, Scissors, FlaskConical, Scan, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import DischargeInstructions from "@/components/ipd/DischargeInstructions";
import DischargeSummaryGenerator from "@/components/ipd/DischargeSummaryGenerator";
import DischargeSummaryAIPanel from "@/components/ipd/DischargeSummaryAIPanel";
import ReadmissionRiskPanel from "@/components/ipd/ReadmissionRiskPanel";
import PreDischargeLeakageBanner from "@/components/ipd/PreDischargeLeakageBanner";
import DischargeTATTimer from "@/components/ipd/DischargeTATTimer";
import SepsisWarningBanner from "@/components/ipd/SepsisWarningBanner";
import ADRDetectorPanel from "@/components/ipd/ADRDetectorPanel";
import { autoPullAdmissionCharges } from "@/lib/ipdBilling";
import { logAudit } from "@/lib/auditLog";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  admissionId: string;
  hospitalId: string | null;
  onTabChange: (tab: string) => void;
  patientName?: string;
  patientPhone?: string | null;
  highlightDischarge?: boolean;
}

const IPDOverviewTab: React.FC<Props> = ({ admissionId, hospitalId, onTabChange, patientName, patientPhone, highlightDischarge }) => {
  const navigate = useNavigate();
  const [latestVitals, setLatestVitals] = useState<any>(null);
  const [medications, setMedications] = useState<any[]>([]);
  const [vitalsTime, setVitalsTime] = useState("");
  const [billingCleared, setBillingCleared] = useState(false);
  const [medicalCleared, setMedicalCleared] = useState(false);
  const [pharmacyCleared, setPharmacyCleared] = useState(false);
  const [dischargeSummaryDone, setDischargeSummaryDone] = useState(false);
  const [admDiagnosis, setAdmDiagnosis] = useState("");
  const [dischargeType, setDischargeType] = useState("regular");
  const [reconPatientId, setReconPatientId] = useState("");
  const [reconUserId, setReconUserId] = useState("");
  const [savingStep, setSavingStep] = useState<string | null>(null);
  const [workflowSteps, setWorkflowSteps] = useState<Array<{ name: string; role: string; required: boolean; timeLimit: number }> | null>(null);
  const [customClearances, setCustomClearances] = useState<Record<string, boolean>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Discharge billing-completeness gate (Phase 11 — hard block, not advisory)
  const [otBillingOk, setOtBillingOk] = useState<boolean | null>(null);
  const [checkingBilling, setCheckingBilling] = useState(false);
  const [dischargeOverrideRecorded, setDischargeOverrideRecorded] = useState(false);
  const [showDischargeOverridePrompt, setShowDischargeOverridePrompt] = useState(false);
  const [dischargeOverrideReason, setDischargeOverrideReason] = useState("");
  const [submittingOverride, setSubmittingOverride] = useState(false);

  useEffect(() => {
    if (!admissionId) return;
    // Fetch current user for reconciliation panel
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setReconUserId(data.user.id);
      if (data.user) {
        supabase.from("users").select("id").eq("auth_user_id", data.user.id).maybeSingle()
          .then(({ data: userData }) => setCurrentUserId(userData?.id || null));
      }
    });
    const loadStatus = async () => {
      const { data } = await (supabase as any).from("admissions")
        .select("billing_cleared, admitting_diagnosis, medical_cleared, pharmacy_cleared, discharge_summary_done, discharge_type, discharge_ordered_at, discharged_at, custom_clearances, patient_id, discharge_billing_override_reason")
        .eq("id", admissionId).maybeSingle() as { data: any };
      if (data?.patient_id) setReconPatientId(data.patient_id);

      // Auto-reset stale discharge workflow: if initiated on a previous day but never completed
      if (data?.discharge_ordered_at && !data?.discharged_at) {
        const workflowDay = new Date(data.discharge_ordered_at);
        const today = new Date();
        workflowDay.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);

        if (workflowDay < today) {
          await supabase.from("admissions").update({
            medical_cleared: false,
            billing_cleared: false,
            pharmacy_cleared: false,
            discharge_ordered_at: null,
            custom_clearances: {},
            discharge_billing_override_reason: null,
            discharge_billing_override_by: null,
            discharge_billing_override_at: null,
            lama_billing_ack_by: null,
            lama_billing_ack_at: null,
          } as any).eq("id", admissionId);

          setMedicalCleared(false);
          setBillingCleared(false);
          setPharmacyCleared(false);
          setDischargeSummaryDone(false);
          setCustomClearances({});
          setDischargeOverrideRecorded(false);
          setOtBillingOk(null);
          setAdmDiagnosis(data?.admitting_diagnosis || "");
          if (data?.discharge_type) setDischargeType(data.discharge_type);
          toast({
            title: "Discharge workflow reset",
            description: "Patient was not discharged yesterday. Workflow has been reset to ensure all charges are captured.",
          });
          return; // Skip auto-syncs — flags were just cleared
        }
      }

      setMedicalCleared(data?.medical_cleared || false);
      setDischargeSummaryDone(data?.discharge_summary_done || false);
      setCustomClearances((data?.custom_clearances as Record<string, boolean>) || {});
      setAdmDiagnosis(data?.admitting_diagnosis || "");
      if (data?.discharge_type) setDischargeType(data.discharge_type);
      setDischargeOverrideRecorded(!!data?.discharge_billing_override_reason);

      // Only auto-sync when today's discharge workflow is active — prevents a stale paid bill
      // from re-setting billing_cleared=true right after a daily reset.
      const workflowActiveToday =
        data?.discharge_ordered_at &&
        new Date(data.discharge_ordered_at).toDateString() === new Date().toDateString();

      // Real-time billing sync: check flag OR if a paid bill exists (today's workflow only)
      let billingOk = data?.billing_cleared || false;
      if (!billingOk && workflowActiveToday) {
        const { data: paidBills } = await supabase.from("bills")
          .select("id")
          .eq("admission_id", admissionId)
          .eq("payment_status", "paid")
          .limit(1);
        billingOk = (paidBills && paidBills.length > 0);
        if (billingOk) {
          await supabase.from("admissions").update({ billing_cleared: true }).eq("id", admissionId);
        }
      }
      setBillingCleared(billingOk);

      // Real-time pharmacy sync: check flag OR if no pending dispensing exists (today's workflow only)
      let pharmacyOk = data?.pharmacy_cleared || false;
      if (!pharmacyOk && workflowActiveToday) {
        const { data: pendingDisp } = await supabase.from("pharmacy_dispensing")
          .select("id")
          .eq("admission_id", admissionId)
          .in("status", ["pending", "processing"])
          .limit(1);
        const { data: anyDisp } = await supabase.from("pharmacy_dispensing")
          .select("id")
          .eq("admission_id", admissionId)
          .limit(1);
        pharmacyOk = (anyDisp && anyDisp.length > 0 && (!pendingDisp || pendingDisp.length === 0));
        if (pharmacyOk) {
          await supabase.from("admissions").update({ pharmacy_cleared: true }).eq("id", admissionId);
        }
      }
      setPharmacyCleared(pharmacyOk);
    };
    loadStatus();
  }, [admissionId]);

  useEffect(() => {
    if (!hospitalId) return;
    (supabase as any).from("hospitals").select("discharge_workflow").eq("id", hospitalId).maybeSingle()
      .then(({ data }: { data: any }) => {
        const raw = data?.discharge_workflow;
        if (!raw) return;
        // Support both legacy Step[] and new { id, steps } formats
        const steps = Array.isArray(raw) ? raw : Array.isArray(raw?.steps) ? raw.steps : null;
        if (steps) setWorkflowSteps(steps);
      });
  }, [hospitalId]);

  useEffect(() => {
    if (!admissionId || !hospitalId) return;
    supabase.from("ipd_vitals")
      .select("*").eq("admission_id", admissionId)
      .order("recorded_at", { ascending: false }).limit(1)
      .then(({ data }) => {
        if (data?.[0]) {
          setLatestVitals(data[0]);
          const mins = Math.round((Date.now() - new Date(data[0].recorded_at).getTime()) / 60000);
          setVitalsTime(mins < 60 ? `${mins} min ago` : `${Math.floor(mins / 60)}h ago`);
        }
      });
    supabase.from("ipd_medications")
      .select("*").eq("admission_id", admissionId).eq("is_active", true)
      .order("created_at", { ascending: false })
      .then(({ data }) => setMedications(data || []));
  }, [admissionId, hospitalId]);

  const updateAdmission = async (field: string, value: boolean) => {
    setSavingStep(field);
    const { error } = await supabase.from("admissions").update({ [field]: value } as any).eq("id", admissionId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Updated", description: `${field.replace(/_/g, " ")} marked` });
    }
    setSavingStep(null);
    return !error;
  };

  const handleWorkflowReset = async () => {
    setSavingStep("reset");
    const { error } = await (supabase as any).from("admissions").update({
      medical_cleared: false,
      billing_cleared: false,
      pharmacy_cleared: false,
      discharge_summary_done: false,
      discharge_ordered_at: null,
      discharge_type: null,
      custom_clearances: {},
      discharge_billing_override_reason: null,
      discharge_billing_override_by: null,
      discharge_billing_override_at: null,
      lama_billing_ack_by: null,
      lama_billing_ack_at: null,
    }).eq("id", admissionId);
    if (error) {
      toast({ title: "Reset failed", description: error.message, variant: "destructive" });
    } else {
      setMedicalCleared(false);
      setBillingCleared(false);
      setPharmacyCleared(false);
      setDischargeSummaryDone(false);
      setCustomClearances({});
      setDischargeType("");
      setDischargeOverrideRecorded(false);
      setOtBillingOk(null);
      toast({ title: "Workflow reset", description: "All clearances cleared — start again" });
    }
    setSavingStep(null);
  };

  const handleMedicalClear = async () => {
    const ok = await updateAdmission("medical_cleared", true);
    if (ok) setMedicalCleared(true);
  };

  const handlePharmacyClear = async () => {
    // Hard-block: verify no pending dispenses remain
    const { data: pendingDisp } = await supabase.from("pharmacy_dispensing")
      .select("id")
      .eq("admission_id", admissionId)
      .in("status", ["pending", "processing"]);

    if (pendingDisp && pendingDisp.length > 0) {
      toast({ title: "Cannot clear pharmacy", description: `${pendingDisp.length} pending dispense(s) remain`, variant: "destructive" });
      return;
    }

    const ok = await updateAdmission("pharmacy_cleared", true);
    if (ok) setPharmacyCleared(true);
  };

  const toSlug = (name: string) =>
    name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

  /**
   * Real check for "is OT/procedure billing complete for this admission" —
   * item_type here must match what chargeOTCase/buildOTChargeLineItems (the
   * actual OT billing engine) writes: ot_charge/surgeon_fee/anaesthesia_fee/
   * implant. The previous inline check used a legacy procedure/ot/surgery
   * list that never matched real OT-billed charges, so it would have always
   * reported "unbilled" even for a correctly billed case.
   */
  const checkOTBilled = async (): Promise<boolean> => {
    if (!hospitalId) return true;
    const { data: otCases } = await (supabase as any)
      .from("ot_schedules")
      .select("id")
      .eq("hospital_id", hospitalId)
      .eq("admission_id", admissionId)
      .eq("status", "completed");
    if (!otCases || otCases.length === 0) return true; // nothing to check

    const { data: activeBills } = await (supabase as any)
      .from("bills")
      .select("id")
      .eq("admission_id", admissionId)
      .not("payment_status", "eq", "cancelled");
    const billIds = (activeBills || []).map((b: any) => b.id);
    if (billIds.length === 0) return false;

    const { data: otItems } = await (supabase as any)
      .from("bill_line_items")
      .select("id")
      .eq("hospital_id", hospitalId)
      .in("item_type", ["ot_charge", "surgeon_fee", "anaesthesia_fee", "implant"])
      .in("bill_id", billIds)
      .limit(1);
    return !!(otItems && otItems.length > 0);
  };

  // Runs the real billing-completeness gate for every discharge, regardless
  // of whether the hospital has configured a custom OT-Technician step —
  // previously this only ran when that custom step existed. Self-heals by
  // pulling any unbilled charges into the active bill first, then checks
  // specifically for completed-but-unbilled OT cases.
  const runDischargeBillingCheck = async () => {
    if (!hospitalId) { setOtBillingOk(true); return; }
    setCheckingBilling(true);
    const { data: activeBills } = await (supabase as any)
      .from("bills")
      .select("id")
      .eq("admission_id", admissionId)
      .not("payment_status", "eq", "cancelled")
      .order("created_at", { ascending: false })
      .limit(1);
    if (activeBills && activeBills.length > 0) {
      await autoPullAdmissionCharges(activeBills[0].id, admissionId, hospitalId);
    }
    const ok = await checkOTBilled();
    setOtBillingOk(ok);
    setCheckingBilling(false);
  };

  useEffect(() => {
    if (!admissionId || !hospitalId) return;
    if (!medicalCleared) return; // only worth checking once the patient is actually near discharge
    if (!(billingCleared || dischargeType === "lama")) return;
    runDischargeBillingCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admissionId, hospitalId, medicalCleared, billingCleared, dischargeType]);

  const handleDischargeOverride = async () => {
    if (!dischargeOverrideReason.trim()) {
      toast({ title: "Enter a reason for overriding the unbilled-OT-charges block", variant: "destructive" });
      return;
    }
    setSubmittingOverride(true);
    await (supabase as any).from("admissions").update({
      discharge_billing_override_reason: dischargeOverrideReason.trim(),
      discharge_billing_override_by: currentUserId,
      discharge_billing_override_at: new Date().toISOString(),
    }).eq("id", admissionId);
    logAudit({
      action: "updated",
      module: "ipd",
      entityType: "admission",
      entityId: admissionId,
      details: { action: "discharge_billing_override", reason: dischargeOverrideReason.trim() },
    });
    setDischargeOverrideRecorded(true);
    setShowDischargeOverridePrompt(false);
    setSubmittingOverride(false);
    toast({ title: "Override recorded", description: "This has been logged to the audit trail." });
  };

  const handleSmartClear = async (stepName: string, stepRole: string) => {
    const slug = toSlug(stepName);
    setSavingStep(slug);
    try {
      // Lab / Radiology / Nurse: auto-pull any unbilled charges into the IPD bill before clearing.
      // This ensures no revenue leaks through without being captured in billing.
      const pullRoles = ["Lab Technician", "Radiology Technician", "Nurse"];
      if (hospitalId && pullRoles.includes(stepRole)) {
        const { data: bills } = await (supabase as any)
          .from("bills")
          .select("id")
          .eq("admission_id", admissionId)
          .not("payment_status", "eq", "cancelled")
          .order("created_at", { ascending: false })
          .limit(1);

        if (bills && bills.length > 0) {
          const result = await autoPullAdmissionCharges(bills[0].id, admissionId, hospitalId);
          if (result.insertedCount > 0) {
            toast({
              title: `${result.insertedCount} unbilled charge(s) pulled into IPD bill`,
              description: `${stepName}: All charges captured before clearance.`,
            });
          }
        } else {
          // No bill exists — warn loudly but don't block; the billing step should have caught this
          toast({
            title: "No active IPD bill found",
            description: "Open 'View / Update IPD Bill' to create the bill so charges are captured.",
            variant: "destructive",
          });
        }
      }

      // OT Technician: block clearing if OT/procedure charges are missing
      // from every bill for this admission, unless already overridden with
      // a documented reason (entered at the Discharge Summary step).
      if (stepRole === "OT Technician" && hospitalId) {
        const otOk = await checkOTBilled();
        if (!otOk && !dischargeOverrideRecorded) {
          toast({
            title: "Cannot clear — unbilled OT/procedure charges found",
            description: "Bill the OT charges in Billing, or document an override at the Discharge Summary step.",
            variant: "destructive",
          });
          setSavingStep(null);
          return;
        }
      }

      const updated = { ...customClearances, [slug]: true };
      await (supabase as any).from("admissions").update({ custom_clearances: updated }).eq("id", admissionId);
      setCustomClearances(updated);
      toast({ title: `${stepName} cleared` });
    } finally {
      setSavingStep(null);
    }
  };

  // Billing balance due for warning badge
  const [balanceDue, setBalanceDue] = useState(0);
  useEffect(() => {
    if (!admissionId) return;
    (async () => {
      const { data: bills } = await (supabase as any).from("bills")
        .select("net_amount, total_amount")
        .eq("admission_id", admissionId);
      const { data: payments } = await (supabase as any).from("bill_payments")
        .select("amount")
        .eq("admission_id", admissionId);
      const totalBilled = (bills || []).reduce((s: number, b: any) => s + (b.net_amount || b.total_amount || 0), 0);
      const totalPaid = (payments || []).reduce((s: number, p: any) => s + (p.amount || 0), 0);
      setBalanceDue(Math.max(0, totalBilled - totalPaid));
    })();
  }, [admissionId, billingCleared]);

  const DEFAULT_WORKFLOW = [
    { name: "Clinical Clearance", role: "Doctor", required: true, timeLimit: 30 },
    { name: "Billing Settlement", role: "Billing Executive", required: true, timeLimit: 60 },
    { name: "Pharmacy Clearance", role: "Pharmacist", required: true, timeLimit: 20 },
  ];

  const configuredSteps = workflowSteps || DEFAULT_WORKFLOW;

  const getStepDone = (step: { name: string; role: string }) => {
    if (step.role === "Doctor") return medicalCleared;
    if (step.role === "Billing Executive") return billingCleared;
    if (step.role === "Pharmacist") return pharmacyCleared;
    return customClearances[toSlug(step.name)] || false;
  };

  const roleToIcon = (role: string) => {
    if (role === "Doctor") return Stethoscope;
    if (role === "Billing Executive") return CreditCard;
    if (role === "Pharmacist") return Package;
    if (role === "OT Technician") return Scissors;
    if (role === "Lab Technician") return FlaskConical;
    if (role === "Radiology Technician") return Scan;
    if (role === "_summary") return FileText;
    return CheckCircle2;
  };

  const roleToColor = (role: string) => {
    if (role === "Doctor") return "text-blue-600";
    if (role === "Billing Executive") return "text-emerald-600";
    if (role === "Pharmacist") return "text-violet-600";
    if (role === "OT Technician") return "text-orange-600";
    if (role === "Lab Technician") return "text-cyan-600";
    if (role === "Radiology Technician") return "text-purple-600";
    if (role === "_summary") return "text-amber-600";
    return "text-slate-600";
  };

  const allSteps = [
    ...configuredSteps.map((s) => ({ ...s, done: getStepDone(s) })),
    { name: "Discharge Summary", role: "_summary", required: true, timeLimit: 0, done: dischargeSummaryDone },
  ];
  const currentStep = allSteps.findIndex((s) => !s.done);

  return (
    <div className="h-full p-4 overflow-y-auto">
      <SepsisWarningBanner
        news2Score={latestVitals?.news2_score ?? null}
        admissionId={admissionId}
        hospitalId={hospitalId}
        currentDiagnosis={admDiagnosis || null}
        onTabChange={onTabChange}
      />
      <div className="grid grid-cols-2 gap-3">
        {/* Card A: Today's Vitals */}
        <div className="bg-card rounded-lg border border-border p-4 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-blue-500" />
              <span className="text-[13px] font-bold text-foreground">Today's Vitals</span>
            </div>
            {vitalsTime && <span className="text-[11px] text-muted-foreground">{vitalsTime}</span>}
          </div>
          {latestVitals ? (
            <div className="grid grid-cols-2 gap-2 flex-1">
              <MiniVital label="BP" value={`${latestVitals.bp_systolic || '—'}/${latestVitals.bp_diastolic || '—'}`} unit="mmHg" />
              <MiniVital label="Pulse" value={latestVitals.pulse || '—'} unit="bpm" />
              <MiniVital label="Temp" value={latestVitals.temperature || '—'} unit="°F" />
              <MiniVital label="SpO2" value={latestVitals.spo2 || '—'} unit="%" />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground flex-1 flex items-center">No vitals recorded yet</p>
          )}
          <Button size="sm" variant="outline" className="mt-2 text-xs h-7 w-full" onClick={() => onTabChange("vitals")}>
            Add Vitals
          </Button>
        </div>

        {/* Card B: Active Medications */}
        <div className="bg-card rounded-lg border border-border p-4 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <Pill className="h-4 w-4 text-emerald-500" />
            <span className="text-[13px] font-bold text-foreground">Active Medications</span>
            <span className="text-[11px] text-muted-foreground ml-auto">{medications.length}</span>
          </div>
          <div className="flex-1 space-y-1.5 overflow-y-auto">
            {medications.slice(0, 4).map((m) => (
              <div key={m.id} className="text-xs">
                <span className="font-semibold text-foreground">{m.drug_name}</span>
                <span className="text-muted-foreground ml-1">{m.dose} · {m.frequency}</span>
              </div>
            ))}
            {medications.length > 4 && (
              <button onClick={() => onTabChange("medications")} className="text-[11px] text-primary hover:underline">
                + {medications.length - 4} more
              </button>
            )}
            {medications.length === 0 && <p className="text-xs text-muted-foreground">No active medications</p>}
          </div>
          <Button size="sm" variant="outline" className="mt-2 text-xs h-7 w-full" onClick={() => onTabChange("medications")}>
            Add Med
          </Button>
        </div>

        {/* Card C: Pending Orders */}
        <div className="bg-card rounded-lg border border-border p-4 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <ClipboardList className="h-4 w-4 text-amber-500" />
            <span className="text-[13px] font-bold text-foreground">Pending Orders</span>
          </div>
          <div className="flex-1 flex items-center justify-center">
            <p className="text-xs text-emerald-500 font-medium">No pending orders ✓</p>
          </div>
        </div>

        {/* Card D: Discharge Workflow */}
        <div className={`bg-card rounded-lg border p-4 flex flex-col ${highlightDischarge ? 'border-amber-400 ring-2 ring-amber-200' : 'border-border'}`}>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-[13px] font-bold text-foreground">Discharge Workflow</span>
            {currentStep === -1 && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">Done</span>}
            <button
              onClick={handleWorkflowReset}
              disabled={savingStep === "reset"}
              title="Reset workflow — restart all clearances from beginning"
              className="ml-auto h-6 w-6 flex items-center justify-center rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 disabled:opacity-40 transition-colors"
            >
              {savingStep === "reset" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            </button>
          </div>

          {/* Live IPD Bill — always available during stay */}
          <Button
            size="sm"
            variant="outline"
            className="mb-3 h-7 text-[11px] gap-1 border-primary/40 text-primary hover:bg-primary/5"
            onClick={() => navigate(`/billing?action=new&admission_id=${admissionId}&type=ipd`)}
          >
            <Receipt className="h-3 w-3" /> View / Update IPD Bill
          </Button>

          {/* Stepper */}
          <div className="flex items-center gap-1 w-full mb-3">
            {allSteps.map((step, i) => {
              const StepIcon = roleToIcon(step.role);
              const isActive = i === currentStep;
              const color = roleToColor(step.role);
              return (
                <React.Fragment key={`${step.role}-${i}`}>
                  <div className="flex flex-col items-center">
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                      step.done ? 'border-emerald-500 bg-emerald-50' : isActive ? 'border-primary bg-primary/10' : 'border-muted'
                    }`}>
                      {step.done ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <StepIcon className={`h-3 w-3 ${isActive ? color : 'text-muted-foreground'}`} />
                      )}
                    </div>
                    <span className={`text-[9px] mt-1 text-center leading-tight ${step.done ? 'text-emerald-600 font-semibold' : isActive ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                      {step.name.split(" ")[0]}
                    </span>
                    {step.role === "Billing Executive" && !step.done && balanceDue > 0 && (
                      <span className="text-[8px] text-destructive font-bold mt-0.5">₹{balanceDue.toLocaleString("en-IN")} due</span>
                    )}
                  </div>
                  {i < allSteps.length - 1 && <div className={`flex-1 h-px mb-4 ${step.done ? 'bg-emerald-400' : 'bg-border'}`} />}
                </React.Fragment>
              );
            })}
          </div>

          {/* Discharge TAT Timer */}
          <DischargeTATTimer admissionId={admissionId} hospitalId={hospitalId} medicalCleared={medicalCleared} />

          {/* Action for current step */}
          <div className="flex-1 flex flex-col justify-end">
            {currentStep === -1 && (
              <p className="text-[11px] text-emerald-600 font-medium text-center">✅ Patient discharged</p>
            )}
            {currentStep >= 0 && (() => {
              const step = allSteps[currentStep];
              if (step.role === "_summary" && hospitalId) {
                return (
                  <>
                    <div className="mb-2">
                      <label className="text-[10px] text-muted-foreground uppercase font-semibold block mb-1">Discharge Type</label>
                      <select
                        value={dischargeType}
                        onChange={(e) => {
                          setDischargeType(e.target.value);
                          supabase.from("admissions").update({ discharge_type: e.target.value } as any).eq("id", admissionId);
                        }}
                        className="w-full h-7 text-xs border border-input rounded px-2 bg-background"
                      >
                        <option value="regular">Regular</option>
                        <option value="lama">LAMA (Against Medical Advice)</option>
                        <option value="expired">Expired</option>
                        <option value="transfer">Transfer</option>
                        <option value="daycare">Daycare</option>
                      </select>
                      {dischargeType === "lama" && (
                        <div className="mt-1 bg-amber-50 border border-amber-300 rounded px-2 py-1 text-[10px] text-amber-800 font-medium">
                          LAMA — document patient refusal. Billing clearance waived.
                        </div>
                      )}
                    </div>
                    {!billingCleared && dischargeType !== "lama" ? (
                      <div className="bg-destructive/10 border border-destructive/30 rounded p-2 text-center">
                        <p className="text-[11px] text-destructive font-medium">⚠ Billing not cleared. Clear billing before discharge summary.</p>
                      </div>
                    ) : checkingBilling || otBillingOk === null ? (
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground p-2">
                        <Loader2 className="h-3 w-3 animate-spin" /> Checking billing completeness…
                      </div>
                    ) : otBillingOk === false && !dischargeOverrideRecorded ? (
                      <div className="bg-destructive/10 border border-destructive/30 rounded p-3 space-y-2">
                        <p className="text-[11px] text-destructive font-medium">
                          ⚠ Unbilled OT/procedure charges found for this admission. Bill them in Billing, or document why discharge must proceed anyway.
                        </p>
                        {!showDischargeOverridePrompt ? (
                          <Button
                            size="sm" variant="outline"
                            className="h-7 text-[11px] w-full border-destructive/40 text-destructive hover:bg-destructive/10"
                            onClick={() => setShowDischargeOverridePrompt(true)}
                          >
                            Document Override Reason
                          </Button>
                        ) : (
                          <div className="space-y-2">
                            <Textarea
                              autoFocus
                              value={dischargeOverrideReason}
                              onChange={(e) => setDischargeOverrideReason(e.target.value)}
                              placeholder="Reason for discharging with unbilled OT charges (required, logged to audit trail)"
                              className="text-[11px] min-h-[60px]"
                            />
                            <div className="flex gap-2">
                              <Button size="sm" variant="ghost" className="h-7 text-[11px] flex-1" onClick={() => { setShowDischargeOverridePrompt(false); setDischargeOverrideReason(""); }}>
                                Cancel
                              </Button>
                              <Button size="sm" className="h-7 text-[11px] flex-1" disabled={submittingOverride} onClick={handleDischargeOverride}>
                                {submittingOverride ? "Recording…" : "Confirm Override"}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {hospitalId && (
                          <PreDischargeLeakageBanner
                            admissionId={admissionId}
                            hospitalId={hospitalId}
                          />
                        )}
                        <ReadmissionRiskPanel
                          admissionId={admissionId}
                          patientId={undefined}
                          hospitalId={hospitalId}
                        />
                        <DischargeSummaryAIPanel
                          admissionId={admissionId}
                          hospitalId={hospitalId || ""}
                        />
                        <DischargeSummaryGenerator
                          admissionId={admissionId}
                          hospitalId={hospitalId}
                          billingCleared={billingCleared}
                          dischargeType={dischargeType}
                          onSummaryDone={() => setDischargeSummaryDone(true)}
                        />
                      </div>
                    )}
                  </>
                );
              }
              if (step.role === "Doctor") {
                return (
                  <Button size="sm" className="text-[11px] h-7 w-full bg-blue-600 hover:bg-blue-700" onClick={handleMedicalClear} disabled={savingStep === "medical_cleared"}>
                    {savingStep === "medical_cleared" ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Stethoscope className="h-3 w-3 mr-1" />}
                    Mark Medical Clearance
                  </Button>
                );
              }
              if (step.role === "Billing Executive") {
                return (
                  <Button size="sm" variant="outline" className="text-[11px] h-7 w-full border-amber-300 text-amber-700 hover:bg-amber-50"
                    onClick={() => navigate(`/billing?action=new&admission_id=${admissionId}&type=ipd`)}>
                    <CreditCard className="h-3 w-3 mr-1" /> Finalise Billing →
                  </Button>
                );
              }
              if (step.role === "Pharmacist") {
                return (
                  <Button size="sm" className="text-[11px] h-7 w-full bg-violet-600 hover:bg-violet-700" onClick={handlePharmacyClear} disabled={savingStep === "pharmacy_cleared"}>
                    {savingStep === "pharmacy_cleared" ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Package className="h-3 w-3 mr-1" />}
                    Clear Pharmacy
                  </Button>
                );
              }
              const slug = toSlug(step.name);
              const StepIcon = roleToIcon(step.role);
              return (
                <Button size="sm" className="text-[11px] h-7 w-full bg-slate-700 hover:bg-slate-800" onClick={() => handleSmartClear(step.name, step.role)} disabled={savingStep === slug}>
                  {savingStep === slug ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <StepIcon className="h-3 w-3 mr-1" />}
                  Mark {step.name}
                </Button>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Medication Reconciliation — admission review + discharge verification */}
      {hospitalId && reconPatientId && reconUserId && (
        <MedReconciliationPanel
          admissionId={admissionId}
          patientId={reconPatientId}
          hospitalId={hospitalId}
          userId={reconUserId}
          eventType={medicalCleared ? "discharge" : "admission"}
        />
      )}

      {/* Discharge Instructions */}
      {hospitalId && patientName && (
        <DischargeInstructions
          hospitalId={hospitalId}
          patientName={patientName}
          patientPhone={patientPhone || null}
          diagnosis={admDiagnosis}
          medications={medications.map((m) => ({ drug_name: m.drug_name, dose: m.dose, frequency: m.frequency }))}
          followupDate={null}
          restrictions={null}
        />
      )}

      {/* ADR Detector — AI adverse drug reaction screening */}
      {hospitalId && (
        <ADRDetectorPanel admissionId={admissionId} hospitalId={hospitalId} />
      )}
    </div>
  );
};

const MiniVital = ({ label, value, unit }: { label: string; value: string | number; unit: string }) => (
  <div className="bg-muted rounded-md p-2">
    <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">{label}</p>
    <p className="text-lg font-bold text-foreground leading-tight">{value}</p>
    <p className="text-[10px] text-muted-foreground">{unit}</p>
  </div>
);

export default IPDOverviewTab;

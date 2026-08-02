import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { formatINRExact } from "@/lib/currency";
import { generateAdmissionNumber } from "@/lib/admissionNumber";
import { nextDocumentNumber } from "@/lib/documentNumber";
import { generatePatientUhid } from "@/lib/patient-records";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { AlertTriangle, Info } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { logAudit } from "@/lib/auditLog";
import { getErrorMessage } from "@/lib/errorMessage";
import { FormError } from "@/components/ui/FormError";
import { useConfigValues } from "@/hooks/useConfigValues";
import OutstandingBalanceBanner from "@/components/billing/OutstandingBalanceBanner";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { printAdmissionSlip } from "@/lib/admissionSlip";
import AdvanceReceiptModal from "@/components/billing/AdvanceReceiptModal";
import ConsentSignatureModal from "@/components/consent/ConsentSignatureModal";

interface Props {
  open: boolean;
  onClose: () => void;
  hospitalId: string | null;
  preselectedBedId?: string | null;
  preselectedWardId?: string | null;
  preselectedBedNumber?: string | null;
  preselectedPatientId?: string;
  preselectedPatientName?: string;
  onAdmitted: () => void;
  // Estimate-only mode: skip admission, just add estimate to an existing admission
  estimateOnlyMode?: boolean;
  existingAdmissionId?: string;
  existingPatient?: { id: string; full_name: string; uhid: string } | null;
  // Seed the estimate fields. Day care passes the booked procedure's standard_rate and
  // 1 day, so the counsellor confirms a number rather than recalling it — the deposit the
  // Admit gate checks against comes straight from here.
  prefillEstimatedAmount?: number;
  prefillDepositRequired?: number;
  prefillEstimatedDays?: number;
}

interface PatientResult {
  id: string;
  full_name: string;
  uhid: string;
  phone: string | null;
  dob: string | null;
  gender: string | null;
  blood_group: string | null;
  chronic_conditions: string[] | null;
  patient_category?: string | null;
}


const AdmitPatientModal: React.FC<Props> = ({
  open, onClose, hospitalId,
  preselectedBedId, preselectedWardId, preselectedBedNumber,
  preselectedPatientId, preselectedPatientName,
  onAdmitted,
  estimateOnlyMode = false,
  existingAdmissionId,
  existingPatient,
  prefillEstimatedAmount,
  prefillDepositRequired,
  prefillEstimatedDays,
}) => {
  const [step, setStep] = useState(estimateOnlyMode ? 3 : 1);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<PatientResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchedTerm, setSearchedTerm] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<PatientResult | null>(null);

  const admissionTypeOptions = useConfigValues("admission_types");
  const insuranceTypeOptions = useConfigValues("insurance_types");

  // Step 2 fields
  const [admissionType, setAdmissionType] = useState<string>("elective");
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [doctors, setDoctors] = useState<{ id: string; full_name: string; department_id: string | null }[]>([]);
  const [deptId, setDeptId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [insuranceType, setInsuranceType] = useState("self_pay");
  const [insuranceId, setInsuranceId] = useState("");
  const [expectedDischarge, setExpectedDischarge] = useState("");
  const [bedId, setBedId] = useState(preselectedBedId || "");
  const [wardId, setWardId] = useState(preselectedWardId || "");
  const [bedLabel, setBedLabel] = useState(preselectedBedNumber || "");

  // Wards + beds for selection
  const [availableBeds, setAvailableBeds] = useState<{ id: string; bed_number: string; ward_id: string; ward_name: string; bed_category?: string; oxygen_equipped?: boolean; has_monitor?: boolean }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [admittedId, setAdmittedId] = useState<string | null>(null);
  const [allergyVerified, setAllergyVerified] = useState(false);
  const [patientAllergies, setPatientAllergies] = useState<string | null>(null);
  const [handoverNotes, setHandoverNotes] = useState("");
  const [handoverPrefilled, setHandoverPrefilled] = useState(false);

  // MLC
  const [isMlcAdm, setIsMlcAdm] = useState(false);
  const [mlcPoliceStation, setMlcPoliceStation] = useState("");

  // Payer
  const [payerType, setPayerType] = useState("cash");
  const [payerId, setPayerId] = useState<string | null>(null);
  const [payerMasters, setPayerMasters] = useState<{ id: string; payer_name: string; payer_type: string }[]>([]);

  // Diet order
  const [dietaryInstruction, setDietaryInstruction] = useState("regular");

  // New patient fields
  const [showNewPatient, setShowNewPatient] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newAge, setNewAge] = useState("");
  const [newGender, setNewGender] = useState("male");

  // MUST Nutritional Screening (NABH AAC requirement)
  const [mustBmi, setMustBmi] = useState("");
  const [mustWeightLoss, setMustWeightLoss] = useState("");
  const [mustAcuteDisease, setMustAcuteDisease] = useState(false);
  const mustScore = (() => {
    let score = 0;
    const bmi = parseFloat(mustBmi);
    const wl = parseFloat(mustWeightLoss);
    if (!isNaN(bmi)) { if (bmi < 18.5) score += 2; else if (bmi < 20) score += 1; }
    if (!isNaN(wl)) { if (wl > 10) score += 2; else if (wl >= 5) score += 1; }
    if (mustAcuteDisease) score += 2;
    return score;
  })();
  const mustRisk = mustScore === 0 ? "Low" : mustScore === 1 ? "Medium" : "High";
  const mustRiskColor = mustScore === 0 ? "text-emerald-600" : mustScore === 1 ? "text-amber-600" : "text-red-600";

  // Step 3: Deposit & Estimate
  const [estimatedDays, setEstimatedDays] = useState(3);
  const [estimatedAmount, setEstimatedAmount] = useState("");
  const [depositRequired, setDepositRequired] = useState("");
  const [estimateRemarks, setEstimateRemarks] = useState("");
  const [packageId, setPackageId] = useState("");
  const [packages, setPackages] = useState<{ id: string; package_name: string; price: number }[]>([]);

  // Advance receipt auto-open after admission
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [estimateSaved, setEstimateSaved] = useState(false);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [consentSigned, setConsentSigned] = useState(false);


  useEffect(() => {
    if (preselectedBedId) { setBedId(preselectedBedId); setWardId(preselectedWardId || ""); setBedLabel(preselectedBedNumber || ""); }
  }, [preselectedBedId, preselectedWardId, preselectedBedNumber]);

  // Auto-select patient when coming from OPD
  useEffect(() => {
    if (!open || !preselectedPatientId || !hospitalId) return;
    supabase.from("patients")
      .select("id, full_name, uhid, phone, dob, gender, blood_group, chronic_conditions")
      .eq("id", preselectedPatientId)
      .eq("hospital_id", hospitalId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          const p = data as unknown as PatientResult;
          setSelectedPatient(p);
          const catToInsurance: Record<string, string> = { pmjay: "pmjay", cghs: "cghs", echs: "echs", esi: "insurance", insurance: "insurance" };
          if (p.patient_category && catToInsurance[p.patient_category]) setInsuranceType(catToInsurance[p.patient_category]);
          setStep(2);
        }
      });
  }, [open, preselectedPatientId, hospitalId]);

  const resetForm = useCallback(() => {
    setStep(estimateOnlyMode ? 3 : 1);
    setSearch(""); setResults([]); setSearching(false); setSearchedTerm(""); setSelectedPatient(null);
    setAdmissionType("elective"); setDeptId(""); setDoctorId(""); setDiagnosis("");
    setInsuranceType("self_pay"); setInsuranceId(""); setExpectedDischarge("");
    setShowNewPatient(false); setNewName(""); setNewPhone(""); setNewAge(""); setNewGender("male");
    setAllergyVerified(false); setPatientAllergies(null);
    setHandoverNotes(""); setHandoverPrefilled(false);
    setIsMlcAdm(false); setMlcPoliceStation("");
    setPayerType("cash"); setPayerId(null);
    setDietaryInstruction("regular");
    setAdmittedId(null);
    // Reset to the caller's seed where given (day care seeds the booked procedure's rate),
    // otherwise to the blank IPD defaults.
    setEstimatedDays(prefillEstimatedDays ?? 3);
    setEstimatedAmount(prefillEstimatedAmount != null ? String(prefillEstimatedAmount) : "");
    setDepositRequired(prefillDepositRequired != null ? String(prefillDepositRequired) : "");
    setEstimateRemarks(""); setPackageId("");
    setShowAdvanceModal(false); setEstimateSaved(false);
  }, [estimateOnlyMode, prefillDepositRequired, prefillEstimatedAmount, prefillEstimatedDays]);

  useEffect(() => {
    if (!open) { resetForm(); return; }
    if (!hospitalId) return;

    if (!estimateOnlyMode) {
      supabase.from("departments").select("id, name").eq("hospital_id", hospitalId).eq("is_active", true).order("name", { ascending: true })
        .then(({ data }) => setDepartments(data || []));
      supabase.from("users").select("id, full_name, department_id").eq("hospital_id", hospitalId).eq("role", "doctor").eq("is_active", true).order("full_name", { ascending: true })
        .then(({ data }) => setDoctors(data || []));

      if (!preselectedBedId) {
        (supabase as any).from("beds").select("id, bed_number, ward_id, bed_category, oxygen_equipped, has_monitor, ward:wards(name)")
          .eq("hospital_id", hospitalId).eq("status", "available").eq("is_active", true)
          .then(({ data }: any) => {
            setAvailableBeds((data || []).map((b: any) => ({
              id: b.id, bed_number: b.bed_number, ward_id: b.ward_id, ward_name: b.ward?.name || "—",
              bed_category: b.bed_category || "general", oxygen_equipped: b.oxygen_equipped, has_monitor: b.has_monitor,
            })));
          });
      }
    }

    // Fetch payer masters
    (supabase as any).from("payer_masters").select("id, payer_name, payer_type").eq("hospital_id", hospitalId).eq("is_active", true).order("payer_name")
      .then(({ data }: any) => setPayerMasters(data || []));

    // Fetch health packages for estimate step
    (supabase as any).from("health_packages").select("id, package_name, price")
      .eq("hospital_id", hospitalId).eq("is_active", true).order("package_name", { ascending: true })
      .then(({ data }: any) => setPackages(data || []));
  }, [resetForm, hospitalId, open, preselectedBedId, estimateOnlyMode]);

  // Fetch patient allergies when selected
  // Seed the estimate fields from the caller on open. resetForm() only runs on close, so a
  // first open would otherwise show blanks and the counsellor would have to retype the rate.
  useEffect(() => {
    if (!open) return;
    if (prefillEstimatedDays != null) setEstimatedDays(prefillEstimatedDays);
    if (prefillEstimatedAmount != null) setEstimatedAmount(String(prefillEstimatedAmount));
    if (prefillDepositRequired != null) setDepositRequired(String(prefillDepositRequired));
  }, [open, prefillEstimatedAmount, prefillDepositRequired, prefillEstimatedDays]);

  useEffect(() => {
    if (!selectedPatient) { setPatientAllergies(null); setAllergyVerified(false); return; }
    (supabase as any).from("patients").select("allergies").eq("id", selectedPatient.id).maybeSingle()
      .then(({ data }: any) => setPatientAllergies(data?.allergies || null));
  }, [selectedPatient]);

  // Pre-fill nursing handover notes from most recent OPD encounter
  useEffect(() => {
    if (!selectedPatient || !hospitalId) { setHandoverNotes(""); setHandoverPrefilled(false); return; }
    (supabase as any)
      .from("opd_encounters")
      .select("chief_complaint, diagnosis, icd10_code, soap_assessment, soap_plan, examination_notes, created_at")
      .eq("patient_id", selectedPatient.id)
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }: any) => {
        if (!data) { setHandoverNotes(""); setHandoverPrefilled(false); return; }
        const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
        const lines: string[] = [`Referred from OPD — ${today}`];
        if (data.chief_complaint) lines.push(`Chief Complaint: ${data.chief_complaint}`);
        if (data.diagnosis || data.icd10_code) lines.push(`Diagnosis: ${data.diagnosis || "—"}${data.icd10_code ? ` (${data.icd10_code})` : ""}`);
        if (data.soap_assessment) lines.push(`Assessment: ${data.soap_assessment}`);
        if (data.soap_plan) lines.push(`Plan: ${data.soap_plan}`);
        if (data.examination_notes) lines.push(`Examination: ${data.examination_notes}`);
        setHandoverNotes(lines.join("\n"));
        setHandoverPrefilled(true);
      });
  }, [selectedPatient, hospitalId]);

  // Search patients
  useEffect(() => {
    if (search.length < 2 || !hospitalId) { setResults([]); setSearching(false); setSearchedTerm(""); return; }
    setSearching(true);
    const t = setTimeout(() => {
      supabase.from("patients")
        .select("id, full_name, uhid, phone, dob, gender, blood_group, chronic_conditions")
        .eq("hospital_id", hospitalId)
        .eq("is_active", true)
        .or(`full_name.ilike.%${search}%,phone.ilike.%${search}%,uhid.ilike.%${search}%`)
        .limit(5)
        .then(({ data, error }) => {
          setResults(error ? [] : (data as unknown as PatientResult[]) || []);
          setSearchedTerm(search);
          setSearching(false);
        });
    }, 250);
    return () => { clearTimeout(t); setSearching(false); };
  }, [search, hospitalId]);

  const handleCreatePatient = async () => {
    if (!newName || !hospitalId) return;
    const dob = newAge ? new Date(Date.now() - parseInt(newAge) * 31557600000).toISOString().split("T")[0] : null;
    const uhid = await generatePatientUhid(hospitalId);
    const { data, error } = await supabase.from("patients").insert({
      hospital_id: hospitalId, full_name: newName, phone: newPhone || null, dob, gender: newGender as any, uhid,
    }).select().maybeSingle();
    if (error || !data) { toast({ title: "Error", description: error?.message || "Failed", variant: "destructive" }); return; }
    setSelectedPatient(data as unknown as PatientResult);
    setShowNewPatient(false);
    toast({ title: `Patient ${newName} registered` });
  };

  const saveEstimate = async (admissionId: string, patientId: string) => {
    if (!hospitalId || (!estimatedAmount && !depositRequired)) return;
    try {
      await (supabase as any).from("admission_estimates").insert({
        hospital_id: hospitalId,
        admission_id: admissionId,
        patient_id: patientId,
        estimated_days: estimatedDays,
        estimated_amount: Number(estimatedAmount) || 0,
        deposit_required: Number(depositRequired) || 0,
        package_id: packageId || null,
        remarks: estimateRemarks || null,
        is_estimate_given: true,
      });
    } catch (e: any) {
      console.error("Failed to save admission estimate:", e?.message || e);
    }
  };

  const handleAdmit = async () => {
    if (!selectedPatient || !doctorId || !bedId || !hospitalId) {
      toast({ title: "Missing fields", description: "Patient, doctor, and bed are required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    setFormError(null);
    // Real per-hospital daily sequence (IPD-20260717-0001). This was the last 4 digits of a
    // millisecond timestamp, so it never started at 1, could not be ordered or reconciled,
    // and two admissions in the same second could collide on it.
    let admNum: string;
    try {
      admNum = await generateAdmissionNumber(hospitalId, admissionType);
    } catch (e: any) {
      setFormError(e?.message || "Could not generate an admission number");
      setSubmitting(false);
      return;
    }

    // Same treatment for the MLC number, which was the last 4 digits of a millisecond
    // timestamp — two medico-legal admissions in the same 10-second window collided, and
    // the number bore no relation to the MLC series the Mortuary module maintains.
    let mlcNum: string | null = null;
    if (isMlcAdm) {
      try {
        mlcNum = await nextDocumentNumber(hospitalId, "mlc");
      } catch (e: any) {
        setFormError(e?.message || "Could not generate an MLC number");
        setSubmitting(false);
        return;
      }
    }

    const { error } = await supabase.from("admissions").insert({
      hospital_id: hospitalId,
      patient_id: selectedPatient.id,
      bed_id: bedId,
      ward_id: wardId,
      admission_number: admNum,
      admission_type: admissionType,
      admitting_doctor_id: doctorId,
      department_id: deptId || null,
      admitting_diagnosis: diagnosis || null,
      insurance_type: insuranceType,
      insurance_id: insuranceType !== "self_pay" ? insuranceId : null,
      expected_discharge_date: expectedDischarge || null,
      nursing_handover_notes: handoverNotes.trim() || null,
      is_mlc: isMlcAdm,
      mlc_number: mlcNum,
      police_station: isMlcAdm && mlcPoliceStation.trim() ? mlcPoliceStation.trim() : null,
      police_informed_at: isMlcAdm ? new Date().toISOString() : null,
      payer_type: payerType,
      payer_id: payerId || null,
      must_score: (mustBmi || mustWeightLoss || mustAcuteDisease) ? mustScore : null,
      must_bmi: mustBmi ? parseFloat(mustBmi) : null,
      must_weight_loss_pct: mustWeightLoss ? parseFloat(mustWeightLoss) : null,
      must_acute_disease: mustAcuteDisease || false,
      must_assessed_at: (mustBmi || mustWeightLoss) ? new Date().toISOString() : null,
    } as any);

    if (error) {
      const msg = getErrorMessage(error);
      setFormError(msg);
      toast({ title: "Admission failed", description: msg, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    await supabase.from("beds").update({ status: "occupied" as any }).eq("id", bedId);

    const { data: newAdm } = await supabase.from("admissions")
      .select("id")
      .eq("hospital_id", hospitalId)
      .eq("admission_number", admNum)
      .maybeSingle();

    if (newAdm) {
      if (dietaryInstruction) {
        (supabase as any).from("diet_orders").insert({
          hospital_id: hospitalId, patient_id: selectedPatient.id, admission_id: newAdm.id,
          diet_type: dietaryInstruction, ordered_by: doctorId || null,
          order_date: new Date().toISOString(), status: "active",
        }).then(() => {});
      }

      (supabase as any).from("medical_records").upsert({
        hospital_id: hospitalId, patient_id: selectedPatient.id, record_type: "ipd", visit_id: newAdm.id, status: "active",
      }, { onConflict: "hospital_id,patient_id,record_type,visit_id" }).then(() => {});

      (supabase as any).from("icd_codings").upsert({
        hospital_id: hospitalId, visit_type: "ipd", visit_id: newAdm.id, status: "pending",
      }, { onConflict: "hospital_id,visit_type,visit_id" }).then(() => {});

      // Auto-create a draft IPD bill
      try {
        const { data: existingIpdBill } = await supabase.from("bills")
          .select("id").eq("hospital_id", hospitalId).eq("admission_id", newAdm.id).eq("bill_type", "ipd").maybeSingle();
        if (!existingIpdBill) {
          const billNumber = await generateBillNumber(hospitalId, "BILL");
          await supabase.from("bills").insert({
            hospital_id: hospitalId, bill_number: billNumber, patient_id: selectedPatient.id,
            admission_id: newAdm.id, bill_type: "ipd", bill_status: "draft", payment_status: "unpaid",
          });
        }
      } catch (e: any) {
        console.error("Failed to auto-create draft IPD bill:", e?.message || e);
      }

      // Auto-create insurance pre-auth if applicable
      if (insuranceType !== "self_pay") {
        const isGovtScheme = ["pmjay", "cghs", "echs"].includes(insuranceType);
        if (isGovtScheme) {
          const { data: scheme } = await supabase.from("govt_schemes").select("id")
            .eq("hospital_id", hospitalId).ilike("scheme_code", `%${insuranceType}%`).maybeSingle();
          if (scheme) {
            await (supabase as any).from("pre_auth_requests").insert({
              hospital_id: hospitalId, patient_id: selectedPatient.id, admission_id: newAdm.id,
              scheme_id: scheme.id, package_code: "PENDING",
              package_name: `Pre-auth pending — ${diagnosis || "diagnosis pending"}`,
              requested_amount: 0, submission_method: "manual", status: "draft",
            });
            toast({ title: "Govt scheme pre-auth created", description: "Visit /pmjay to complete" });
          }
        } else {
          let estimatedAmount = 0;
          if (diagnosis) {
            try {
              const { data: svcMatch } = await (supabase as any).from("service_master").select("fee")
                .eq("hospital_id", hospitalId).ilike("name", `%${diagnosis.split(" ").slice(0, 2).join("%")}%`).limit(1).maybeSingle();
              if (svcMatch?.fee) estimatedAmount = Number(svcMatch.fee);
            } catch { /* best-effort fee lookup — fall through with estimatedAmount 0 */ }
          }
          await (supabase as any).from("insurance_pre_auth").insert({
            hospital_id: hospitalId, patient_id: selectedPatient.id, admission_id: newAdm.id,
            insurance_id: insuranceId || null, status: "draft", insurance_type: insuranceType, estimated_amount: estimatedAmount,
          });
          toast({ title: "Insurance pre-auth created", description: `Est. ${formatINRExact(estimatedAmount)} · Visit /insurance to complete` });
        }
      }

      // Save deposit & estimate
      await saveEstimate(newAdm.id, selectedPatient.id);
    }

    setSubmitting(false);
    logAudit({ action: "created", module: "ipd", entityType: "admission", entityId: newAdm?.id, details: { patient: selectedPatient.full_name, bed: bedLabel } });
    toast({ title: `${selectedPatient.full_name} admitted`, description: `Bed ${bedLabel} · ${admNum}` });
    setAdmittedId(newAdm?.id || null);

    if (Number(depositRequired) > 0) {
      setShowAdvanceModal(true);
    }

    onAdmitted();
  };

  // Estimate-only submit (for existing admissions)
  const handleEstimateOnlySubmit = async () => {
    if (!existingAdmissionId || !hospitalId) return;
    setSubmitting(true);
    try {
      const patientId = existingPatient?.id;
      await (supabase as any).from("admission_estimates").insert({
        hospital_id: hospitalId,
        admission_id: existingAdmissionId,
        patient_id: patientId || null,
        estimated_days: estimatedDays,
        estimated_amount: Number(estimatedAmount) || 0,
        deposit_required: Number(depositRequired) || 0,
        package_id: packageId || null,
        remarks: estimateRemarks || null,
        is_estimate_given: true,
      });
      toast({ title: "Estimate saved", description: `${formatINRExact(Number(estimatedAmount))} estimated · ${formatINRExact(Number(depositRequired))} deposit` });
      setEstimateSaved(true);
      if (Number(depositRequired) > 0) setShowAdvanceModal(true);
      else { onAdmitted(); onClose(); }
    } catch (e: any) {
      toast({ title: "Failed to save estimate", description: e?.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const activePatient = estimateOnlyMode ? existingPatient : selectedPatient;
  const totalSteps = estimateOnlyMode ? 1 : 4;

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="max-w-[520px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg">{estimateOnlyMode ? "Estimate & Deposit" : "New Admission"}</DialogTitle>
            {!admittedId && !estimateSaved && (
              <div className="flex gap-1 mt-2">
                {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => (
                  <div key={s} className={cn("h-1.5 flex-1 rounded-full",
                    estimateOnlyMode ? "bg-[#1A2F5A]" : (step >= s ? "bg-[#1A2F5A]" : "bg-slate-200")
                  )} />
                ))}
              </div>
            )}
          </DialogHeader>

          {/* SUCCESS STATE — full admission */}
          {admittedId && hospitalId && !showAdvanceModal && (
            <div className="text-center py-6 space-y-4">
              <p className="text-2xl">✅</p>
              <p className="text-sm font-semibold text-emerald-600">{selectedPatient?.full_name || "Patient"} successfully admitted</p>
              <div className="flex flex-col items-center gap-2">
                {!consentSigned ? (
                  <Button
                    size="sm"
                    className="gap-1.5 w-full max-w-xs"
                    onClick={() => setShowConsentModal(true)}
                  >
                    📋 Get Consent Signed (Recommended)
                  </Button>
                ) : (
                  <p className="text-[12px] text-green-600 font-medium">✓ Consent forms signed</p>
                )}
                <div className="flex gap-2 justify-center">
                  <Button size="sm" variant="outline" onClick={() => printAdmissionSlip(admittedId, hospitalId)}>
                    🖨️ Print Admission Slip
                  </Button>
                  <Button size="sm" onClick={() => { resetForm(); onClose(); }}>Close</Button>
                </div>
              </div>
            </div>
          )}

          {/* SUCCESS STATE — estimate-only */}
          {estimateSaved && !showAdvanceModal && (
            <div className="text-center py-6 space-y-4">
              <p className="text-2xl">✅</p>
              <p className="text-sm font-semibold text-emerald-600">Estimate saved for {existingPatient?.full_name || "patient"}</p>
              <Button size="sm" onClick={() => { onAdmitted(); onClose(); }}>Close</Button>
            </div>
          )}

          {/* STEP 1 — Patient */}
          {!admittedId && !estimateSaved && step === 1 && (
            <div className="space-y-3 mt-2">
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, phone, or UHID..." className="h-10" />

              {searching && <p className="text-xs text-slate-400 animate-pulse">Searching...</p>}

              {!searching && results.length > 0 && (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  {results.map((p) => (
                    <button key={p.id} onClick={() => {
                      setSelectedPatient(p); setResults([]); setSearch(p.full_name);
                      const catToInsurance: Record<string, string> = { pmjay: "pmjay", cghs: "cghs", echs: "echs", esi: "insurance", insurance: "insurance" };
                      if (p.patient_category && catToInsurance[p.patient_category]) setInsuranceType(catToInsurance[p.patient_category]);
                    }}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-0 flex justify-between items-center">
                      <div>
                        <p className="text-sm font-medium text-slate-900">{p.full_name}</p>
                        <p className="text-[11px] text-slate-500">{p.uhid} · {p.phone || "No phone"}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {!searching && searchedTerm.length >= 2 && results.length === 0 && !selectedPatient && (
                <p className="text-xs text-slate-500">No patients found for &ldquo;<strong>{searchedTerm}</strong>&rdquo;</p>
              )}

              {selectedPatient && (
                <div className="space-y-2">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                    <p className="text-xs text-emerald-700 font-medium mb-1">✓ Patient selected</p>
                    <p className="text-sm font-bold text-slate-900">{selectedPatient.full_name}</p>
                    <p className="text-[11px] text-slate-600">{selectedPatient.uhid} · {selectedPatient.gender} · {selectedPatient.blood_group || "—"}</p>
                  </div>
                  <OutstandingBalanceBanner patientId={selectedPatient.id} hospitalId={hospitalId} />
                </div>
              )}

              {!showNewPatient && !selectedPatient && searchedTerm.length >= 2 && (
                <button onClick={() => setShowNewPatient(true)} className="text-xs text-blue-600 hover:underline">
                  Not found? Register new patient →
                </button>
              )}

              {showNewPatient && (
                <div className="border border-slate-200 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-bold text-slate-600">New Patient</p>
                  <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full Name *" className="h-9 text-sm" />
                  <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Phone" className="h-9 text-sm" type="tel" />
                  <div className="flex gap-2">
                    <Input value={newAge} onChange={(e) => setNewAge(e.target.value)} placeholder="Age" className="h-9 text-sm w-20" type="number" />
                    <div className="flex gap-1 flex-1">
                      {(["male", "female", "other"] as const).map((g) => (
                        <button key={g} onClick={() => setNewGender(g)}
                          className={cn("flex-1 h-9 rounded-md text-xs font-medium border transition-colors capitalize",
                            newGender === g ? "bg-[#1A2F5A] text-white border-[#1A2F5A]" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                          )}>{g}</button>
                      ))}
                    </div>
                  </div>
                  <Button size="sm" onClick={handleCreatePatient} disabled={!newName} className="w-full h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                    Register Patient
                  </Button>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <Button onClick={() => setStep(2)} disabled={!selectedPatient} className="bg-[#1A2F5A] hover:bg-[#152647]">
                  Next →
                </Button>
              </div>
            </div>
          )}

          {/* STEP 2 — Admission Details */}
          {!admittedId && !estimateSaved && step === 2 && (
            <div className="space-y-3 mt-2">
              <div>
                <label className="text-xs font-bold text-slate-600 uppercase tracking-wider block mb-1">Admission Type</label>
                <div className="flex gap-1.5">
                  {admissionTypeOptions.map((opt) => (
                    <button key={opt.value} onClick={() => setAdmissionType(opt.value)}
                      className={cn("flex-1 h-9 rounded-md text-xs font-medium border transition-colors",
                        admissionType === opt.value ? "bg-[#1A2F5A] text-white border-[#1A2F5A]" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      )}>{opt.label}</button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">Department</label>
                  <select value={deptId} onChange={(e) => { setDeptId(e.target.value); if (e.target.value && doctors.find(d => d.id === doctorId)?.department_id !== e.target.value) setDoctorId(""); }} className="w-full h-9 text-sm border rounded-md px-2 bg-white">
                    <option value="">Select...</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">Admitting Doctor *</label>
                  <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className="w-full h-9 text-sm border rounded-md px-2 bg-white">
                    <option value="">{deptId ? "Select doctor..." : "Select department first"}</option>
                    {(deptId ? doctors.filter(d => d.department_id === deptId) : doctors).map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                  </select>
                  {doctors.length === 0 && (
                    <Link to="/settings/staff" className="text-[10px] text-amber-600 hover:underline mt-0.5 block">No doctors — add in Settings →</Link>
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">Primary Diagnosis</label>
                <Input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="Admitting diagnosis..." className="h-9 text-sm" />
              </div>

              {preselectedBedId ? (
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">Bed</label>
                  <span className="text-sm bg-blue-50 text-blue-700 px-2 py-1 rounded">{bedLabel}</span>
                </div>
              ) : (
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">Select Bed *</label>
                  <select value={bedId} onChange={(e) => {
                    setBedId(e.target.value);
                    const b = availableBeds.find((x) => x.id === e.target.value);
                    if (b) { setWardId(b.ward_id); setBedLabel(`${b.ward_name} - ${b.bed_number}`); }
                  }} className="w-full h-9 text-sm border rounded-md px-2 bg-white">
                    <option value="">Select available bed...</option>
                    {availableBeds.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.ward_name} — {b.bed_number}
                        {b.bed_category && b.bed_category !== "general" ? ` [${b.bed_category.toUpperCase()}]` : ""}
                        {b.oxygen_equipped ? " O₂" : ""}
                        {b.has_monitor ? " Mon" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">Insurance</label>
                <div className="flex gap-1 flex-wrap">
                  {insuranceTypeOptions.map((opt) => (
                    <button key={opt.value} onClick={() => setInsuranceType(opt.value)}
                      className={cn("h-8 px-3 rounded-md text-[11px] font-medium border transition-colors",
                        insuranceType === opt.value ? "bg-[#1A2F5A] text-white border-[#1A2F5A]" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      )}>{opt.label}</button>
                  ))}
                </div>
                {insuranceType !== "self_pay" && (
                  <Input value={insuranceId} onChange={(e) => setInsuranceId(e.target.value)}
                    placeholder={insuranceType === "pmjay" ? "PMJAY Card Number" : "Insurance ID"}
                    className="h-9 text-sm mt-2" />
                )}
              </div>

              {/* Payer Type for Billing / Tariff */}
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">Billing Payer</label>
                <div className="flex gap-2">
                  <select value={payerType} onChange={(e) => { setPayerType(e.target.value); setPayerId(null); }}
                    className="flex-1 h-9 px-2 border border-slate-200 rounded-lg text-xs outline-none bg-white">
                    <option value="cash">Cash</option>
                    <option value="credit">Credit / Deferred</option>
                    <option value="corporate">Corporate</option>
                    <option value="tpa">TPA / Insurance</option>
                    <option value="pmjay">PMJAY / Ayushman</option>
                    <option value="cghs">CGHS</option>
                    <option value="esi">ESI</option>
                    <option value="state_scheme">State Scheme</option>
                    <option value="other">Other</option>
                  </select>
                  {payerType !== "cash" && (
                    <select value={payerId || ""} onChange={(e) => setPayerId(e.target.value || null)}
                      className="flex-1 h-9 px-2 border border-slate-200 rounded-lg text-xs outline-none bg-white">
                      <option value="">Select payer…</option>
                      {payerMasters.filter((pm) => pm.payer_type === payerType).map((pm) => (
                        <option key={pm.id} value={pm.id}>{pm.payer_name}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {selectedPatient && (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">Allergy Verification (Mandatory)</span>
                  </div>
                  <p className="text-sm font-medium text-amber-900 mb-2">
                    {patientAllergies && patientAllergies !== "NKDA"
                      ? patientAllergies
                      : patientAllergies === "NKDA"
                      ? "NKDA — No Known Drug Allergies"
                      : "⚠️ No allergies recorded — please ask patient"}
                  </p>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={allergyVerified} onChange={(e) => setAllergyVerified(e.target.checked)}
                      className="rounded border-amber-400 accent-amber-600" />
                    <span className="text-xs text-amber-800">I have verified the patient's allergy status with the patient/attendant</span>
                  </label>
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">Handover Notes for Nursing</label>
                {handoverPrefilled && (
                  <div className="flex items-start gap-2 p-2 mb-1.5 rounded-md bg-sky-50 border border-sky-200">
                    <Info className="h-3.5 w-3.5 text-sky-600 mt-0.5 flex-shrink-0" />
                    <span className="text-[11px] text-sky-800 leading-snug">Pre-filled from OPD consultation — please review and update</span>
                  </div>
                )}
                <Textarea value={handoverNotes} onChange={(e) => setHandoverNotes(e.target.value)}
                  placeholder="Clinical handover information for the nursing team..."
                  className="text-sm min-h-[110px]" />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">Expected Discharge (optional)</label>
                <Input type="date" value={expectedDischarge} onChange={(e) => setExpectedDischarge(e.target.value)}
                  min={new Date().toISOString().split("T")[0]} className="h-9 text-sm w-48" />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">Dietary Instruction</label>
                <select value={dietaryInstruction} onChange={e => setDietaryInstruction(e.target.value)}
                  className="w-full h-9 text-sm border rounded-md px-2 bg-white">
                  <option value="regular">Regular</option>
                  <option value="soft">Soft</option>
                  <option value="liquid">Liquid</option>
                  <option value="semi_liquid">Semi-Liquid</option>
                  <option value="npo">NPO (Nil Per Oral)</option>
                  <option value="diabetic">Diabetic</option>
                  <option value="low_sodium">Low-Sodium</option>
                  <option value="high_protein">High-Protein</option>
                  <option value="renal">Renal</option>
                </select>
              </div>

              <div className="flex items-start gap-3">
                <label className="flex items-center gap-2 cursor-pointer mt-1">
                  <input type="checkbox" checked={isMlcAdm} onChange={e => setIsMlcAdm(e.target.checked)}
                    className="rounded border-slate-300 accent-red-600" />
                  <span className="text-xs font-bold text-slate-600">Medico-Legal Case (MLC)</span>
                </label>
                {isMlcAdm && (
                  <Input value={mlcPoliceStation} onChange={e => setMlcPoliceStation(e.target.value)}
                    placeholder="Police station name" className="flex-1 h-8 text-xs border-red-300 focus:border-red-500" />
                )}
              </div>
              {isMlcAdm && (
                <div className="flex items-start gap-2 p-2 bg-red-50 border border-red-200 rounded-lg">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-600 mt-0.5 shrink-0" />
                  <p className="text-[11px] text-red-700">MLC — Notify police within 24 hours. MLC number will be auto-generated. Maintain medico-legal register.</p>
                </div>
              )}

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setStep(1)}>← Back</Button>
                <Button onClick={() => setStep(3)} disabled={!doctorId || !bedId || !allergyVerified} className="bg-[#1A2F5A] hover:bg-[#152647]">Next →</Button>
              </div>
            </div>
          )}

          {/* STEP 3 — Deposit & Estimate */}
          {!admittedId && !estimateSaved && step === 3 && (
            <div className="space-y-3 mt-2">
              {estimateOnlyMode && existingPatient && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-xs text-blue-700 font-medium mb-0.5">Recording estimate for</p>
                  <p className="text-sm font-bold text-slate-900">{existingPatient.full_name}</p>
                  <p className="text-[11px] text-slate-500">{existingPatient.uhid}</p>
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">Estimated Stay (Days)</label>
                <div className="flex items-center gap-2">
                  <button onClick={() => setEstimatedDays(d => Math.max(1, d - 1))}
                    className="w-8 h-8 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold">−</button>
                  <span className="text-base font-bold w-8 text-center">{estimatedDays}</span>
                  <button onClick={() => setEstimatedDays(d => d + 1)}
                    className="w-8 h-8 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold">+</button>
                  <span className="text-xs text-slate-500 ml-1">days</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">Estimated Amount (₹)</label>
                  <Input type="number" value={estimatedAmount} onChange={(e) => setEstimatedAmount(e.target.value)}
                    placeholder="0.00" className="h-9 text-sm" min="0" step="100" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">Deposit Required (₹)</label>
                  <Input type="number" value={depositRequired} onChange={(e) => setDepositRequired(e.target.value)}
                    placeholder="0.00" className="h-9 text-sm" min="0" step="100" />
                </div>
              </div>

              {packages.length > 0 && (
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">Package (optional)</label>
                  <select value={packageId} onChange={(e) => {
                    setPackageId(e.target.value);
                    const pkg = packages.find(p => p.id === e.target.value);
                    if (pkg && !estimatedAmount) setEstimatedAmount(String(pkg.price));
                  }} className="w-full h-9 text-sm border rounded-md px-2 bg-white">
                    <option value="">No package</option>
                    {packages.map((p) => (
                      <option key={p.id} value={p.id}>{p.package_name} — ₹{Number(p.price).toLocaleString("en-IN")}</option>
                    ))}
                  </select>
                  {packageId && (
                    <p className="text-[10px] text-slate-500 mt-0.5">Selecting a package pre-fills the estimated amount.</p>
                  )}
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">Remarks (optional)</label>
                <Textarea value={estimateRemarks} onChange={(e) => setEstimateRemarks(e.target.value)}
                  placeholder="e.g. Estimate includes surgery, anaesthesia, and 3-day stay..." className="text-sm min-h-[80px]" />
              </div>

              {Number(depositRequired) > 0 && (
                <div className="flex items-start gap-2 p-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <Info className="h-3.5 w-3.5 text-emerald-600 mt-0.5 shrink-0" />
                  <p className="text-[11px] text-emerald-700">
                    After saving, the Advance Receipt form will open pre-filled with <strong>₹{Number(depositRequired).toLocaleString("en-IN")}</strong> to collect deposit.
                  </p>
                </div>
              )}

              {/* MUST Nutritional Screening — NABH AAC requirement */}
              {!estimateOnlyMode && (
                <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">Nutritional Screening (MUST)</span>
                    <span className="text-[10px] bg-blue-100 text-blue-700 border border-blue-200 rounded px-1.5 py-px font-medium">NABH AAC</span>
                    {(mustBmi || mustWeightLoss || mustAcuteDisease) && (
                      <span className={`text-[11px] font-bold ml-auto ${mustRiskColor}`}>
                        Score: {mustScore} — {mustRisk} Risk
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[11px] text-muted-foreground block mb-1">BMI (kg/m²)</label>
                      <input type="number" step="0.1" min="10" max="60" value={mustBmi}
                        onChange={e => setMustBmi(e.target.value)}
                        placeholder="e.g. 21.5"
                        className="w-full h-7 text-xs border border-input rounded px-2 bg-background" />
                      <p className="text-[9px] text-muted-foreground mt-0.5">0pts ≥20, 1pt 18.5–20, 2pts &lt;18.5</p>
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground block mb-1">Recent Weight Loss (%)</label>
                      <input type="number" step="0.1" min="0" max="50" value={mustWeightLoss}
                        onChange={e => setMustWeightLoss(e.target.value)}
                        placeholder="e.g. 7"
                        className="w-full h-7 text-xs border border-input rounded px-2 bg-background" />
                      <p className="text-[9px] text-muted-foreground mt-0.5">0pts &lt;5%, 1pt 5–10%, 2pts &gt;10%</p>
                    </div>
                    <div className="flex items-center gap-2 pt-4">
                      <input type="checkbox" id="must_acute" checked={mustAcuteDisease}
                        onChange={e => setMustAcuteDisease(e.target.checked)} className="h-4 w-4" />
                      <label htmlFor="must_acute" className="text-xs">Acute illness / nil by mouth ≥5 days (+2 pts)</label>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-between pt-2">
                {estimateOnlyMode ? (
                  <>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleEstimateOnlySubmit} disabled={submitting || (!estimatedAmount && !depositRequired)}
                      className="bg-[#1A2F5A] hover:bg-[#152647]">
                      {submitting ? "Saving..." : "Save Estimate"}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" onClick={() => setStep(2)}>← Back</Button>
                    <Button onClick={() => setStep(4)} className="bg-[#1A2F5A] hover:bg-[#152647]">Next →</Button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* STEP 4 — Confirm */}
          {!admittedId && !estimateSaved && step === 4 && (
            <div className="space-y-3 mt-2">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2">
                <p className="text-sm font-bold text-slate-900">{selectedPatient?.full_name}</p>
                <p className="text-xs text-slate-500">{selectedPatient?.uhid}</p>
                <div className="h-px bg-slate-200 my-2" />
                <Row label="Type" value={admissionType} />
                <Row label="Bed" value={bedLabel} />
                <Row label="Doctor" value={doctors.find((d) => d.id === doctorId)?.full_name || "—"} />
                <Row label="Diagnosis" value={diagnosis || "—"} />
                <Row label="Insurance" value={insuranceType.replace("_", " ")} />
                <Row label="Diet" value={dietaryInstruction.replace(/_/g, " ")} />
                {expectedDischarge && <Row label="Expected Discharge" value={expectedDischarge} />}
                {estimatedAmount && <Row label="Estimated Amount" value={`${formatINRExact(Number(estimatedAmount))}`} />}
                {depositRequired && <Row label="Deposit Required" value={`${formatINRExact(Number(depositRequired))}`} />}
                {(mustBmi || mustWeightLoss || mustAcuteDisease) && (
                  <Row label="MUST Nutritional Risk"
                    value={`Score ${mustScore} — ${mustRisk} Risk`} />
                )}
              </div>

              <FormError message={formError} className="mt-2" />

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setStep(3)}>← Back</Button>
                <Button onClick={handleAdmit} disabled={submitting} className="bg-[#1A2F5A] hover:bg-[#152647] w-40">
                  {submitting ? "Admitting..." : "✓ Confirm Admission"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Auto-open Advance Receipt after admission/estimate if deposit required */}
      {showAdvanceModal && hospitalId && activePatient && (
        <AdvanceReceiptModal
          hospitalId={hospitalId}
          prefilledPatient={{ id: activePatient.id, full_name: activePatient.full_name, uhid: activePatient.uhid }}
          prefilledAmount={Number(depositRequired) || undefined}
          admissionId={admittedId || existingAdmissionId || null}
          onClose={() => {
            setShowAdvanceModal(false);
            if (estimateOnlyMode && estimateSaved) { onAdmitted(); onClose(); }
          }}
          onCreated={() => {
            setShowAdvanceModal(false);
            toast({ title: "Deposit collected", description: `${formatINRExact(Number(depositRequired))} advance receipt created` });
            if (estimateOnlyMode && estimateSaved) { onAdmitted(); onClose(); }
          }}
        />
      )}

      {/* Consent signature modal — triggered from admission success state */}
      {showConsentModal && admittedId && selectedPatient && hospitalId && (
        <ConsentSignatureModal
          open={showConsentModal}
          onClose={() => setShowConsentModal(false)}
          admissionId={admittedId}
          patientId={selectedPatient.id}
          patientName={selectedPatient.full_name}
          hospitalId={hospitalId}
          onAllSigned={() => {
            setShowConsentModal(false);
            setConsentSigned(true);
          }}
        />
      )}
    </>
  );
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between text-xs">
    <span className="text-slate-500">{label}</span>
    <span className="text-slate-800 font-medium capitalize">{value}</span>
  </div>
);

export default AdmitPatientModal;

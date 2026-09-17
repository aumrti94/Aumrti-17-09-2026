import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { X, UserPlus, Loader2, CheckCircle2, XCircle, AlertTriangle, CreditCard, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/errorMessage";
import { FormError } from "@/components/ui/FormError";
import ABHASearchPanel from "@/components/patients/ABHASearchPanel";
import { generatePatientUhid } from "@/lib/patient-records";
import { getDPDPConsentText } from "@/lib/compliance-checks";
import AddReferralDoctorModal from "@/components/shared/AddReferralDoctorModal";
import { getRegistrationFee, createAndPayRegistrationBill } from "@/lib/registrationBill";
import { printDocument, printHeader } from "@/lib/printUtils";

interface Props {
  onClose: () => void;
  onSuccess: () => void;
  editPatient?: {
    id: string;
    full_name: string;
    phone: string | null;
    gender: string | null;
    dob: string | null;
    blood_group: string | null;
    address: string | null;
    allergies: string | null;
    chronic_conditions: string[] | null;
    insurance_id: string | null;
    abha_id: string | null;
    emergency_contact_name: string | null;
    emergency_contact_phone: string | null;
  };
}

const bloodGroups = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const genders = ["male", "female", "other"] as const;
const PAYMENT_MODES = [
  { value: "cash", label: "💵 Cash" },
  { value: "upi", label: "📱 UPI" },
  { value: "card", label: "💳 Card" },
];

const PatientRegistrationModal: React.FC<Props> = ({ onClose, onSuccess, editPatient }) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [showReferralModal, setShowReferralModal] = useState(false);
  const [referralDoctorId, setReferralDoctorId] = useState<string | null>(null);
  const [dpdpConsent, setDpdpConsent] = useState(!!editPatient);
  const [hospitalName, setHospitalName] = useState("Hospital");
  const [hospitalIdState, setHospitalIdState] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // Optional registration-fee flow (only reached when a `registration_fee` rate > 0
  // is configured in Settings → Default Rates). Patient is saved before this step.
  const [step, setStep] = useState<"details" | "payment" | "receipt">("details");
  const [submitting, setSubmitting] = useState(false);
  const [regFee, setRegFee] = useState(0);
  const [regGst, setRegGst] = useState(0);
  const [paymentMode, setPaymentMode] = useState("cash");
  const [paymentRef, setPaymentRef] = useState("");
  const [newPatientId, setNewPatientId] = useState("");
  const [newUhid, setNewUhid] = useState("");
  const [collectedById, setCollectedById] = useState<string | null>(null);
  const [receiptInfo, setReceiptInfo] = useState<{ billNumber: string; date: string } | null>(null);
  const [abhaVerified, setAbhaVerified] = useState<boolean>(false);
  const [abhaVerifying, setAbhaVerifying] = useState(false);
  const [abhaStatus, setAbhaStatus] = useState<{
    state: "idle" | "verified" | "invalid" | "sandbox";
    message?: string;
  }>({ state: "idle" });
  const [form, setForm] = useState({
    full_name: editPatient?.full_name || "",
    phone: editPatient?.phone || "",
    age: "",
    gender: (editPatient?.gender || "") as string,
    dob: editPatient?.dob || "",
    blood_group: editPatient?.blood_group || "",
    address: editPatient?.address || "",
    allergies: editPatient?.allergies || "",
    chronic_conditions: editPatient?.chronic_conditions?.join(", ") || "",
    insurance_id: editPatient?.insurance_id || "",
    abha_id: editPatient?.abha_id || "",
    aadhaar_id: (editPatient as any)?.aadhaar_id || "",
    patient_gstin: (editPatient as any)?.patient_gstin || "",
    emergency_contact_name: editPatient?.emergency_contact_name || "",
    emergency_contact_phone: editPatient?.emergency_contact_phone || "",
    referral_source: "",
    patient_category: "general",
  });

  useEffect(() => {
    const fetchHospital = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle();
      if (data?.hospital_id) {
        setHospitalIdState(data.hospital_id);
        const { data: h } = await supabase.from("hospitals").select("name").eq("id", data.hospital_id).maybeSingle();
        if (h?.name) setHospitalName(h.name);
      }
    };
    fetchHospital();
  }, []);

  const set = (field: string, value: string) => setForm((f) => ({ ...f, [field]: value }));

  // KNOWN-BUG-123. The only sanctioned write path for Aadhaar — never a direct
  // supabase.from("patients") call, which is how this screen ended up writing every digit in
  // plaintext to patients.aadhaar_id. Called AFTER the base patient row exists (this function
  // only ever UPDATEs; see upsert-patient-phi/index.ts's own comment on that), for both the
  // create and edit flows. Best-effort: the patient record itself is already saved by the time
  // this runs, so a failure here is surfaced but does not roll back registration.
  const encryptAadhaarIfProvided = async (hospitalId: string, patientId: string) => {
    const digits = form.aadhaar_id.replace(/\D/g, "");
    if (digits.length !== 12) return;
    const { error } = await supabase.functions.invoke("upsert-patient-phi", {
      body: {
        operation: "encrypt_and_write",
        hospitalId,
        patientId,
        fields: { aadhaar: digits },
      },
    });
    if (error) {
      toast({
        title: "Aadhaar not saved",
        description: "Patient details were saved, but the Aadhaar number could not be encrypted. Please re-enter it from the patient's detail page.",
        variant: "destructive",
      });
    }
  };

  const handleSubmit = async () => {
    const errors: Record<string, string> = {};
    if (!form.full_name.trim() || form.full_name.trim().length < 2) {
      errors.full_name = "Name must be at least 2 characters";
    }
    if (form.phone && !/^\d{10}$/.test(form.phone.replace(/\s/g, ""))) {
      errors.phone = "Phone must be exactly 10 digits";
    }
    if (form.dob) {
      const dobDate = new Date(form.dob);
      if (dobDate >= new Date()) errors.dob = "Date of birth must be in the past";
    }
    if (!dpdpConsent) {
      errors.dpdp = "Patient must consent to data collection";
    }
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) {
      toast({ title: "Please fix the highlighted errors", variant: "destructive" });
      return;
    }
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast({ title: "Not authenticated", variant: "destructive" }); setSaving(false); return; }
    const { data: userData } = await supabase.from("users").select("id, hospital_id").eq("auth_user_id", user.id).maybeSingle();
    if (!userData) {
      toast({ title: "Could not determine hospital", variant: "destructive" });
      setSaving(false);
      return;
    }
    const hospitalId = userData.hospital_id;
    const collectedUserId = (userData as any).id as string;

    let dob = form.dob || null;
    if (!dob && form.age) {
      const d = new Date();
      d.setFullYear(d.getFullYear() - parseInt(form.age));
      dob = d.toISOString().slice(0, 10);
    }

    const chronic = form.chronic_conditions
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const patientFields = {
      full_name: form.full_name.trim(),
      phone: form.phone || null,
      gender: (form.gender as "male" | "female" | "other") || null,
      dob,
      blood_group: form.blood_group || null,
      address: form.address || null,
      allergies: form.allergies || null,
      chronic_conditions: chronic.length ? chronic : null,
      insurance_id: form.insurance_id || null,
      abha_id: form.abha_id || null,
      // Aadhaar is deliberately NOT in this direct-write payload — KNOWN-BUG-123. This screen
      // used to write it here in plaintext to patients.aadhaar_id, bypassing
      // upsert-patient-phi, this codebase's own documented "ONLY write path for encrypted PHI
      // columns". Encrypted separately below, after the base row exists, via that function's
      // encrypt_and_write operation — the same invariant ImportWizard.tsx already documents
      // and enforces for the bulk-import path.
      patient_gstin: form.patient_gstin ? form.patient_gstin.trim().toUpperCase() : null,
      abha_verified: !!form.abha_id && abhaVerified,
      abha_verified_at: !!form.abha_id && abhaVerified ? new Date().toISOString() : null,
      emergency_contact_name: form.emergency_contact_name || null,
      emergency_contact_phone: form.emergency_contact_phone || null,
      patient_category: form.patient_category || "general",
    };

    if (editPatient) {
      // UPDATE existing patient
      const { error } = await supabase.from("patients").update(patientFields as any).eq("id", editPatient.id);
      if (error) {
        setSaving(false);
        const msg = getErrorMessage(error);
        setFormError(msg);
        toast({ title: "Update failed", description: msg, variant: "destructive" });
        return;
      }
      await encryptAadhaarIfProvided(hospitalId, editPatient.id);
      setSaving(false);
      toast({ title: "Patient details updated" });
      onSuccess();
      return;
    }

    const uhid = await generatePatientUhid(hospitalId);

    const { error } = await supabase.from("patients").insert({
      hospital_id: hospitalId,
      uhid,
      ...patientFields,
      referral_source: form.referral_source || null,
    } as any);

    setSaving(false);
    if (error) {
      const msg = getErrorMessage(error);
      setFormError(msg);
      toast({ title: "Registration failed", description: msg, variant: "destructive" });
    } else {
      const consentText = getDPDPConsentText(hospitalName);
      const { data: newPatient } = await supabase.from("patients").select("id").eq("hospital_id", hospitalId).eq("uhid", uhid).maybeSingle();
      if (newPatient) {
        await encryptAadhaarIfProvided(hospitalId, newPatient.id);
        await supabase.from("patient_consents").insert({
          hospital_id: hospitalId,
          patient_id: newPatient.id,
          consent_type: "data_collection",
          consent_given: true,
          consent_text: consentText,
        } as any);

        if (referralDoctorId) {
          await supabase.from("patient_acquisition").insert({
            hospital_id: hospitalId,
            patient_id: newPatient.id,
            source: "referral_doctor",
            referral_doctor_id: referralDoctorId,
            first_visit_date: new Date().toISOString().split("T")[0],
            is_new_patient: true,
          } as any);

          const { data: rd } = await supabase
            .from("referral_doctors")
            .select("total_referrals, total_revenue")
            .eq("id", referralDoctorId)
            .maybeSingle();
          if (rd) {
            await supabase.from("referral_doctors").update({
              total_referrals: (rd.total_referrals || 0) + 1,
              last_referral_at: new Date().toISOString(),
            }).eq("id", referralDoctorId);
          }
        }
      }
      toast({ title: `Patient registered — ${uhid}` });
      // Optional registration fee. Driven by the `registration_fee` code in
      // Settings → Default Rates: rate 0 / unconfigured = hospital does not charge,
      // so we finish immediately (unchanged behaviour). A non-zero rate opens the
      // collect-fee step — the patient is already saved, so skipping never loses it.
      const { rate, gst } = await getRegistrationFee(hospitalId);
      if (rate > 0 && newPatient) {
        setNewPatientId(newPatient.id);
        setNewUhid(uhid);
        setRegFee(rate);
        setRegGst(gst);
        setCollectedById(collectedUserId);
        setStep("payment");
      } else {
        onSuccess();
      }
    }
  };

  const handleCollectFee = async () => {
    setSubmitting(true);
    setFormError(null);
    const res = await createAndPayRegistrationBill({
      hospitalId: hospitalIdState,
      patientId: newPatientId,
      amount: regFee,
      gstPercent: regGst,
      mode: paymentMode,
      reference: paymentRef || null,
      collectedBy: collectedById,
    });
    setSubmitting(false);
    if (!res.ok) {
      setFormError(res.error || "Could not record payment");
      toast({ title: "Payment failed", description: res.error, variant: "destructive" });
      return;
    }
    setReceiptInfo({ billNumber: res.billNumber || "", date: new Date().toLocaleDateString("en-IN") });
    setStep("receipt");
  };

  const finish = () => onSuccess();

  const handlePrintReceipt = () => {
    if (!receiptInfo) return;
    const header = printHeader(hospitalName, "");
    const body = `
      ${header}
      <div style="text-align:center; border-bottom:1px dashed #cbd5e1; padding-bottom:10px; margin-bottom:10px;">
        <strong style="font-size:16px;">PATIENT REGISTRATION RECEIPT</strong><br/>
        <small>${receiptInfo.date}</small>
      </div>
      <div class="row"><span class="label">Bill No.</span><span class="amount">${receiptInfo.billNumber}</span></div>
      <div class="row"><span class="label">Patient</span><span class="value">${form.full_name}</span></div>
      <div class="row"><span class="label">UHID</span><span class="amount">${newUhid}</span></div>
      <div style="border-top:1px dashed #cbd5e1; padding-top:10px; margin-top:10px;">
        <div class="row"><span class="label">Registration Fee</span><span class="amount" style="font-size:16px;">₹${regFee.toLocaleString("en-IN")}</span></div>
        <div class="row"><span class="label">Payment</span><span class="paid">Paid (${paymentMode})</span></div>
      </div>
      <style>
        .row { display: flex; justify-content: space-between; margin-bottom: 6px; }
        .label { color: #64748b; font-size: 12px; }
        .value { font-weight: 600; color: #1e293b; text-align: right; }
        .paid { color: #059669; font-weight: 600; }
        .amount { font-family: 'JetBrains Mono', monospace; font-weight: 600; }
      </style>
      <div style="text-align:center; font-size:11px; color:#94a3b8; margin-top:20px; border-top:1px dashed #cbd5e1; padding-top:10px;">
        Thank you. Welcome to ${hospitalName}!
      </div>
    `;
    printDocument("Registration Receipt", body, { width: 450, height: 600 });
  };

  const inputClass = "w-full h-[38px] px-3 border border-border rounded-lg text-sm bg-background text-foreground focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={step === "details" ? onClose : finish}>
      <div
        className="bg-card rounded-2xl shadow-lg flex flex-col overflow-hidden"
        style={{ width: "min(640px, calc(100vw - 48px))", maxHeight: "calc(100vh - 80px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {step === "details" ? (
        <>
        {/* Header */}
        <div className="flex items-center justify-between px-7 pt-5 pb-3 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-foreground">{editPatient ? "Edit Patient" : "Register New Patient"}</h2>
            <p className="text-[12px] text-muted-foreground">{editPatient ? "Update patient details" : "Fill in patient details below"}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            <X size={18} />
          </button>
        </div>

        {/* Form body */}
        <div className="px-7 pb-2 flex-1 overflow-y-auto flex flex-col gap-2.5">

          {/* ROW 1: Name + Phone + DOB */}
          <div className="flex gap-3">
            <div className="flex-[2] min-w-0">
              <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Full Name *</label>
              <input value={form.full_name} onChange={(e) => { set("full_name", e.target.value); setFieldErrors(prev => ({ ...prev, full_name: "" })); }}
                placeholder="Patient's full name" className={cn(inputClass, fieldErrors.full_name && "border-destructive")} />
              {fieldErrors.full_name && <p className="text-destructive text-[11px] mt-0.5">{fieldErrors.full_name}</p>}
            </div>
            <div className="flex-1 min-w-0">
              <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Phone</label>
              <input type="tel" value={form.phone} onChange={(e) => { set("phone", e.target.value); setFieldErrors(prev => ({ ...prev, phone: "" })); }}
                placeholder="Mobile number" className={cn(inputClass, fieldErrors.phone && "border-destructive")} />
              {fieldErrors.phone && <p className="text-destructive text-[11px] mt-0.5">{fieldErrors.phone}</p>}
            </div>
            <div className="flex-1 min-w-0">
              <label className="text-[14px] font-medium text-muted-foreground mb-1 block">DOB</label>
              <input type="date" value={form.dob} onChange={(e) => { set("dob", e.target.value); setFieldErrors(prev => ({ ...prev, dob: "" })); }}
                max={new Date().toISOString().split("T")[0]}
                className={cn(inputClass, fieldErrors.dob && "border-destructive")} />
              {fieldErrors.dob && <p className="text-destructive text-[11px] mt-0.5">{fieldErrors.dob}</p>}
            </div>
          </div>

          {/* ROW 2: Age + Gender + Blood Group */}
          <div className="flex gap-4 items-end">
            <div className="w-[72px] flex-shrink-0">
              <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Age</label>
              <input type="number" min={0} max={120} value={form.age} onChange={(e) => set("age", e.target.value)}
                placeholder="—" className={inputClass} />
            </div>
            <div className="flex-shrink-0">
              <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Gender</label>
              <div className="flex gap-1">
                {genders.map((g) => (
                  <button key={g} type="button" onClick={() => set("gender", g)}
                    className={cn(
                      "h-[32px] px-3.5 rounded-full text-[11px] font-medium border transition-colors capitalize",
                      form.gender === g
                        ? "bg-[hsl(222,55%,23%)] text-white border-[hsl(222,55%,23%)]"
                        : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                    )}>
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Blood Group</label>
              <div className="flex gap-1 flex-wrap">
                {bloodGroups.map((bg) => (
                  <button key={bg} type="button"
                    onClick={() => set("blood_group", form.blood_group === bg ? "" : bg)}
                    className={cn(
                      "h-[32px] px-2.5 rounded-full text-[11px] font-medium border transition-colors",
                      form.blood_group === bg
                        ? "bg-destructive/10 text-destructive border-destructive/30"
                        : "bg-muted text-muted-foreground border-border"
                    )}>
                    {bg}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ROW 3: Patient Category */}
          <div>
            <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Patient Category</label>
            <div className="flex gap-1.5 flex-wrap">
              {[
                { value: "general", label: "General" },
                { value: "bpl", label: "BPL" },
                { value: "cghs", label: "CGHS" },
                { value: "echs", label: "ECHS" },
                { value: "pmjay", label: "PM-JAY" },
                { value: "esi", label: "ESI" },
                { value: "insurance", label: "Insurance" },
                { value: "medicalaid", label: "Medical Aid" },
              ].map((cat) => (
                <button key={cat.value} type="button" onClick={() => set("patient_category", cat.value)}
                  className={cn(
                    "h-[30px] px-3 rounded-full text-[11px] font-medium border transition-colors",
                    form.patient_category === cat.value
                      ? "bg-[hsl(222,55%,23%)] text-white border-[hsl(222,55%,23%)]"
                      : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                  )}>
                  {cat.label}
                </button>
              ))}
            </div>
            {(form.patient_category === "pmjay" || form.patient_category === "cghs" || form.patient_category === "echs") && (
              <div className="mt-2">
                <input value={form.insurance_id} onChange={(e) => set("insurance_id", e.target.value)}
                  placeholder={form.patient_category === "pmjay" ? "PMJAY Beneficiary ID" : form.patient_category === "cghs" ? "CGHS Beneficiary No." : "ECHS Card No."}
                  className={inputClass} />
              </div>
            )}
          </div>

          {/* ROW 4: Address (single line) */}
          <div>
            <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Address</label>
            <input value={form.address} onChange={(e) => set("address", e.target.value)}
              placeholder="Door no, Street, Area, City, Pincode" className={inputClass} />
          </div>

          {/* ROW 5: Allergies + Chronic Conditions */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Allergies</label>
              <input value={form.allergies} onChange={(e) => set("allergies", e.target.value)}
                placeholder="e.g. Penicillin" className={inputClass} />
            </div>
            <div>
              <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Chronic Conditions</label>
              <input value={form.chronic_conditions} onChange={(e) => set("chronic_conditions", e.target.value)}
                placeholder="DM, HTN (comma-separated)" className={inputClass} />
            </div>
          </div>

          {/* ROW 5: Insurance + ABHA */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Insurance / TPA ID <span className="text-muted-foreground/60">(Optional)</span></label>
              <input value={form.insurance_id} onChange={(e) => set("insurance_id", e.target.value)}
                placeholder="Insurance / TPA ID" className={inputClass} />
            </div>
            <div>
              <label className="text-[14px] font-medium text-muted-foreground mb-1 block">ABHA ID <span className="text-muted-foreground/60">(Optional)</span></label>
              <div className="flex gap-2">
                <input
                  value={form.abha_id}
                  onChange={(e) => {
                    set("abha_id", e.target.value);
                    setAbhaVerified(false);
                    setAbhaStatus({ state: "idle" });
                  }}
                  placeholder="14-digit ABHA number"
                  className={inputClass}
                />
                <button
                  type="button"
                  disabled={!form.abha_id || abhaVerifying}
                  onClick={async () => {
                    setAbhaVerifying(true);
                    setAbhaStatus({ state: "idle" });
                    try {
                      const { data, error } = await supabase.functions.invoke(
                        "abdm-abha-verify",
                        { body: { abha_number: form.abha_id } }
                      );
                      if (error) throw error;
                      if (data?.verified && data?.mode === "live") {
                        setAbhaVerified(true);
                        setAbhaStatus({ state: "verified", message: "Verified" });
                      } else if (data?.verified && data?.mode === "sandbox_format_only") {
                        setAbhaVerified(true);
                        setAbhaStatus({ state: "sandbox", message: data.message || "Format Valid (Sandbox)" });
                      } else {
                        setAbhaVerified(false);
                        setAbhaStatus({ state: "invalid", message: data?.message || data?.error || "Invalid ABHA" });
                      }
                    } catch (e: any) {
                      setAbhaVerified(false);
                      setAbhaStatus({ state: "invalid", message: e?.message || "Verification failed" });
                    } finally {
                      setAbhaVerifying(false);
                    }
                  }}
                  className="px-3 py-2 text-[13px] font-medium rounded-md border border-border bg-card hover:bg-accent/10 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {abhaVerifying ? <Loader2 size={14} className="animate-spin" /> : null}
                  Verify
                </button>
              </div>
              {abhaStatus.state === "verified" && (
                <div className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
                  <CheckCircle2 size={12} /> Verified ✓
                </div>
              )}
              {abhaStatus.state === "sandbox" && (
                <div className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                  <AlertTriangle size={12} /> Format Valid (Sandbox)
                </div>
              )}
              {abhaStatus.state === "invalid" && (
                <div className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
                  <XCircle size={12} /> {abhaStatus.message || "Invalid ABHA"}
                </div>
              )}
            </div>
          </div>

          {/* ABHA Linking panel — edit mode only (requires existing patientId) */}
          {editPatient && hospitalIdState && (
            <div className="border border-border rounded-xl p-4 bg-muted/20">
              <p className="text-[13px] font-semibold text-foreground mb-3">ABHA Linking & Consent</p>
              <ABHASearchPanel
                patientId={editPatient.id}
                hospitalId={hospitalIdState}
                existingAbhaId={form.abha_id || editPatient.abha_id}
                onLinked={(abhaId) => set("abha_id", abhaId)}
                onUnlinked={() => set("abha_id", "")}
              />
            </div>
          )}

          {/* ROW 5b: Aadhaar ID */}
          <div>
            <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Aadhaar ID <span className="text-muted-foreground/60">(Optional)</span></label>
            <input
              value={form.aadhaar_id}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 12);
                const formatted = digits.replace(/(\d{4})(\d{1,4})?(\d{1,4})?/, (_, a, b, c) =>
                  [a, b, c].filter(Boolean).join("-"));
                set("aadhaar_id", formatted);
              }}
              placeholder="XXXX-XXXX-XXXX"
              maxLength={14}
              className={inputClass}
            />
            {form.aadhaar_id && form.aadhaar_id.replace(/\D/g, "").length === 12 && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Will be encrypted on save — never stored or displayed in plain text (KNOWN-BUG-123).
              </p>
            )}
          </div>

          {/* ROW 5c: Company GSTIN (B2B patients) */}
          <div>
            <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Company GSTIN <span className="text-muted-foreground/60">(Optional — B2B / corporate)</span></label>
            <input value={form.patient_gstin} onChange={(e) => set("patient_gstin", e.target.value)}
              placeholder="22AAAAA0000A1Z5" maxLength={15} className={inputClass} />
          </div>

          {/* ROW 6: Referral Source */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className="text-[14px] font-medium text-muted-foreground">Referral Source <span className="text-muted-foreground/60">(Optional)</span></label>
              <button type="button" onClick={() => setShowReferralModal(true)} className="text-[11px] text-accent font-medium hover:underline flex items-center gap-0.5">
                <UserPlus size={12} /> + Referral Doctor
              </button>
            </div>
            <input value={form.referral_source} onChange={(e) => set("referral_source", e.target.value)}
              placeholder="Dr. name, Google, Walk-in, Practo, etc." className={inputClass} />
          </div>

          {/* ROW 7: Emergency Contact */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Emergency Contact Name</label>
              <input value={form.emergency_contact_name} onChange={(e) => set("emergency_contact_name", e.target.value)}
                placeholder="Contact name" className={inputClass} />
            </div>
            <div>
              <label className="text-[14px] font-medium text-muted-foreground mb-1 block">Emergency Contact Phone</label>
              <input type="tel" value={form.emergency_contact_phone} onChange={(e) => set("emergency_contact_phone", e.target.value)}
                placeholder="Contact phone" className={inputClass} />
            </div>
          </div>
        </div>

        {/* DPDP Consent — only for new registrations */}
        {!editPatient && (
        <div className="px-7 pb-2">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={dpdpConsent}
              onChange={(e) => setDpdpConsent(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-border accent-primary"
            />
            <span className="text-[11px] text-muted-foreground leading-relaxed">
              {getDPDPConsentText(hospitalName)}
            </span>
          </label>
        </div>
        )}

        {/* Footer */}
        <div className="px-7 py-4 flex-shrink-0 border-t border-border space-y-3">
          <FormError message={formError} />
          <button
            onClick={handleSubmit}
            disabled={saving || !dpdpConsent}
            className="w-full h-[44px] bg-[hsl(222,55%,23%)] text-white rounded-lg text-[14px] font-semibold hover:bg-[hsl(222,55%,18%)] active:scale-[0.98] transition-all disabled:opacity-60"
          >
            {saving ? (editPatient ? "Updating…" : "Registering…") : (editPatient ? "Update Patient →" : "Register Patient →")}
          </button>
        </div>
        </>
        ) : step === "payment" ? (
          /* ══════════ Collect Registration Fee ══════════ */
          <div className="flex flex-col">
            <div className="flex items-center justify-between px-7 pt-5 pb-3">
              <div className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-primary" />
                <div>
                  <h2 className="text-lg font-bold text-foreground">Collect Registration Fee</h2>
                  <p className="text-[12px] text-muted-foreground">Patient registered — {newUhid}</p>
                </div>
              </div>
              <button onClick={finish} className="text-muted-foreground hover:text-foreground p-1"><X size={18} /></button>
            </div>
            <div className="px-7 pb-6 flex flex-col gap-4">
              {/* Patient summary */}
              <div className="p-3 bg-muted/40 rounded-lg border border-border space-y-1">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Patient</span><span className="font-medium text-foreground">{form.full_name || "—"}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">UHID</span><span className="font-mono text-foreground">{newUhid}</span></div>
              </div>
              {/* Fee — read-only to prevent front-desk manipulation */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">Registration Fee (₹)</label>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Default rate</span>
                </div>
                <div className="w-full h-12 px-4 border border-border rounded-lg text-lg font-bold mt-1 flex items-center select-none bg-muted/40 text-foreground">
                  ₹{regFee.toLocaleString("en-IN")}
                </div>
              </div>
              {/* Payment Mode */}
              <div>
                <label className="text-xs font-medium text-muted-foreground">Payment Mode</label>
                <div className="flex gap-2 mt-1.5">
                  {PAYMENT_MODES.map((m) => (
                    <button key={m.value} onClick={() => setPaymentMode(m.value)}
                      className={cn("flex-1 h-11 rounded-lg text-sm font-medium transition-colors",
                        paymentMode === m.value ? "bg-primary text-primary-foreground shadow" : "bg-muted text-muted-foreground hover:bg-muted/70")}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              {paymentMode !== "cash" && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Reference / Txn ID</label>
                  <input value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} placeholder="Transaction reference..." className={inputClass} />
                </div>
              )}
              <FormError message={formError} />
              <button onClick={handleCollectFee} disabled={submitting}
                className="w-full h-12 bg-[hsl(222,55%,23%)] text-white rounded-lg text-[14px] font-bold hover:bg-[hsl(222,55%,18%)] active:scale-[0.98] transition-all disabled:opacity-60">
                {submitting ? "Processing…" : `Pay ₹${regFee.toLocaleString("en-IN")} & Finish →`}
              </button>
              <button onClick={finish} disabled={submitting} className="text-xs text-muted-foreground hover:text-foreground mx-auto">
                Skip / collect later
              </button>
            </div>
          </div>
        ) : (
          /* ══════════ Registration Complete (receipt) ══════════ */
          <div className="flex flex-col">
            <div className="flex items-center justify-between px-7 pt-5 pb-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <h2 className="text-lg font-bold text-foreground">Registration Complete</h2>
              </div>
              <button onClick={finish} className="text-muted-foreground hover:text-foreground p-1"><X size={18} /></button>
            </div>
            <div className="px-7 pb-6">
              <div className="border border-border rounded-lg p-5 bg-card">
                <div className="text-center border-b border-dashed border-border pb-3 mb-3">
                  <p className="text-sm font-bold text-foreground">PATIENT REGISTRATION RECEIPT</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{receiptInfo?.date}</p>
                </div>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Bill No.</span><span className="font-mono font-medium text-foreground">{receiptInfo?.billNumber}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Patient</span><span className="font-medium text-foreground">{form.full_name}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">UHID</span><span className="font-mono text-foreground">{newUhid}</span></div>
                </div>
                <div className="border-t border-dashed border-border mt-3 pt-3 space-y-1.5">
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Registration Fee</span><span className="font-bold text-foreground">₹{regFee.toLocaleString("en-IN")}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Payment</span><span className="font-medium text-emerald-600">Paid ({paymentMode})</span></div>
                </div>
                <div className="border-t border-dashed border-border mt-3 pt-2 text-center">
                  <p className="text-[10px] text-muted-foreground">Thank you. Welcome to {hospitalName}!</p>
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={handlePrintReceipt} className="flex-1 h-11 bg-[hsl(222,55%,23%)] text-white rounded-lg text-[13px] font-semibold hover:bg-[hsl(222,55%,18%)] active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                  <Printer className="h-4 w-4" /> Print Receipt
                </button>
                <button onClick={finish} className="flex-1 h-11 bg-muted text-foreground rounded-lg text-[13px] font-semibold hover:bg-muted/70 active:scale-[0.98] transition-all">Done</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <div onClick={(e) => e.stopPropagation()}>
        <AddReferralDoctorModal
          open={showReferralModal}
          onClose={() => setShowReferralModal(false)}
          onSaved={(name, id) => { set("referral_source", name); setReferralDoctorId(id || null); setShowReferralModal(false); }}
          hospitalId={hospitalIdState}
        />
      </div>
    </div>
  );
};

export default PatientRegistrationModal;

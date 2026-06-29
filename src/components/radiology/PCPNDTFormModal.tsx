import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { X, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Props {
  hospitalId: string;
  orderId: string;
  patientId: string;
  patientName: string;
  patientDob?: string | null;
  orderedByName?: string | null;
  orderIndication?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const INDICATION_CATEGORIES = [
  { value: "confirm_pregnancy", label: "Confirm Pregnancy / Dating" },
  { value: "fetal_anomaly_scan", label: "Fetal Anomaly Scan" },
  { value: "placenta_assessment", label: "Placenta Assessment" },
  { value: "growth_monitoring", label: "Fetal Growth Monitoring" },
  { value: "cervical_assessment", label: "Cervical Assessment" },
  { value: "doppler", label: "Doppler Study" },
  { value: "amniotic_fluid", label: "Amniotic Fluid Assessment" },
  { value: "other_maternal", label: "Other Maternal Indication" },
  { value: "other_fetal", label: "Other Fetal Indication" },
];

function calcGA(lmp: string): number {
  if (!lmp) return 0;
  const days = Math.floor((Date.now() - new Date(lmp).getTime()) / 86400000);
  return Math.max(0, Math.floor(days / 7));
}

function calcAgeFromDob(dob: string | null | undefined): number {
  if (!dob) return 0;
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

const PCPNDTFormModal: React.FC<Props> = ({
  hospitalId, orderId, patientId, patientName, patientDob, orderedByName, orderIndication, onClose, onSaved,
}) => {
  const { toast } = useToast();
  const [existingId, setExistingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  // Form number
  const [formNumber, setFormNumber] = useState("");

  // Patient details
  const [patientAge, setPatientAge] = useState(calcAgeFromDob(patientDob) || 0);
  const [patientAddress, setPatientAddress] = useState("");
  const [husbandName, setHusbandName] = useState("");
  const [referredBy, setReferredBy] = useState(orderedByName || "");
  const [referredFrom, setReferredFrom] = useState("");

  // Obstetric
  const [lmp, setLmp] = useState("");
  const [gaWeeks, setGaWeeks] = useState(0);
  const [gravida, setGravida] = useState<number | "">(1);
  const [para, setPara] = useState<number | "">(0);
  const [parity, setParity] = useState("");

  // Indication
  const [indicationCategory, setIndicationCategory] = useState("confirm_pregnancy");
  const [indication, setIndication] = useState(orderIndication || "");

  // Consent
  const [consentGiven, setConsentGiven] = useState(false);
  const [consentFormNumber, setConsentFormNumber] = useState("");

  // Declaration
  const [sexDeclaration, setSexDeclaration] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (auth?.user) {
        const { data: u } = await supabase.from("users").select("id").eq("auth_user_id", auth.user.id).maybeSingle();
        if (u) setUserId(u.id);
      }

      // Load existing record
      const { data: rec } = await (supabase as any)
        .from("pcpndt_records")
        .select("*")
        .eq("radiology_order_id", orderId)
        .maybeSingle();

      if (rec) {
        setExistingId(rec.id);
        setFormNumber(rec.form_number || "");
        setPatientAge(rec.patient_age ?? calcAgeFromDob(patientDob) ?? 0);
        setPatientAddress(rec.patient_address || "");
        setHusbandName(rec.husband_name || "");
        setReferredBy(rec.referred_by || orderedByName || "");
        setReferredFrom(rec.referred_from || "");
        setLmp(rec.last_menstrual_period || "");
        setGaWeeks(rec.gestational_age_weeks ?? 0);
        setGravida(rec.gravida ?? 1);
        setPara(rec.para ?? 0);
        setParity(rec.parity || "");
        setIndicationCategory(rec.indication_category || "confirm_pregnancy");
        setIndication(rec.indication || orderIndication || "");
        setConsentGiven(rec.consent_given ?? false);
        setConsentFormNumber(rec.consent_form_number || "");
        setSexDeclaration(rec.no_sex_determination_declared ?? false);
      } else {
        // Generate new form number
        const year = new Date().getFullYear();
        const { count } = await (supabase as any)
          .from("pcpndt_records")
          .select("id", { count: "exact", head: true })
          .eq("hospital_id", hospitalId)
          .gte("created_at", `${year}-01-01`);
        const seq = String((count || 0) + 1).padStart(4, "0");
        setFormNumber(`PCPNDT-${year}-${seq}`);
      }
    })();
  }, [orderId, hospitalId, patientDob, orderedByName, orderIndication]);

  // Auto-update GA when LMP changes
  useEffect(() => {
    if (lmp) setGaWeeks(calcGA(lmp));
  }, [lmp]);

  const handleSave = async () => {
    if (!indication.trim()) {
      toast({ title: "Indication is required", variant: "destructive" });
      return;
    }
    if (!sexDeclaration) {
      toast({ title: "Sex determination declaration is mandatory", description: "You must confirm that sex of foetus was NOT determined", variant: "destructive" });
      return;
    }
    if (!consentGiven) {
      toast({ title: "Patient consent is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      hospital_id: hospitalId,
      radiology_order_id: orderId,
      patient_id: patientId,
      form_number: formNumber,
      patient_age: patientAge || null,
      patient_address: patientAddress.trim() || null,
      husband_name: husbandName.trim() || null,
      referred_by: referredBy.trim() || null,
      referred_from: referredFrom.trim() || null,
      last_menstrual_period: lmp || null,
      gestational_age_weeks: gaWeeks || null,
      gravida: gravida !== "" ? Number(gravida) : null,
      para: para !== "" ? Number(para) : null,
      parity: parity.trim() || null,
      indication: indication.trim(),
      indication_category: indicationCategory,
      consent_given: consentGiven,
      consent_form_number: consentFormNumber.trim() || null,
      consent_obtained_by: userId || null,
      consent_at: consentGiven ? new Date().toISOString() : null,
      no_sex_determination_declared: sexDeclaration,
      declared_by: userId || null,
    };

    let error: any;
    if (existingId) {
      const res = await (supabase as any).from("pcpndt_records").update(payload).eq("id", existingId);
      error = res.error;
    } else {
      const res = await (supabase as any).from("pcpndt_records").insert(payload);
      error = res.error;
    }

    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `PCPNDT Form ${formNumber} saved ✓` });
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 overflow-y-auto py-6" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-[600px] shadow-2xl mx-4" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-bold text-slate-900">PCPNDT Form F</h2>
            <p className="text-xs text-slate-500 mt-0.5">Pre-Conception & Pre-Natal Diagnostics Techniques Act, 1994</p>
          </div>
          <div className="flex items-center gap-3">
            {formNumber && (
              <span className="text-xs font-mono bg-amber-50 border border-amber-200 text-amber-700 px-2 py-0.5 rounded font-semibold">{formNumber}</span>
            )}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
          </div>
        </div>

        {/* Legal notice */}
        <div className="mx-6 mt-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-amber-800 leading-relaxed">
            <strong>Legally Mandatory</strong> — Failure to maintain Form F records is a cognizable offense under PCPNDT Act 1994. Sex determination is strictly prohibited and punishable.
          </p>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Patient details */}
          <div>
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Patient Details</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">Patient Name</label>
                <Input value={patientName} readOnly className="h-9 bg-muted text-sm" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">Patient Age (years) *</label>
                <Input type="number" value={patientAge} onChange={(e) => setPatientAge(Number(e.target.value))} className="h-9 text-sm" min={0} max={60} />
              </div>
              <div className="col-span-2">
                <label className="text-[11px] font-medium text-slate-600 block mb-1">Patient Address *</label>
                <Input value={patientAddress} onChange={(e) => setPatientAddress(e.target.value)} className="h-9 text-sm" placeholder="Full address with district" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">Husband / Guardian Name</label>
                <Input value={husbandName} onChange={(e) => setHusbandName(e.target.value)} className="h-9 text-sm" placeholder="Husband or guardian" />
              </div>
            </div>
          </div>

          {/* Referral */}
          <div>
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Referral</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">Referred By (Doctor Name) *</label>
                <Input value={referredBy} onChange={(e) => setReferredBy(e.target.value)} className="h-9 text-sm" placeholder="Referring doctor name" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">Referred From (Hospital/Clinic)</label>
                <Input value={referredFrom} onChange={(e) => setReferredFrom(e.target.value)} className="h-9 text-sm" placeholder="Name of referring hospital" />
              </div>
            </div>
          </div>

          {/* Obstetric details */}
          <div>
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Obstetric Details</p>
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-2">
                <label className="text-[11px] font-medium text-slate-600 block mb-1">Last Menstrual Period (LMP)</label>
                <Input type="date" value={lmp} onChange={(e) => setLmp(e.target.value)} className="h-9 text-sm" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">Gest. Age (weeks)</label>
                <Input type="number" value={gaWeeks} onChange={(e) => setGaWeeks(Number(e.target.value))} className="h-9 text-sm" min={0} max={42} />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">Parity</label>
                <Input value={parity} onChange={(e) => setParity(e.target.value)} className="h-9 text-sm" placeholder="e.g. G2P1" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">Gravida</label>
                <Input type="number" value={gravida} onChange={(e) => setGravida(e.target.value === "" ? "" : Number(e.target.value))} className="h-9 text-sm" min={0} />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">Para</label>
                <Input type="number" value={para} onChange={(e) => setPara(e.target.value === "" ? "" : Number(e.target.value))} className="h-9 text-sm" min={0} />
              </div>
            </div>
          </div>

          {/* Indication */}
          <div>
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Indication (Mandatory)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">Indication Category *</label>
                <select value={indicationCategory} onChange={(e) => setIndicationCategory(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {INDICATION_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">Indication (free text) *</label>
                <Input value={indication} onChange={(e) => setIndication(e.target.value)} className="h-9 text-sm" placeholder="Clinical reason for this examination" />
              </div>
            </div>
            <p className="text-[10px] text-red-600 mt-1 font-medium">
              ⚠️ Indication for sex of foetus is strictly prohibited under PCPNDT Act.
            </p>
          </div>

          {/* Consent */}
          <div className="bg-slate-50 rounded-lg p-3 space-y-2 border border-slate-200">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Informed Consent</p>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={consentGiven} onChange={(e) => setConsentGiven(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 accent-emerald-600" />
              <span className="text-xs text-slate-700 leading-relaxed">
                Patient has given informed consent for the ultrasonography examination and has been explained the purpose and procedure.
              </span>
            </label>
            {consentGiven && (
              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">Consent Form Number</label>
                <Input value={consentFormNumber} onChange={(e) => setConsentFormNumber(e.target.value)} className="h-9 text-sm" placeholder="Consent form serial number" />
              </div>
            )}
          </div>

          {/* Declaration */}
          <div className={cn("rounded-lg p-3 border transition-colors", sexDeclaration ? "bg-emerald-50 border-emerald-300" : "bg-red-50 border-red-200")}>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={sexDeclaration} onChange={(e) => setSexDeclaration(e.target.checked)}
                className="mt-0.5 rounded border-red-300 accent-emerald-600 flex-shrink-0" />
              <span className="text-xs text-slate-800 leading-relaxed font-medium">
                I hereby declare that while conducting this ultrasonography/pre-natal diagnostic technique on <strong>{patientName}</strong>, I have <strong>NOT</strong> determined and will <strong>NOT</strong> disclose the sex of the foetus to any person in any manner. <span className="text-red-600 font-bold">*</span>
              </span>
            </label>
            {sexDeclaration && (
              <div className="flex items-center gap-1 mt-1.5">
                <CheckCircle2 size={12} className="text-emerald-600" />
                <span className="text-[10px] text-emerald-700 font-medium">Declaration recorded</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex gap-3">
          <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 active:scale-[0.98]">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !sexDeclaration || !consentGiven || !indication.trim()}
            className="flex-[2] h-11 rounded-xl bg-[hsl(222,55%,23%)] text-white text-sm font-semibold hover:opacity-90 active:scale-[0.97] disabled:opacity-40"
          >
            {saving ? "Saving…" : existingId ? "Update Form F" : "Save Form F"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PCPNDTFormModal;

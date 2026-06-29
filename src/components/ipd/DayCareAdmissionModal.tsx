import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Stethoscope, Search, User, ClipboardList } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  hospitalId: string;
  onAdmitted: () => void;
}

interface PatientResult {
  id: string;
  full_name: string;
  uhid: string;
  phone: string | null;
  dob: string | null;
  gender: string | null;
  blood_group: string | null;
}

interface Procedure {
  id: string;
  procedure_name: string;
  procedure_code: string | null;
  specialty: string | null;
  duration_minutes: number;
  standard_rate: number;
  pre_auth_required: boolean;
}

interface Doctor {
  id: string;
  full_name: string;
}

const insuranceTypes = ["self_pay", "insurance", "pmjay", "cghs", "echs"] as const;

const DayCareAdmissionModal: React.FC<Props> = ({ open, onClose, hospitalId, onAdmitted }) => {
  const [step, setStep] = useState(1);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<PatientResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<PatientResult | null>(null);

  // Step 2
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [selectedProcedure, setSelectedProcedure] = useState<Procedure | null>(null);
  const [doctorId, setDoctorId] = useState("");
  const [insuranceType, setInsuranceType] = useState("self_pay");
  const [insuranceId, setInsuranceId] = useState("");
  const [clinicalNotes, setClinicalNotes] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setStep(1);
      setSearch("");
      setResults([]);
      setSelectedPatient(null);
      setSelectedProcedure(null);
      setDoctorId("");
      setInsuranceType("self_pay");
      setInsuranceId("");
      setClinicalNotes("");
      setScheduledTime("");
    }
  }, [open]);

  useEffect(() => {
    if (step === 2 && hospitalId) {
      Promise.all([
        (supabase as any)
          .from("day_care_procedures")
          .select("id, procedure_name, procedure_code, specialty, duration_minutes, standard_rate, pre_auth_required")
          .eq("hospital_id", hospitalId)
          .eq("is_active", true)
          .order("procedure_name"),
        supabase
          .from("users")
          .select("id, full_name")
          .eq("hospital_id", hospitalId)
          .eq("role", "doctor")
          .order("full_name"),
      ]).then(([procRes, docRes]) => {
        setProcedures((procRes as any).data || []);
        setDoctors((docRes as any).data || []);
      });
    }
  }, [step, hospitalId]);

  const handleSearch = async (q: string) => {
    setSearch(q);
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    const { data } = await supabase
      .from("patients")
      .select("id, full_name, uhid, phone, dob, gender, blood_group")
      .eq("hospital_id", hospitalId)
      .or(`full_name.ilike.%${q}%,uhid.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(8);
    setResults(data || []);
    setSearching(false);
  };

  const handleAdmit = async () => {
    if (!selectedPatient || !selectedProcedure || !doctorId) {
      toast({ title: "Required fields missing", description: "Select patient, procedure, and doctor.", variant: "destructive" });
      return;
    }
    setSubmitting(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSubmitting(false); return; }

    const admNum = `DC-${Date.now().toString().slice(-8)}`;
    const now = new Date().toISOString();
    const sameDay = new Date();
    sameDay.setHours(23, 59, 0, 0);

    const { error } = await supabase.from("admissions").insert({
      hospital_id: hospitalId,
      patient_id: selectedPatient.id,
      admitting_doctor_id: doctorId,
      admission_type: "daycare",
      admission_number: admNum,
      admitting_diagnosis: selectedProcedure.procedure_name,
      insurance_type: insuranceType,
      insurance_id: insuranceId || null,
      admitted_at: scheduledTime ? new Date(scheduledTime).toISOString() : now,
      expected_discharge_date: sameDay.toISOString().slice(0, 10),
      status: "active",
      day_care_procedure_id: selectedProcedure.id,
      notes: clinicalNotes || null,
    } as any);

    if (error) {
      toast({ title: "Admission failed", description: error.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    toast({ title: `Day care admission created`, description: `${selectedPatient.full_name} — ${selectedProcedure.procedure_name}` });
    onAdmitted();
    onClose();
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope size={18} className="text-teal-600" />
            Day Care Admission
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-4">
          {[1, 2].map(n => (
            <div key={n} className="flex items-center gap-2">
              <div className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold",
                step === n ? "bg-teal-600 text-white" : step > n ? "bg-teal-100 text-teal-700" : "bg-muted text-muted-foreground"
              )}>{n}</div>
              {n < 2 && <div className="h-px w-10 bg-border" />}
            </div>
          ))}
          <span className="text-xs text-muted-foreground ml-2">
            {step === 1 ? "Select Patient" : "Procedure & Details"}
          </span>
        </div>

        {/* Step 1 — Patient search */}
        {step === 1 && (
          <div className="space-y-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search by name, UHID or phone…"
                value={search}
                onChange={e => handleSearch(e.target.value)}
                autoFocus
              />
            </div>
            {searching && <p className="text-xs text-muted-foreground">Searching…</p>}
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {results.map(p => (
                <button
                  key={p.id}
                  onClick={() => { setSelectedPatient(p); setStep(2); }}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded border text-sm hover:bg-muted transition-colors",
                    selectedPatient?.id === p.id && "border-teal-400 bg-teal-50"
                  )}
                >
                  <div className="font-medium">{p.full_name}</div>
                  <div className="text-xs text-muted-foreground">{p.uhid} · {p.gender || "—"} · {p.blood_group || "—"}</div>
                </button>
              ))}
              {search.length > 1 && results.length === 0 && !searching && (
                <p className="text-xs text-muted-foreground text-center py-4">No patients found.</p>
              )}
            </div>
          </div>
        )}

        {/* Step 2 — Procedure details */}
        {step === 2 && selectedPatient && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-2 bg-teal-50 rounded border border-teal-100 text-sm">
              <User size={14} className="text-teal-600 shrink-0" />
              <span className="font-medium">{selectedPatient.full_name}</span>
              <span className="text-muted-foreground text-xs">{selectedPatient.uhid}</span>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">Day Care Procedure *</label>
              <div className="space-y-1 max-h-48 overflow-y-auto border rounded p-1">
                {procedures.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-3">
                    No procedures configured. Add them in Settings → Day Care Procedures.
                  </p>
                )}
                {procedures.map(proc => (
                  <button
                    key={proc.id}
                    onClick={() => setSelectedProcedure(proc)}
                    className={cn(
                      "w-full text-left px-2 py-1.5 rounded text-xs hover:bg-muted transition-colors",
                      selectedProcedure?.id === proc.id && "bg-teal-50 border border-teal-300"
                    )}
                  >
                    <div className="font-medium">{proc.procedure_name}</div>
                    <div className="text-muted-foreground">
                      {proc.procedure_code && `${proc.procedure_code} · `}
                      {proc.duration_minutes} min · ₹{proc.standard_rate.toLocaleString()}
                      {proc.pre_auth_required && " · Pre-auth required"}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">Doctor *</label>
                <select
                  className="w-full border rounded px-2 py-1.5 text-sm"
                  value={doctorId}
                  onChange={e => setDoctorId(e.target.value)}
                >
                  <option value="">Select doctor</option>
                  {doctors.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Scheduled Time</label>
                <Input type="datetime-local" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} className="text-xs" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">Payer</label>
                <select
                  className="w-full border rounded px-2 py-1.5 text-sm"
                  value={insuranceType}
                  onChange={e => setInsuranceType(e.target.value)}
                >
                  {insuranceTypes.map(t => <option key={t} value={t}>{t.replace("_", " ").toUpperCase()}</option>)}
                </select>
              </div>
              {insuranceType !== "self_pay" && (
                <div className="space-y-1">
                  <label className="text-xs font-medium">Policy / Member ID</label>
                  <Input value={insuranceId} onChange={e => setInsuranceId(e.target.value)} placeholder="Card / policy no." />
                </div>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium flex items-center gap-1"><ClipboardList size={12} />Clinical Notes</label>
              <Textarea
                rows={2}
                value={clinicalNotes}
                onChange={e => setClinicalNotes(e.target.value)}
                placeholder="Pre-op instructions, allergies, contraindications…"
              />
            </div>

            {selectedProcedure?.pre_auth_required && insuranceType !== "self_pay" && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                This procedure requires insurance pre-authorisation. An intimation will be auto-created after admission.
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setStep(1)}>Back</Button>
              <Button
                size="sm"
                className="bg-teal-600 hover:bg-teal-700"
                onClick={handleAdmit}
                disabled={submitting || !selectedProcedure || !doctorId}
              >
                {submitting ? "Admitting…" : "Admit Patient"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default DayCareAdmissionModal;

import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatINRExact } from "@/lib/currency";
import { generateAdmissionNumber } from "@/lib/admissionNumber";
import {
  DayCareProcedureSelection,
  anyPreAuthRequired,
  filterProcedureOptions,
  listProcedures,
  saveAdmissionProcedures,
  setProcedureQuantity,
  toggleProcedure,
  totalProcedureCharge,
} from "@/lib/dayCareProcedures";
import { Stethoscope, Search, User, ClipboardList, CalendarClock, ChevronDown, X, Minus, Plus } from "lucide-react";

/** What the caller needs to open Estimate & Deposit straight after a booking. */
export interface DayCareBooking {
  admissionId:   string;
  patientId:     string;
  patientName:   string;
  uhid:          string;
  /** Human label for all booked procedures, e.g. "Cataract ×2, Endoscopy". */
  procedureName: string;
  /** TOTAL charge across every booked procedure — what the estimate is seeded from. */
  standardRate:  number;
  procedures:    DayCareProcedureSelection[];
  /** IST calendar date (YYYY-MM-DD) the procedure is booked for — lets the board jump to it. */
  scheduledDate: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  hospitalId: string;
  onBooked: (booking: DayCareBooking) => void;
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

const DayCareAdmissionModal: React.FC<Props> = ({ open, onClose, hospitalId, onBooked }) => {
  const [step, setStep] = useState(1);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<PatientResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<PatientResult | null>(null);

  // Step 2
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  /** Order matters: the FIRST pick is the primary procedure written to admissions. */
  const [selectedProcedures, setSelectedProcedures] = useState<DayCareProcedureSelection[]>([]);
  const [procedureMenuOpen, setProcedureMenuOpen] = useState(false);
  const [procedureSearch, setProcedureSearch] = useState("");
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
      setSelectedProcedures([]);
      setProcedureMenuOpen(false);
      setProcedureSearch("");
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

  const visibleProcedures = filterProcedureOptions(procedures, procedureSearch);

  const handleSearch = async (q: string) => {
    setSearch(q);
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    const { data } = await supabase
      .from("patients")
      .select("id, full_name, uhid, phone, dob, gender, blood_group")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .or(`full_name.ilike.%${q}%,uhid.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(8);
    setResults(data || []);
    setSearching(false);
  };

  /**
   * Book the procedure — do NOT admit.
   *
   * The patient is admitted later, from the Scheduled tab, once they actually report AND
   * are financially cleared. Booking therefore writes status='scheduled' with admitted_at
   * left NULL; admitted_at is reserved for real arrival so the same-day discharge rule
   * always measures against when the patient was actually here. (20261008000138)
   */
  const handleBook = async () => {
    if (!selectedPatient || selectedProcedures.length === 0 || !doctorId || !scheduledTime) {
      toast({
        title: "Required fields missing",
        description: "Select patient, at least one procedure, doctor, and the scheduled date & time.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSubmitting(false); return; }

    // Real per-hospital daily sequence (DC-20260717-0001), not a timestamp slice.
    let admNum: string;
    try {
      admNum = await generateAdmissionNumber(hospitalId, "daycare");
    } catch (e: any) {
      toast({ title: "Booking failed", description: e?.message || "Could not generate an admission number", variant: "destructive" });
      setSubmitting(false);
      return;
    }
    const scheduledAt = new Date(scheduledTime);
    // The first pick is the primary procedure: it goes in the legacy single-FK column that
    // the board query, the service-catalog mirror and PMJAY mapping still read.
    const primary = selectedProcedures[0];
    const procedureLabel = listProcedures(selectedProcedures);

    const { data: inserted, error } = await supabase.from("admissions").insert({
      hospital_id: hospitalId,
      patient_id: selectedPatient.id,
      admitting_doctor_id: doctorId,
      admission_type: "daycare",
      admission_number: admNum,
      admitting_diagnosis: procedureLabel,
      insurance_type: insuranceType,
      insurance_id: insuranceId || null,
      scheduled_at: scheduledAt.toISOString(),
      admitted_at: null,
      // Day care discharges on the day of the procedure, not the day it was booked.
      expected_discharge_date: scheduledAt.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
      status: "scheduled",
      day_care_procedure_id: primary.procedureId,
      // admissions has no `notes` column — writing one silently failed the whole
      // insert. nursing_handover_notes is the real column for admission-time
      // clinical notes (AdmitPatientModal writes it, and ClaimBundleGenerator
      // already renders it under the heading "Clinical Notes").
      nursing_handover_notes: clinicalNotes.trim() || null,
    } as any).select("id").maybeSingle();

    if (error || !inserted) {
      toast({ title: "Booking failed", description: error?.message || "Unknown error", variant: "destructive" });
      setSubmitting(false);
      return;
    }

    // The procedures ARE the money on this booking. If they don't land, an admission with no
    // charge attached is worse than no admission at all — undo it rather than leave a ₹0
    // booking that gets admitted and discharged unbilled.
    const procErr = await saveAdmissionProcedures(hospitalId, inserted.id, selectedProcedures);
    if (procErr) {
      await supabase.from("admissions").delete().eq("id", inserted.id);
      toast({ title: "Booking failed", description: procErr, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    toast({
      title: selectedProcedures.length > 1 ? "Procedures booked" : "Procedure booked",
      description: `${selectedPatient.full_name} — ${procedureLabel}. Give the estimate and collect the deposit before admitting.`,
    });
    onBooked({
      admissionId:   inserted.id,
      patientId:     selectedPatient.id,
      patientName:   selectedPatient.full_name,
      uhid:          selectedPatient.uhid,
      procedureName: procedureLabel,
      standardRate:  totalProcedureCharge(selectedProcedures),
      procedures:    selectedProcedures,
      scheduledDate: scheduledAt.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
    });
    onClose();
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      {/* DialogContent is centred with a -50% translate and has no height cap of its own, so
          a tall booking (many procedures selected) bled off the top AND bottom of the screen
          with nothing to scroll. Cap it to the viewport and let the dialog scroll instead. */}
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope size={18} className="text-teal-600" />
            Book Day Care Procedure
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
              <label className="text-xs font-medium">Day Care Procedures *</label>

              {/* Multi-select: a day care list routinely bundles procedures, and every one
                  of them has to reach the estimate and the bill. */}
              <Popover
                open={procedureMenuOpen}
                onOpenChange={o => { setProcedureMenuOpen(o); if (!o) setProcedureSearch(""); }}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="w-full flex items-center justify-between gap-2 border rounded px-2 py-1.5 text-sm text-left hover:bg-muted/50 transition-colors"
                  >
                    <span className={cn("truncate", selectedProcedures.length === 0 && "text-muted-foreground")}>
                      {selectedProcedures.length === 0
                        ? "Select procedures…"
                        : `${selectedProcedures.length} selected`}
                    </span>
                    <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-1" align="start">
                  <div className="relative mb-1">
                    <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-7 h-8 text-xs"
                      placeholder="Search name, code or specialty…"
                      value={procedureSearch}
                      onChange={e => setProcedureSearch(e.target.value)}
                      autoFocus
                    />
                  </div>
                  {/* overscroll-contain: reaching the end of this list must not start
                      scrolling the dialog underneath it. */}
                  <div className="max-h-56 overflow-y-auto overscroll-contain">
                    {procedures.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-3 px-2">
                        No procedures configured. Add them in Settings → Day Care Procedures.
                      </p>
                    )}
                    {/* Distinct from the message above: "you have none" and "none match what
                        you typed" send the user to completely different places. */}
                    {procedures.length > 0 && visibleProcedures.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-3 px-2">
                        No procedure matches “{procedureSearch.trim()}”.
                      </p>
                    )}
                    {visibleProcedures.map(proc => {
                      const checked = selectedProcedures.some(s => s.procedureId === proc.id);
                      return (
                        <button
                          key={proc.id}
                          type="button"
                          onClick={() => setSelectedProcedures(prev => toggleProcedure(prev, {
                            procedureId:     proc.id,
                            procedureName:   proc.procedure_name,
                            rate:            Number(proc.standard_rate) || 0,
                            durationMinutes: proc.duration_minutes,
                            preAuthRequired: proc.pre_auth_required,
                          }))}
                          className={cn(
                            "w-full flex items-start gap-2 text-left px-2 py-1.5 rounded text-xs hover:bg-muted transition-colors",
                            checked && "bg-teal-50"
                          )}
                        >
                          <Checkbox checked={checked} className="mt-0.5 pointer-events-none" tabIndex={-1} />
                          <span className="min-w-0">
                            <span className="block font-medium truncate">{proc.procedure_name}</span>
                            <span className="block text-muted-foreground">
                              {proc.procedure_code && `${proc.procedure_code} · `}
                              {proc.duration_minutes} min · {formatINRExact(Number(proc.standard_rate) || 0)}
                              {proc.pre_auth_required && " · Pre-auth required"}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>

              {/* Selected lines with quantity — bilateral cataract is one procedure ×2. */}
              {selectedProcedures.length > 0 && (
                <div className="border rounded mt-1">
                  {/* Only the LINES scroll — the Total stays pinned below, because the one
                      figure the counsellor is reading must never scroll out of sight. */}
                  <div className="divide-y max-h-40 overflow-y-auto">
                  {selectedProcedures.map(p => (
                    <div key={p.procedureId} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                      <span className="flex-1 min-w-0 truncate font-medium">{p.procedureName}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          aria-label={`Decrease quantity of ${p.procedureName}`}
                          className="w-5 h-5 rounded border flex items-center justify-center disabled:opacity-40"
                          disabled={p.quantity <= 1}
                          onClick={() => setSelectedProcedures(prev => setProcedureQuantity(prev, p.procedureId, p.quantity - 1))}
                        >
                          <Minus size={11} />
                        </button>
                        <span className="w-5 text-center tabular-nums">{p.quantity}</span>
                        <button
                          type="button"
                          aria-label={`Increase quantity of ${p.procedureName}`}
                          className="w-5 h-5 rounded border flex items-center justify-center"
                          onClick={() => setSelectedProcedures(prev => setProcedureQuantity(prev, p.procedureId, p.quantity + 1))}
                        >
                          <Plus size={11} />
                        </button>
                      </div>
                      <span className="w-20 text-right font-mono shrink-0">
                        {formatINRExact(p.rate * p.quantity)}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${p.procedureName}`}
                        className="text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => setSelectedProcedures(prev => prev.filter(s => s.procedureId !== p.procedureId))}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                  </div>
                  <div className="flex items-center justify-between px-2 py-1.5 text-xs font-semibold bg-muted/40 border-t">
                    <span>Total{selectedProcedures.length > 1 && ` · ${selectedProcedures.length} procedures`}</span>
                    <span className="font-mono">{formatINRExact(totalProcedureCharge(selectedProcedures))}</span>
                  </div>
                </div>
              )}
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
                <label className="text-xs font-medium flex items-center gap-1">
                  <CalendarClock size={12} />Scheduled Date &amp; Time *
                </label>
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

            {/* One procedure needing pre-auth makes the whole booking need it. */}
            {anyPreAuthRequired(selectedProcedures) && insuranceType !== "self_pay" && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                This booking requires insurance pre-authorisation. An intimation will be raised
                automatically, due 2 hours before the scheduled time.
              </div>
            )}

            <div className="text-xs text-muted-foreground bg-muted/50 border rounded p-2">
              Booking does not admit the patient. Give the estimate and collect the deposit, then
              admit from the Scheduled tab when they report.
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setStep(1)}>Back</Button>
              <Button
                size="sm"
                className="bg-teal-600 hover:bg-teal-700"
                onClick={handleBook}
                disabled={submitting || selectedProcedures.length === 0 || !doctorId || !scheduledTime}
              >
                {submitting ? "Booking…" : "Book Procedure"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default DayCareAdmissionModal;

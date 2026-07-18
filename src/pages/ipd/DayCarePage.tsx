import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import DayCareAdmissionModal, { DayCareBooking } from "@/components/ipd/DayCareAdmissionModal";
import DayCareDischargeModal from "@/components/ipd/DayCareDischargeModal";
import DayCareAdmitGateModal from "@/components/ipd/DayCareAdmitGateModal";
import DayCareFinancialPanel from "@/components/ipd/DayCareFinancialPanel";
import DayCareCancelModal from "@/components/ipd/DayCareCancelModal";
import DayCareRescheduleModal from "@/components/ipd/DayCareRescheduleModal";
import AdmitPatientModal from "@/components/ipd/AdmitPatientModal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Plus, Search, Clock, User, Stethoscope, LogOut, RefreshCw, CalendarClock, IndianRupee, LogIn, XCircle, UserX } from "lucide-react";
import { formatDateIST } from "@/lib/dateUtils";
import { DayCareTab, dayCareDateColumn, dayCareStatusFilter, dayCareSortAscending } from "@/lib/dayCareBoard";
import {
  DayCareClearance, DayCarePaymentPolicy, DEFAULT_DAY_CARE_POLICY,
  checkDayCareClearance, deriveDepositDefault, fetchDayCarePolicy,
} from "@/lib/dayCareGate";
import { chargeDayCareProcedure } from "@/lib/dayCareBilling";
import { CancelStatus } from "@/lib/dayCareCancel";
import { useConfigLabelMap } from "@/hooks/useConfigValues";
import { syncAdvanceToBill } from "@/lib/advanceBillSync";
import { getCurrentUserRowId } from "@/lib/currentUser";

interface DayCareAdmission {
  id: string;
  patient_id: string;
  patient_name: string;
  uhid: string;
  admission_number: string;
  admitted_at: string | null;
  scheduled_at: string | null;
  admitting_diagnosis: string;
  doctor_name: string;
  insurance_type: string;
  procedure_name: string | null;
  duration_minutes: number | null;
  standard_rate: number;
  status: string;
  cancellation_reason: string | null;
  cancellation_note: string | null;
}

interface DischargeTarget {
  admissionId: string;
  patientName: string;
  procedureName: string;
}

const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const yesterdayStr = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
};

const DayCarePage: React.FC = () => {
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [admissions, setAdmissions] = useState<DayCareAdmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [admitOpen, setAdmitOpen] = useState(false);
  const [dischargeTarget, setDischargeTarget] = useState<DischargeTarget | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<DayCareTab>("scheduled");
  const [selectedDate, setSelectedDate] = useState<string>(todayStr());

  // Estimate / gate / admit state
  const [policy, setPolicy] = useState<DayCarePaymentPolicy>(DEFAULT_DAY_CARE_POLICY);
  const [role, setRole] = useState<string | null>(null);
  const [estimateFor, setEstimateFor] = useState<DayCareAdmission | null>(null);
  /** Set straight after booking so counselling follows the booking without a second click. */
  const [pendingEstimate, setPendingEstimate] = useState<DayCareBooking | null>(null);
  const [gate, setGate] = useState<{ admission: DayCareAdmission; clearance: DayCareClearance } | null>(null);
  const [admitting, setAdmitting] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<{ admission: DayCareAdmission; mode: CancelStatus } | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<DayCareAdmission | null>(null);

  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: ud } = await supabase.from("users").select("hospital_id, role").eq("auth_user_id", user.id).maybeSingle();
    if (!ud?.hospital_id) { setLoading(false); return; }
    setHospitalId(ud.hospital_id);
    setRole((ud as any).role ?? null);
    fetchDayCarePolicy(ud.hospital_id).then(setPolicy);

    // A booking has admitted_at NULL and scheduled_at set, so the tab decides which column
    // the date picker filters on — see lib/dayCareBoard.ts.
    const dateCol = dayCareDateColumn(view);

    const { data, error } = await (supabase as any)
      .from("admissions")
      .select(`
        id, patient_id, admission_number, admitted_at, scheduled_at, admitting_diagnosis,
        insurance_type, status, cancellation_reason, cancellation_note,
        patient:patients(full_name, uhid),
        doctor:users!admissions_admitting_doctor_id_fkey(full_name),
        procedure:day_care_procedures(procedure_name, duration_minutes, standard_rate)
      `)
      .eq("hospital_id", ud.hospital_id)
      .eq("admission_type", "daycare")
      .in("status", dayCareStatusFilter(view))
      .gte(dateCol, `${selectedDate}T00:00:00+05:30`)
      .lte(dateCol, `${selectedDate}T23:59:59+05:30`)
      .order(dateCol, { ascending: dayCareSortAscending(view) });

    if (error) { console.error("Day care fetch:", error.message); setLoading(false); return; }

    const rows: DayCareAdmission[] = (data || []).map((a: any) => ({
      id: a.id,
      patient_id: a.patient_id,
      patient_name: a.patient?.full_name || "—",
      uhid: a.patient?.uhid || "",
      admission_number: a.admission_number,
      admitted_at: a.admitted_at,
      scheduled_at: a.scheduled_at,
      admitting_diagnosis: a.admitting_diagnosis,
      doctor_name: a.doctor?.full_name || "—",
      insurance_type: a.insurance_type,
      procedure_name: a.procedure?.procedure_name || null,
      duration_minutes: a.procedure?.duration_minutes || null,
      standard_rate: Number(a.procedure?.standard_rate) || 0,
      status: a.status,
      cancellation_reason: a.cancellation_reason ?? null,
      cancellation_note: a.cancellation_note ?? null,
    }));

    setAdmissions(rows);
    setLoading(false);
  }, [view, selectedDate]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  const filtered = admissions.filter(a =>
    !search ||
    a.patient_name.toLowerCase().includes(search.toLowerCase()) ||
    a.admission_number.toLowerCase().includes(search.toLowerCase()) ||
    (a.procedure_name || "").toLowerCase().includes(search.toLowerCase())
  );

  const selected = admissions.find(a => a.id === selectedId) || null;
  const reasonLabels = useConfigLabelMap("cancellation_reasons");

  /** Gate check first — only admit if financially cleared, else explain why not. */
  const requestAdmit = async (a: DayCareAdmission) => {
    if (!hospitalId) return;
    const clearance = await checkDayCareClearance(hospitalId, a.id);
    if (clearance.cleared) {
      await admitDayCare(a);
    } else {
      setGate({ admission: a, clearance });
    }
  };

  /**
   * Convert the booking into a real admission, then bill the procedure.
   *
   * The DB trigger enforce_daycare_financial_clearance() re-checks clearance on this exact
   * transition, so a stale UI cannot let anyone in.
   */
  const admitDayCare = async (a: DayCareAdmission, overrideReason?: string) => {
    if (!hospitalId || admitting) return;
    setAdmitting(true);
    const now = new Date().toISOString();
    const userId = await getCurrentUserRowId();

    const { error } = await (supabase as any)
      .from("admissions")
      .update({
        status: "active",
        admitted_at: now,
        financial_clearance_at: now,
        financial_clearance_by: userId,
        ...(overrideReason
          ? {
              financial_override_reason: overrideReason,
              financial_override_by: userId,
              financial_override_at: now,
            }
          : {}),
      })
      .eq("id", a.id);

    if (error) {
      // The trigger's message already names the shortfall — surface it verbatim.
      toast({ title: "Admission blocked", description: error.message, variant: "destructive" });
      setAdmitting(false);
      return;
    }

    setGate(null);
    toast({ title: "Patient admitted", description: `${a.patient_name} — ${a.procedure_name || "day care"}` });

    // Billing is non-blocking: the patient is already admitted, so a billing hiccup must
    // warn rather than strand them. Same posture as the discharge flow.
    try {
      await chargeDayCareProcedure({
        hospitalId,
        patientId: a.patient_id,
        admissionId: a.id,
        procedure: {
          id: a.id,
          procedure_name: a.procedure_name || a.admitting_diagnosis,
          standard_rate: a.standard_rate,
        },
        performedBy: userId,
      });
      await (supabase as any).from("admissions").update({ day_care_billed_at: now }).eq("id", a.id);

      // The deposit was collected BEFORE the bill existed, so syncAdvanceToBill returned
      // null at the time. Now that the bill exists, mirror it in. Idempotent.
      const { data: bal } = await (supabase as any)
        .from("ipd_advance_balances").select("balance").eq("admission_id", a.id).maybeSingle();
      const balance = Number(bal?.balance) || 0;
      if (balance > 0) {
        await syncAdvanceToBill({
          admissionId: a.id,
          hospitalId,
          amount: balance,
          paymentMode: "cash",
          userId,
          notes: "Day care deposit",
        });
      }
    } catch (e: any) {
      toast({
        title: "Procedure not billed",
        description: `${e?.message || "Unknown error"} — add it in Billing.`,
        variant: "destructive",
      });
    }

    setView("active");
    setSelectedDate(todayStr());
    setSelectedId(a.id);
    setAdmitting(false);
  };

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-white shrink-0">
        <div className="flex items-center gap-3">
          <Stethoscope size={20} className="text-teal-600" />
          <div>
            <h1 className="text-base font-semibold">Day Care Unit</h1>
            <p className="text-xs text-muted-foreground">Same-day procedure management</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchData()} className="gap-1">
            <RefreshCw size={13} />
            Refresh
          </Button>
          <Button size="sm" className="bg-teal-600 hover:bg-teal-700 gap-1" onClick={() => setAdmitOpen(true)}>
            <Plus size={14} />
            Book Procedure
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — patient list */}
        <div className="w-80 flex flex-col border-r bg-white shrink-0">
          {/* Date bar */}
          <div className="px-3 pt-3 pb-2 border-b space-y-2">
            <div className="flex items-center gap-1.5">
              {[
                { label: "Today", val: todayStr() },
                { label: "Yesterday", val: yesterdayStr() },
              ].map(d => (
                <button
                  key={d.val}
                  onClick={() => { setSelectedDate(d.val); setSelectedId(null); }}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors",
                    selectedDate === d.val
                      ? "bg-teal-600 text-white"
                      : "bg-muted text-muted-foreground hover:bg-muted/70"
                  )}
                >
                  {d.label}
                </button>
              ))}
              <input
                type="date"
                value={selectedDate}
                onChange={e => { setSelectedDate(e.target.value); setSelectedId(null); }}
                className="ml-auto text-[11px] bg-card border border-border rounded px-1.5 py-1 text-foreground"
              />
            </div>

            {/* Status tabs */}
            <div className="flex gap-1">
              {([
                { v: "scheduled" as const, label: "Scheduled" },
                { v: "active" as const, label: "Active" },
                { v: "discharged" as const, label: "Discharged" },
                { v: "cancelled" as const, label: "Cancelled" },
              ]).map(t => (
                <button
                  key={t.v}
                  onClick={() => { setView(t.v); setSelectedId(null); }}
                  className={cn(
                    "flex-1 text-[11px] py-1 rounded font-medium transition-colors",
                    view === t.v ? "bg-teal-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8 h-8 text-xs"
                placeholder="Search patient, procedure…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading && <p className="text-xs text-muted-foreground text-center p-4">Loading…</p>}
            {!loading && filtered.length === 0 && (
              <p className="text-xs text-muted-foreground text-center p-6">
                {view === "scheduled" ? "No procedures booked for this date."
                  : view === "active" ? "No active day care patients."
                  : "No discharges on this date."}
              </p>
            )}
            {filtered.map(a => (
              <button
                key={a.id}
                onClick={() => setSelectedId(a.id)}
                className={cn(
                  "w-full text-left px-3 py-3 border-b hover:bg-muted/40 transition-colors",
                  selectedId === a.id && "bg-teal-50 border-l-2 border-l-teal-500"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium truncate">{a.patient_name}</span>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {a.insurance_type.replace("_", " ")}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{a.procedure_name || a.admitting_diagnosis}</div>
                <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2">
                  {view === "scheduled" ? <CalendarClock size={10} /> : <Clock size={10} />}
                  {formatDateIST((view === "scheduled" ? a.scheduled_at : a.admitted_at) || "")}
                  {a.duration_minutes && <span>· {a.duration_minutes} min</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right panel — detail */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
              <Stethoscope size={40} className="text-muted-foreground/30" />
              <p className="text-sm">Select a patient to view details</p>
            </div>
          ) : (
            <div className="max-w-xl space-y-5">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-semibold">{selected.patient_name}</h2>
                  <p className="text-xs text-muted-foreground">{selected.admission_number}</p>
                </div>
                <div className="flex gap-2 flex-wrap justify-end">
                  {view === "scheduled" && (
                    <>
                      <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground"
                        onClick={() => setCancelTarget({ admission: selected, mode: "no_show" })}>
                        <UserX size={13} />
                        No-Show
                      </Button>
                      <Button variant="ghost" size="sm" className="gap-1 text-red-600 hover:text-red-700"
                        onClick={() => setCancelTarget({ admission: selected, mode: "cancelled" })}>
                        <XCircle size={13} />
                        Cancel
                      </Button>
                      <Button variant="outline" size="sm" className="gap-1"
                        onClick={() => setRescheduleFor(selected)}>
                        <CalendarClock size={13} />
                        Reschedule
                      </Button>
                      <Button variant="outline" size="sm" className="gap-1" onClick={() => setEstimateFor(selected)}>
                        <IndianRupee size={13} />
                        Estimate &amp; Deposit
                      </Button>
                      <Button
                        size="sm"
                        className="bg-teal-600 hover:bg-teal-700 gap-1"
                        onClick={() => requestAdmit(selected)}
                        disabled={admitting}
                      >
                        <LogIn size={13} />
                        {admitting ? "Admitting…" : "Admit Patient"}
                      </Button>
                    </>
                  )}
                  {view === "active" && (
                    <Button
                      size="sm"
                      className="bg-teal-600 hover:bg-teal-700 gap-1"
                      onClick={() => setDischargeTarget({
                        admissionId: selected.id,
                        patientName: selected.patient_name,
                        procedureName: selected.procedure_name || selected.admitting_diagnosis,
                      })}
                    >
                      <LogOut size={13} />
                      Discharge
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <DetailCard label="Procedure" value={selected.procedure_name || selected.admitting_diagnosis} />
                <DetailCard label="Duration" value={selected.duration_minutes ? `${selected.duration_minutes} min` : "—"} />
                <DetailCard label="Doctor" value={selected.doctor_name} icon={<User size={12} />} />
                {view === "scheduled" ? (
                  <DetailCard label="Scheduled" value={formatDateIST(selected.scheduled_at || "")} icon={<CalendarClock size={12} />} />
                ) : (
                  <DetailCard label="Admitted" value={formatDateIST(selected.admitted_at || "")} icon={<Clock size={12} />} />
                )}
                <DetailCard label="Payer" value={selected.insurance_type.replace("_", " ").toUpperCase()} />
              </div>

              {view === "scheduled" && (
                <div className="bg-sky-50 border border-sky-200 rounded-lg p-3">
                  <p className="text-xs text-sky-800 font-medium">
                    Booked for {formatDateIST(selected.scheduled_at || "")} — not yet admitted
                  </p>
                  <p className="text-xs text-sky-700 mt-0.5">
                    Give the estimate and collect the deposit, then admit when the patient reports.
                  </p>
                </div>
              )}

              {view === "cancelled" && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-xs text-red-800 font-medium">
                    {selected.status === "no_show" ? "Patient did not report (no-show)" : "Booking cancelled"}
                    {" — was booked for "}{formatDateIST(selected.scheduled_at || "")}
                  </p>
                  <p className="text-xs text-red-700 mt-0.5">
                    {reasonLabels[selected.cancellation_reason || ""] || selected.cancellation_reason || "No reason recorded"}
                    {selected.cancellation_note ? ` — ${selected.cancellation_note}` : ""}
                  </p>
                </div>
              )}

              {view !== "scheduled" && hospitalId && (
                <DayCareFinancialPanel hospitalId={hospitalId} admissionId={selected.id} />
              )}

              {view === "active" && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs text-amber-800 font-medium">Same-day discharge required</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Day care patients must be discharged before midnight (IST) on the day of admission.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {hospitalId && (
        <DayCareAdmissionModal
          open={admitOpen}
          onClose={() => setAdmitOpen(false)}
          hospitalId={hospitalId}
          onBooked={(b) => {
            // Jump the board to where the booking actually landed. Without this, booking for
            // a future date shows nothing (the board is still on today's Scheduled list) and
            // reads as a silent failure.
            setView("scheduled");
            setSelectedDate(b.scheduledDate);
            setSelectedId(b.admissionId);
            setPendingEstimate(b);
          }}
        />
      )}

      {/* Estimate & Deposit — reuses AdmitPatientModal's estimate-only mode rather than a
          day-care-specific modal, so counselling behaves identically to IPD. */}
      {hospitalId && (pendingEstimate || estimateFor) && (
        <AdmitPatientModal
          open
          hospitalId={hospitalId}
          onClose={() => { setPendingEstimate(null); setEstimateFor(null); }}
          onAdmitted={() => { setPendingEstimate(null); setEstimateFor(null); fetchData(); }}
          estimateOnlyMode
          existingAdmissionId={pendingEstimate?.admissionId || estimateFor?.id}
          existingPatient={
            pendingEstimate
              ? { id: pendingEstimate.patientId, full_name: pendingEstimate.patientName, uhid: pendingEstimate.uhid }
              : estimateFor
              ? { id: estimateFor.patient_id, full_name: estimateFor.patient_name, uhid: estimateFor.uhid }
              : null
          }
          prefillEstimatedDays={1}
          prefillEstimatedAmount={pendingEstimate?.standardRate ?? estimateFor?.standard_rate ?? 0}
          prefillDepositRequired={deriveDepositDefault(
            pendingEstimate?.standardRate ?? estimateFor?.standard_rate ?? 0,
            policy,
          )}
        />
      )}

      {hospitalId && gate && (
        <DayCareAdmitGateModal
          open
          onClose={() => setGate(null)}
          hospitalId={hospitalId}
          admissionId={gate.admission.id}
          patient={{ id: gate.admission.patient_id, full_name: gate.admission.patient_name, uhid: gate.admission.uhid }}
          clearance={gate.clearance}
          policy={policy}
          role={role}
          onRecheck={async () => {
            const fresh = await checkDayCareClearance(hospitalId, gate.admission.id);
            if (fresh.cleared) await admitDayCare(gate.admission);
            else setGate({ admission: gate.admission, clearance: fresh });
          }}
          onAdmit={(reason) => admitDayCare(gate.admission, reason)}
        />
      )}

      {hospitalId && cancelTarget && (
        <DayCareCancelModal
          open
          onClose={() => setCancelTarget(null)}
          mode={cancelTarget.mode}
          hospitalId={hospitalId}
          admissionId={cancelTarget.admission.id}
          patient={{
            id: cancelTarget.admission.patient_id,
            full_name: cancelTarget.admission.patient_name,
            uhid: cancelTarget.admission.uhid,
          }}
          procedureName={cancelTarget.admission.procedure_name || cancelTarget.admission.admitting_diagnosis}
          onDone={() => {
            // Follow the booking to where it landed, so the action visibly did something.
            setCancelTarget(null);
            setView("cancelled");
            setSelectedId(null);
          }}
        />
      )}

      {hospitalId && rescheduleFor && (
        <DayCareRescheduleModal
          open
          onClose={() => setRescheduleFor(null)}
          hospitalId={hospitalId}
          admissionId={rescheduleFor.id}
          patientName={rescheduleFor.patient_name}
          procedureName={rescheduleFor.procedure_name || rescheduleFor.admitting_diagnosis}
          currentScheduledAt={rescheduleFor.scheduled_at}
          onDone={(newDate) => {
            // Jump to the new date, otherwise the booking vanishes from the current view.
            setRescheduleFor(null);
            setView("scheduled");
            setSelectedDate(newDate);
          }}
        />
      )}

      {dischargeTarget && (
        <DayCareDischargeModal
          open={!!dischargeTarget}
          onClose={() => setDischargeTarget(null)}
          admissionId={dischargeTarget.admissionId}
          patientName={dischargeTarget.patientName}
          procedureName={dischargeTarget.procedureName}
          onDischarged={() => { setDischargeTarget(null); setSelectedId(null); fetchData(); }}
        />
      )}
    </div>
  );
};

const DetailCard: React.FC<{ label: string; value: string; icon?: React.ReactNode }> = ({ label, value, icon }) => (
  <div className="bg-muted/40 rounded-lg p-3">
    <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1">{icon}{label}</div>
    <div className="text-sm font-medium">{value}</div>
  </div>
);

export default DayCarePage;

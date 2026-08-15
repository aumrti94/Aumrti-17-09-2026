import React, { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { autoPostJournalEntry } from "@/lib/accounting";
import { recalculateBillTotalsSafe } from "@/lib/billTotals";
import { sendWhatsApp } from "@/lib/whatsapp-send";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  Video, Plus, User, Clock, CheckCircle2, Send, Phone, CalendarClock,
  AlertTriangle, CreditCard, ShieldAlert,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import ScheduleTeleconsultModal from "@/components/telemedicine/ScheduleTeleconsultModal";
import ComplaintTab from "@/components/opd/tabs/ComplaintTab";
import RxOrdersTab from "@/components/opd/tabs/RxOrdersTab";
import type { EncounterData, PrescriptionData } from "@/components/opd/ConsultationWorkspace";

const STATUS_COLORS: Record<string, string> = {
  scheduled:   "bg-blue-100 text-blue-700",
  waiting:     "bg-amber-100 text-amber-700",
  in_progress: "bg-emerald-100 text-emerald-700",
  completed:   "bg-muted text-muted-foreground",
  missed:      "bg-red-100 text-red-700",
  cancelled:   "bg-muted text-muted-foreground",
};

const EMPTY_ENCOUNTER: EncounterData = {
  chief_complaint: "", history_of_present_illness: "", vitals: {},
  examination_notes: "", soap_subjective: "", soap_objective: "",
  soap_assessment: "", soap_plan: "", diagnosis: "", icd10_code: "",
  follow_up_date: "", follow_up_notes: "",
  ai_clarifying_questions: null,
};

const EMPTY_PRESCRIPTION: PrescriptionData = {
  drugs: [], lab_orders: [], radiology_orders: [],
  advice_notes: "", review_date: "", is_signed: false,
};

function formatTimer(sec: number): string {
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

interface PaymentGate {
  session: any;
  bill: { id: string; bill_number: string; total_amount: number; payment_status: string } | null;
  canOverride: boolean;
}

const DoctorTeleconsultPage: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();

  const [sessions, setSessions] = useState<any[]>([]);
  const [queueTab, setQueueTab] = useState("waiting");
  const [activeSession, setActiveSession] = useState<any>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const [endingCall, setEndingCall] = useState(false);

  const [encounter, setEncounter] = useState<EncounterData>(EMPTY_ENCOUNTER);
  const [prescription, setPrescription] = useState<PrescriptionData>(EMPTY_PRESCRIPTION);
  const [encounterId, setEncounterId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<"notes" | "rx">("notes");

  const [userRole, setUserRole] = useState<string | null>(null);
  const [paymentGate, setPaymentGate] = useState<PaymentGate | null>(null);
  const [checkingPayment, setCheckingPayment] = useState(false);

  const fetchSessions = useCallback(async () => {
    if (!hospitalId) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const { data } = await supabase
      .from("teleconsult_sessions")
      .select("*, patients(full_name, uhid, phone, gender, allergies, dob)")
      .eq("hospital_id", hospitalId)
      .gte("scheduled_at", today.toISOString())
      .lt("scheduled_at", tomorrow.toISOString())
      .order("scheduled_at", { ascending: true });
    setSessions(data || []);
  }, [hospitalId]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("users").select("role")
        .eq("auth_user_id", user.id).maybeSingle();
      if (data?.role) setUserRole(data.role);
    })();
  }, []);

  useEffect(() => {
    if (!hospitalId) return;
    const ch = supabase
      .channel("doctor-teleconsult-rt")
      .on("postgres_changes", {
        event: "UPDATE", schema: "public",
        table: "teleconsult_sessions",
        filter: `hospital_id=eq.${hospitalId}`,
      }, () => fetchSessions())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [hospitalId, fetchSessions]);

  useEffect(() => {
    if (!activeSession || activeSession.status !== "in_progress") return;
    const iv = setInterval(() => setCallSeconds(s => s + 1), 1000);
    return () => clearInterval(iv);
  }, [activeSession]);

  const joinCall = useCallback(async (session: any) => {
    await supabase
      .from("teleconsult_sessions")
      .update({ status: "in_progress", doctor_joined_at: new Date().toISOString() })
      .eq("id", session.id);
    setActiveSession({ ...session, status: "in_progress" });
    setCallSeconds(0);
    setEncounter({ ...EMPTY_ENCOUNTER, soap_plan: session.notes || "" });
    setPrescription(EMPTY_PRESCRIPTION);
    setEncounterId(null);
    setRightTab("notes");
    fetchSessions();
  }, [fetchSessions]);

  // Checks hospital prepayment policy before allowing a session to start.
  // If payment is required and unpaid, opens the gate modal instead of joining.
  const checkPaymentAndJoin = useCallback(async (session: any) => {
    if (!hospitalId) return;
    setCheckingPayment(true);
    try {
      // Fetch hospital setting (key = "teleconsult_payment")
      const { data: settingRow } = await (supabase as any)
        .from("hospital_settings")
        .select("value")
        .eq("hospital_id", hospitalId)
        .eq("key", "teleconsult_payment")
        .maybeSingle();

      const setting = (settingRow?.value ?? {}) as Record<string, unknown>;
      const requirePrepayment = (setting.require_prepayment as boolean | undefined) ?? false;
      const overrideRoles = (setting.override_roles as string[] | undefined) ?? ["admin"];

      if (!requirePrepayment) {
        await joinCall(session);
        return;
      }

      // Prepayment is required — look up the advance bill
      let bill: PaymentGate["bill"] = null;

      // 1. Session has a pre-linked bill_id (set at booking time)
      if (session.bill_id) {
        const { data } = await (supabase as any)
          .from("bills")
          .select("id, bill_number, total_amount, payment_status")
          .eq("id", session.bill_id)
          .maybeSingle();
        bill = data ?? null;
      }

      // 2. Fallback: most recent unpaid OPD bill for this patient today
      if (!bill && session.patient_id) {
        const today = new Date().toISOString().split("T")[0];
        const { data } = await (supabase as any)
          .from("bills")
          .select("id, bill_number, total_amount, payment_status")
          .eq("hospital_id", hospitalId)
          .eq("patient_id", session.patient_id)
          .eq("bill_date", today)
          .eq("bill_type", "opd")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        bill = data ?? null;
      }

      if (bill?.payment_status === "paid") {
        await joinCall(session);
        return;
      }

      // Payment pending — show gate modal
      const canOverride = overrideRoles.includes(userRole ?? "");
      setPaymentGate({ session, bill, canOverride });
    } finally {
      setCheckingPayment(false);
    }
  }, [hospitalId, userRole, joinCall]);

  const endCall = async () => {
    if (!activeSession || endingCall) return;
    setEndingCall(true);
    try {
      const now = new Date().toISOString();
      const durationMin = Math.ceil(callSeconds / 60);

      await supabase.from("teleconsult_sessions").update({
        status: "completed",
        ended_at: now,
        actual_duration: callSeconds,
        notes: encounter.soap_plan,
      }).eq("id", activeSession.id);

      if (hospitalId && activeSession.patient_id) {
        try {
          const { data: authData } = await supabase.auth.getUser();
          const { data: doctorRow } = await supabase
            .from("users")
            .select("id")
            .eq("auth_user_id", authData?.user?.id || "")
            .maybeSingle();
          const doctorId = doctorRow?.id;

          if (doctorId) {
            const { data: enc } = await (supabase as any)
              .from("opd_encounters")
              .insert({
                hospital_id: hospitalId,
                token_id: activeSession.opd_token_id || null,
                patient_id: activeSession.patient_id,
                doctor_id: doctorId,
                visit_date: now.split("T")[0],
                chief_complaint: encounter.chief_complaint || null,
                history_of_present_illness: encounter.history_of_present_illness || null,
                diagnosis: encounter.diagnosis || null,
                soap_plan: encounter.soap_plan || null,
                visit_mode: "teleconsult",
              })
              .select("id")
              .maybeSingle();

            const savedEncId: string | null = enc?.id ?? null;
            setEncounterId(savedEncId);

            const hasPrescription = prescription.drugs.length > 0 || prescription.lab_orders.length > 0 || prescription.radiology_orders.length > 0;
            if (savedEncId && hasPrescription) {
              await (supabase as any).from("prescriptions").insert({
                hospital_id: hospitalId,
                encounter_id: savedEncId,
                patient_id: activeSession.patient_id,
                doctor_id: doctorId,
                drugs: prescription.drugs,
                advice_notes: prescription.advice_notes || null,
                is_signed: true,
                signed_at: now,
                source: "teleconsult",
              });

              if (prescription.lab_orders.length > 0) {
                const { data: labOrder } = await supabase.from("lab_orders").insert({
                  hospital_id: hospitalId,
                  encounter_id: savedEncId,
                  patient_id: activeSession.patient_id,
                  ordered_by: doctorId,
                  status: "ordered",
                  urgency: "routine",
                } as any).select("id").maybeSingle();

                if (labOrder?.id) {
                  const items = prescription.lab_orders.map(l => ({
                    lab_order_id: labOrder.id,
                    test_name: l.test_name,
                    urgency: l.urgency || "routine",
                    clinical_indication: l.clinical_indication || null,
                    status: "pending",
                  }));
                  await (supabase as any).from("lab_order_items").insert(items);
                }
              }

              for (const rad of prescription.radiology_orders) {
                await supabase.from("radiology_orders").insert({
                  hospital_id: hospitalId,
                  encounter_id: savedEncId,
                  patient_id: activeSession.patient_id,
                  ordered_by: doctorId,
                  study_name: rad.study_name,
                  urgency: rad.urgency || "routine",
                  clinical_indication: rad.clinical_indication || null,
                  status: "ordered",
                } as any);
              }
            }
          }
        } catch {
          // encounter/rx save is non-fatal — billing still proceeds
        }
      }

      // Auto-bill
      try {
        if (hospitalId && activeSession.patient_id) {
          let fee = 300;
          const { data: teleService } = await (supabase as any)
            .from("service_master").select("rate")
            .eq("hospital_id", hospitalId).eq("item_type", "consultation")
            .ilike("name", "%tele%").maybeSingle();
          if (teleService?.rate) {
            fee = teleService.rate;
          } else {
            const { data: generic } = await (supabase as any)
              .from("service_master").select("rate")
              .eq("hospital_id", hospitalId).eq("item_type", "consultation")
              .limit(1).maybeSingle();
            if (generic?.rate) fee = generic.rate;
          }

          const billNumber = await generateBillNumber(hospitalId, "TELE");
          const patientName = activeSession.patients?.full_name || "Patient";

          const { data: bill } = await (supabase as any).from("bills").insert({
            hospital_id: hospitalId,
            patient_id: activeSession.patient_id,
            bill_number: billNumber,
            bill_date: now.split("T")[0],
            bill_type: "opd", bill_status: "final", payment_status: "unpaid",
            subtotal: fee, gst_amount: 0, total_amount: fee,
            patient_payable: fee, paid_amount: 0, balance_due: fee,
          }).select().maybeSingle();

          if (bill) {
            // Guard: never insert a second consultation line if one already exists
            const { data: existingConsult } = await (supabase as any)
              .from("bill_line_items")
              .select("id")
              .eq("bill_id", bill.id)
              .eq("item_type", "consultation")
              .maybeSingle();

            if (!existingConsult) {
              await (supabase as any).from("bill_line_items").insert({
                hospital_id: hospitalId, bill_id: bill.id,
                item_type: "consultation",
                description: `Teleconsultation - ${patientName} - ${durationMin}min`,
                quantity: 1, unit_rate: fee, taxable_amount: fee,
                gst_percent: 0, gst_amount: 0, total_amount: fee,
                source_module: "telemedicine",
              });
            }
            await recalculateBillTotalsSafe(bill.id);
            await supabase.from("teleconsult_sessions").update({ bill_generated: true, bill_id: bill.id } as any).eq("id", activeSession.id);
            const { data: authData } = await supabase.auth.getUser();
            await autoPostJournalEntry({
              triggerEvent: "bill_created", sourceModule: "telemedicine",
              sourceId: bill.id, amount: fee,
              description: `Teleconsultation bill ${billNumber}`,
              hospitalId, postedBy: authData?.user?.id || "system",
            });
            toast({ title: `Session completed · Billed ₹${fee.toLocaleString("en-IN")}` });
          } else {
            toast({ title: "Session completed" });
          }
        } else {
          toast({ title: "Session completed" });
        }
      } catch {
        toast({ title: "Session completed (billing skipped)" });
      }

      setActiveSession(null);
      setCallSeconds(0);
      setEncounter(EMPTY_ENCOUNTER);
      setPrescription(EMPTY_PRESCRIPTION);
      setEncounterId(null);
      fetchSessions();
    } finally {
      setEndingCall(false);
    }
  };

  const sendEPrescription = async () => {
    const phone = activeSession?.patient_phone || activeSession?.patients?.phone;
    if (!phone || prescription.drugs.length === 0) return;
    const lines = prescription.drugs
      .map((d, i) => `${i + 1}. ${d.drug_name} ${d.dose} — ${d.frequency} × ${d.duration_days} days`)
      .join("\n");
    const advice = prescription.advice_notes ? `\n\nAdvice: ${prescription.advice_notes}` : "";
    const msg = `💊 ePrescription\n\n${lines}${advice}\n\n— Your doctor via Aumrti HMS`;
    if (hospitalId) await sendWhatsApp({ hospitalId, phone, message: msg });
    await supabase.from("teleconsult_sessions").update({ prescription_sent: true }).eq("id", activeSession.id);
    toast({ title: "ePrescription sent via WhatsApp" });
  };

  const filtered = sessions.filter(s => {
    if (queueTab === "waiting")   return s.status === "waiting" || s.status === "in_progress";
    if (queueTab === "scheduled") return s.status === "scheduled";
    return s.status === "completed" || s.status === "missed" || s.status === "cancelled";
  });

  const patient = activeSession?.patients;
  const patientAllergies: string[] = patient?.allergies
    ? (typeof patient.allergies === "string"
        ? patient.allergies.split(",").map((a: string) => a.trim()).filter(Boolean)
        : [])
    : [];

  return (
    <div className="flex h-[calc(100vh-56px)] overflow-hidden">

      {/* ── LEFT: Queue ─────────────────────────────────────────────── */}
      <div className="w-[280px] shrink-0 bg-background border-r border-border flex flex-col">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-bold">Teleconsults</h2>
            <p className="text-xs text-muted-foreground">{format(new Date(), "dd MMM yyyy")}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowSchedule(true)} className="gap-1 text-xs h-7">
            <Plus size={12} /> Schedule
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 border-b border-border shrink-0">
          {[
            { label: "Waiting",  value: sessions.filter(s => s.status === "waiting").length,   color: "text-amber-600" },
            { label: "Done",     value: sessions.filter(s => s.status === "completed").length, color: "text-emerald-600" },
            { label: "Missed",   value: sessions.filter(s => s.status === "missed").length,    color: "text-red-500" },
          ].map(stat => (
            <div key={stat.label} className="py-2 text-center border-r border-border last:border-r-0">
              <p className={`text-base font-bold ${stat.color}`}>{stat.value}</p>
              <p className="text-[10px] text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>

        <Tabs value={queueTab} onValueChange={setQueueTab} className="px-2 pt-2 shrink-0">
          <TabsList className="w-full">
            <TabsTrigger value="waiting"   className="flex-1 text-xs">Waiting</TabsTrigger>
            <TabsTrigger value="scheduled" className="flex-1 text-xs">Scheduled</TabsTrigger>
            <TabsTrigger value="completed" className="flex-1 text-xs">Done</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">No sessions</p>
          )}
          {filtered.map(s => (
            <div
              key={s.id}
              className={cn(
                "rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors",
                activeSession?.id === s.id && "border-primary bg-primary/5"
              )}
              onClick={() => s.status !== "completed" && s.status !== "cancelled" && checkPaymentAndJoin(s)}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium truncate max-w-[140px]">{s.patients?.full_name || "Patient"}</span>
                <Badge variant="secondary" className={cn("text-[10px] shrink-0", STATUS_COLORS[s.status])}>
                  {s.status === "waiting" && (
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 mr-1 animate-pulse" />
                  )}
                  {s.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <CalendarClock size={10} />
                {format(new Date(s.scheduled_at), "hh:mm a")} · {s.duration_minutes} min
              </p>
              {s.patients?.phone && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Phone size={10} /> {s.patients.phone}
                </p>
              )}
              {(s.status === "waiting" || s.status === "scheduled") && (
                <Button
                  size="sm"
                  className="mt-2 w-full gap-1 h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                  disabled={checkingPayment}
                  onClick={e => { e.stopPropagation(); checkPaymentAndJoin(s); }}
                >
                  {checkingPayment
                    ? <span className="h-3 w-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    : <Video size={12} />}
                  {checkingPayment ? "Checking…" : "Join Call"}
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── CENTER: Video ────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 bg-[#0F172A] flex flex-col">
        {!activeSession ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <Video size={56} className="text-white/15" />
            <p className="text-base text-white/50 font-medium">No active session</p>
            <p className="text-sm text-white/30">Select a waiting patient from the queue to begin</p>
          </div>
        ) : (
          <>
            <iframe
              src={`https://meet.jit.si/HMS-${activeSession.room_id || activeSession.id}?userDisplayName=Doctor#config.prejoinPageEnabled=false`}
              allow="camera; microphone; fullscreen; display-capture; autoplay"
              className="flex-1 w-full border-none"
              title="Teleconsult Video"
            />
            {/* Call control bar */}
            <div className="h-14 bg-black/75 flex items-center px-4 gap-3 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <User size={14} className="text-white/60 shrink-0" />
                <span className="text-sm text-white font-medium truncate">{patient?.full_name}</span>
                {patient?.uhid && (
                  <span className="text-xs text-white/40 shrink-0">· {patient.uhid}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 ml-auto shrink-0">
                <Clock size={13} className="text-white/50" />
                <span className="text-sm text-white font-mono font-bold tabular-nums">
                  {formatTimer(callSeconds)}
                </span>
              </div>
              <Button
                size="sm"
                variant="destructive"
                className="gap-1.5 shrink-0 h-8"
                onClick={endCall}
                disabled={endingCall}
              >
                {endingCall
                  ? <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  : <CheckCircle2 size={14} />}
                {endingCall ? "Saving…" : "End Call & Complete"}
              </Button>
            </div>
          </>
        )}
      </div>

      {/* ── RIGHT: Clinical Tabs ─────────────────────────────────────── */}
      <div className="w-[380px] shrink-0 bg-background border-l border-border flex flex-col overflow-hidden">
        {!activeSession ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <Video size={32} className="text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Join a session to access clinical notes and prescription tools</p>
          </div>
        ) : (
          <>
            {/* Patient header strip */}
            <div className="px-4 py-2.5 border-b border-border shrink-0 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm font-bold truncate">{patient?.full_name}</p>
                <p className="text-xs text-muted-foreground">
                  {patient?.uhid}{patient?.gender ? ` · ${patient.gender}` : ""}
                </p>
              </div>
              {activeSession.prescription_sent && (
                <Badge variant="secondary" className="text-[10px] text-emerald-600 bg-emerald-50 shrink-0">
                  Rx Sent
                </Badge>
              )}
            </div>

            {/* Tab switcher */}
            <div className="px-3 pt-2 shrink-0">
              <Tabs value={rightTab} onValueChange={v => setRightTab(v as "notes" | "rx")}>
                <TabsList className="w-full">
                  <TabsTrigger value="notes" className="flex-1 text-xs">Clinical Notes</TabsTrigger>
                  <TabsTrigger value="rx"    className="flex-1 text-xs">Prescription</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-hidden">

              {/* Clinical Notes tab */}
              {rightTab === "notes" && (
                <div className="h-full overflow-y-auto flex flex-col">
                  {/* ComplaintTab handles chief complaint, duration, onset, quick chips */}
                  <ComplaintTab
                    encounter={encounter}
                    onChange={partial => setEncounter(e => ({ ...e, ...partial }))}
                  />

                  {/* Diagnosis */}
                  <div className="px-4 pb-3 shrink-0">
                    <label className="text-xs font-bold text-slate-700 mb-1.5 block">Diagnosis</label>
                    <Input
                      placeholder="Primary diagnosis…"
                      value={encounter.diagnosis}
                      onChange={e => setEncounter(enc => ({ ...enc, diagnosis: e.target.value }))}
                      className="text-xs h-8"
                    />
                  </div>

                  {/* SOAP / Notes */}
                  <div className="px-4 pb-4 shrink-0">
                    <label className="text-xs font-bold text-slate-700 mb-1.5 block">Notes & Plan</label>
                    <Textarea
                      rows={4}
                      placeholder="Treatment plan, follow-up instructions, advice…"
                      value={encounter.soap_plan}
                      onChange={e => setEncounter(enc => ({ ...enc, soap_plan: e.target.value }))}
                      className="text-xs resize-none"
                    />
                  </div>

                  {/* Follow-up date */}
                  <div className="px-4 pb-4 shrink-0">
                    <label className="text-xs font-bold text-slate-700 mb-1.5 block">Follow-up Date</label>
                    <Input
                      type="date"
                      value={encounter.follow_up_date}
                      onChange={e => setEncounter(enc => ({ ...enc, follow_up_date: e.target.value }))}
                      className="text-xs h-8"
                    />
                  </div>
                </div>
              )}

              {/* Prescription tab */}
              {rightTab === "rx" && (
                <div className="h-full flex flex-col overflow-hidden">
                  <div className="flex-1 overflow-hidden">
                    <RxOrdersTab
                      prescription={prescription}
                      onChange={partial => setPrescription(p => ({ ...p, ...partial }))}
                      hospitalId={hospitalId}
                      patientAllergies={patientAllergies}
                      diagnosis={encounter.diagnosis}
                      encounterId={encounterId}
                    />
                  </div>

                  {/* Send ePrescription */}
                  <div className="shrink-0 p-3 border-t border-border">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-1.5 text-emerald-600 border-emerald-300 hover:bg-emerald-50 text-xs"
                      onClick={sendEPrescription}
                      disabled={prescription.drugs.length === 0}
                    >
                      <Send size={12} /> Send ePrescription on WhatsApp
                    </Button>
                    {prescription.drugs.length === 0 && (
                      <p className="text-[10px] text-muted-foreground text-center mt-1">Add drugs above to enable</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Payment Gate Modal ───────────────────────────────────────── */}
      <Dialog open={!!paymentGate} onOpenChange={open => { if (!open) setPaymentGate(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <AlertTriangle size={18} className="text-amber-600" />
              </div>
              <DialogTitle className="text-base">Payment Pending</DialogTitle>
            </div>
            <DialogDescription asChild>
              <div className="space-y-3 pt-1">
                <p className="text-sm text-foreground">
                  <span className="font-semibold">{paymentGate?.session?.patients?.full_name || "This patient"}</span> has not completed payment for this teleconsult session.
                </p>

                {/* Bill details */}
                <div className={cn(
                  "rounded-lg border p-3 text-sm",
                  paymentGate?.bill ? "bg-amber-50 border-amber-200" : "bg-muted border-border"
                )}>
                  {paymentGate?.bill ? (
                    <div className="flex items-start gap-2">
                      <CreditCard size={15} className="text-amber-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium text-amber-800">
                          Bill #{paymentGate.bill.bill_number} —{" "}
                          ₹{Number(paymentGate.bill.total_amount).toLocaleString("en-IN")}
                        </p>
                        <p className="text-xs text-amber-700 mt-0.5 capitalize">
                          Status: <span className="font-bold">{paymentGate.bill.payment_status}</span>
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-xs">No advance bill found for today's session. Patient may need to pay at the counter first.</p>
                  )}
                </div>

                {/* Override notice */}
                {paymentGate?.canOverride && (
                  <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <ShieldAlert size={15} className="text-blue-600 mt-0.5 shrink-0" />
                    <p className="text-xs text-blue-700">
                      Your role allows overriding this check. The override will be logged for audit purposes.
                    </p>
                  </div>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setPaymentGate(null)}
            >
              Cancel
            </Button>
            {paymentGate?.canOverride && (
              <Button
                variant="outline"
                className="flex-1 border-amber-300 text-amber-700 hover:bg-amber-50 gap-1.5"
                onClick={async () => {
                  const session = paymentGate.session;
                  setPaymentGate(null);
                  // Log the override
                  if (hospitalId) {
                    await supabase.from("clinical_alerts").insert({
                      hospital_id: hospitalId,
                      alert_type: "payment_override",
                      severity: "warning",
                      alert_message: `Teleconsult payment gate overridden by ${userRole} for patient ${session.patients?.full_name ?? session.patient_id} (session ${session.id}).`,
                    } as any).then(() => {});
                  }
                  toast({ title: "Override applied", description: "Starting session — payment collected later.", variant: "default" });
                  await joinCall(session);
                }}
              >
                <ShieldAlert size={13} /> Override & Join
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ScheduleTeleconsultModal
        open={showSchedule}
        onOpenChange={setShowSchedule}
        onCreated={fetchSessions}
      />
    </div>
  );
};

export default DoctorTeleconsultPage;

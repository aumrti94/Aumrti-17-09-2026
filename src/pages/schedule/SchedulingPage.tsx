import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, addDays, subDays, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ChevronLeft, ChevronRight, CalendarDays, Loader2, Bell,
  UserCheck, Ticket, XCircle, LayoutGrid, List,
} from "lucide-react";
import { toast } from "sonner";
import PatientSearchPicker from "@/components/shared/PatientSearchPicker";
import { sendWhatsApp } from "@/lib/whatsapp-send";
import { cn } from "@/lib/utils";
import NoShowRiskPanel from "@/components/schedule/NoShowRiskPanel";
import WalkInModal from "@/components/opd/WalkInModal";

// ── Types ─────────────────────────────────────────────────────────────────────

type DoctorSlot = {
  id: string;
  doctor_id: string;
  slot_date: string;
  slot_time: string;
  slot_duration_mins: number;
  max_patients: number;
  booked_count: number;
  slot_type: string;
  is_blocked: boolean;
  block_reason: string | null;
  doctor?: { full_name: string };
};

type Appt = {
  id: string;
  doctor_id: string;
  patient_id: string;
  appointment_date: string;
  slot_time: string;
  slot_id: string | null;
  status: string;
  visit_type: string;
  visit_purpose: string | null;
  chief_complaint: string | null;
  notes: string | null;
  consultation_fee: number;
  department_id: string | null;
  reminder_sent: boolean;
  booking_source: string | null;
  patient?: { full_name: string; uhid: string; phone: string | null };
};

type DoctorSummary = {
  doctor_id: string;
  doctor_name: string;
  total: number;
  open: number;
  partial: number;
  full: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(t: string): string {
  if (!t) return "";
  const parts = t.split(":").map(Number);
  const h = parts[0];
  const m = parts[1] || 0;
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = h % 12 || 12;
  return `${hr}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function slotEndTime(slotTime: string, durationMins: number): string {
  const [h, m] = slotTime.split(":").map(Number);
  const end = h * 60 + m + durationMins;
  return `${Math.floor(end / 60).toString().padStart(2, "0")}:${(end % 60).toString().padStart(2, "0")}`;
}

const STATUS_COLORS: Record<string, string> = {
  booked: "bg-blue-100 text-blue-700",
  confirmed: "bg-cyan-100 text-cyan-700",
  arrived: "bg-green-100 text-green-700",
  in_consultation: "bg-purple-100 text-purple-700",
  completed: "bg-slate-100 text-slate-600",
  no_show: "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-400",
  rescheduled: "bg-amber-100 text-amber-700",
};

// ── Main Page ─────────────────────────────────────────────────────────────────

const SchedulingPage: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const qc = useQueryClient();
  const [date, setDate] = useState<Date>(new Date());
  const [selectedDoctor, setSelectedDoctor] = useState<string | null>(null);
  const [panelView, setPanelView] = useState<"slots" | "queue">("slots");
  const [bookingSlot, setBookingSlot] = useState<DoctorSlot | null>(null);
  const [checkinAppt, setCheckinAppt] = useState<Appt | null>(null);
  const [viewingAppt, setViewingAppt] = useState<Appt | null>(null);
  const [reminding, setReminding] = useState(false);

  const dateStr = format(date, "yyyy-MM-dd");

  const { data: slots = [], isLoading: loadingSlots } = useQuery({
    queryKey: ["doctor-slots", hospitalId, dateStr],
    enabled: !!hospitalId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("doctor_slots")
        .select("*, doctor:users!doctor_slots_doctor_id_fkey(full_name)")
        .eq("hospital_id", hospitalId)
        .eq("slot_date", dateStr)
        .order("slot_time", { ascending: true });
      if (error) throw error;
      return (data || []) as DoctorSlot[];
    },
  });

  const { data: appointments = [] } = useQuery({
    queryKey: ["appointments", hospitalId, dateStr],
    enabled: !!hospitalId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("appointments")
        .select("id, doctor_id, patient_id, appointment_date, slot_time, slot_id, status, visit_type, visit_purpose, chief_complaint, notes, consultation_fee, department_id, reminder_sent, booking_source, patient:patients!appointments_patient_id_fkey(full_name, uhid, phone)")
        .eq("hospital_id", hospitalId)
        .eq("appointment_date", dateStr)
        .neq("status", "cancelled")
        .order("slot_time", { ascending: true });
      if (error) throw error;
      return (data || []) as Appt[];
    },
  });

  const doctorSummaries = useMemo<DoctorSummary[]>(() => {
    const map = new Map<string, DoctorSummary>();
    for (const s of slots) {
      if (!map.has(s.doctor_id)) {
        map.set(s.doctor_id, {
          doctor_id: s.doctor_id,
          doctor_name: s.doctor?.full_name || "Doctor",
          total: 0, open: 0, partial: 0, full: 0,
        });
      }
      const g = map.get(s.doctor_id)!;
      g.total++;
      if (s.is_blocked) continue;
      if (s.booked_count === 0) g.open++;
      else if (s.booked_count < s.max_patients) g.partial++;
      else g.full++;
    }
    return Array.from(map.values());
  }, [slots]);

  const selectedDoctorName = doctorSummaries.find(d => d.doctor_id === selectedDoctor)?.doctor_name;
  const doctorSlots = slots.filter(s => s.doctor_id === selectedDoctor);
  const doctorAppts = appointments.filter(a => a.doctor_id === selectedDoctor);
  const arrivedCount = doctorAppts.filter(a => a.status === "arrived").length;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["doctor-slots", hospitalId, dateStr] });
    qc.invalidateQueries({ queryKey: ["appointments", hospitalId, dateStr] });
  };

  const handleRemindTomorrow = async () => {
    if (!hospitalId) return;
    setReminding(true);
    try {
      const tomorrow = format(addDays(new Date(), 1), "yyyy-MM-dd");
      const { data: appts } = await (supabase as any)
        .from("appointments")
        .select("id, patient_id, slot_time")
        .eq("hospital_id", hospitalId)
        .eq("appointment_date", tomorrow)
        .eq("reminder_sent", false)
        .neq("status", "cancelled")
        .neq("status", "no_show");

      if (!appts || appts.length === 0) {
        toast.info("No reminders to send for tomorrow");
        return;
      }

      const { data: hosp } = await supabase.from("hospitals").select("name").eq("id", hospitalId).maybeSingle();
      const hospName = hosp?.name || "";

      let sent = 0;
      for (const a of appts as any[]) {
        const { data: pat } = await supabase.from("patients").select("full_name, phone").eq("id", a.patient_id).maybeSingle();
        if (pat?.phone) {
          const msg = `Dear ${pat.full_name}, reminder: your appointment tomorrow (${format(parseISO(tomorrow), "dd MMM yyyy")}) at ${fmtTime(a.slot_time)} is confirmed. — ${hospName}`;
          try { await sendWhatsApp({ hospitalId, phone: pat.phone, message: msg }); sent++; }
          catch (e) { console.warn("WhatsApp failed for appt", a.id, e); }
        }
        await (supabase as any)
          .from("appointments")
          .update({ reminder_sent: true, reminder_sent_at: new Date().toISOString() })
          .eq("id", a.id);
      }
      toast.success(`Reminders sent: ${sent} of ${appts.length} for tomorrow`);
    } catch (e: any) {
      toast.error(e.message || "Failed to send reminders");
    } finally {
      setReminding(false);
    }
  };

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col bg-background">
      {/* Header */}
      <div className="flex-shrink-0 border-b bg-card px-4 py-3 flex items-center gap-3">
        <CalendarDays className="text-primary" size={20} />
        <h1 className="text-lg font-semibold">Appointment Scheduling</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRemindTomorrow} disabled={reminding} className="gap-1.5">
            {reminding ? <Loader2 size={14} className="animate-spin" /> : <Bell size={14} />}
            Remind Tomorrow
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDate(subDays(date, 1))}><ChevronLeft size={16} /></Button>
          <Input type="date" value={dateStr} onChange={(e) => setDate(parseISO(e.target.value))} className="w-44 h-9" />
          <Button variant="outline" size="sm" onClick={() => setDate(addDays(date, 1))}><ChevronRight size={16} /></Button>
          <Button variant="secondary" size="sm" onClick={() => setDate(new Date())}>Today</Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* LEFT: doctor list */}
        <div className="w-[280px] flex-shrink-0 border-r overflow-y-auto p-3 space-y-2 bg-muted/20">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Doctors — {format(date, "EEE, dd MMM")}
          </div>
          {loadingSlots && (
            <div className="flex items-center justify-center p-6 text-muted-foreground">
              <Loader2 className="animate-spin mr-2" size={16} /> Loading…
            </div>
          )}
          {!loadingSlots && doctorSummaries.length === 0 && (
            <div className="text-sm text-muted-foreground p-4 text-center space-y-1.5">
              <div className="font-medium">No slots for this date</div>
              <div className="text-xs">Go to <b>Settings → Doctor Schedules</b> and use <b>Generate Slots</b> to create slots for this date.</div>
            </div>
          )}
          {doctorSummaries.map(g => {
            const active = selectedDoctor === g.doctor_id;
            const fillPct = g.total > 0 ? Math.round(((g.partial + g.full) / g.total) * 100) : 0;
            return (
              <Card
                key={g.doctor_id}
                onClick={() => setSelectedDoctor(g.doctor_id)}
                className={cn("p-3 cursor-pointer transition-colors hover:border-primary", active && "border-primary bg-primary/5")}
              >
                <div className="font-medium text-sm">{g.doctor_name}</div>
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-800">{g.open} Open</Badge>
                  {g.partial > 0 && <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-800">{g.partial} Partial</Badge>}
                  {g.full > 0 && <Badge variant="secondary" className="text-[10px] bg-red-100 text-red-800">{g.full} Full</Badge>}
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">{g.total} Total</Badge>
                </div>
                {g.total > 0 && (
                  <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all", fillPct < 70 ? "bg-emerald-400" : fillPct < 90 ? "bg-amber-400" : "bg-red-400")}
                      style={{ width: `${fillPct}%` }}
                    />
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        {/* RIGHT: slot grid / queue */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {!selectedDoctor ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              Select a doctor to see slots and appointments.
            </div>
          ) : (
            <>
              <div className="flex-shrink-0 border-b px-4 py-2 flex items-center gap-4">
                <div>
                  <div className="font-semibold text-sm">{selectedDoctorName}</div>
                  <div className="text-xs text-muted-foreground">
                    {format(date, "dd MMM yyyy")} · {doctorSlots.length} slots · {doctorAppts.length} appointments
                  </div>
                </div>
                <div className="ml-auto flex gap-2">
                  <Button size="sm" variant={panelView === "slots" ? "default" : "outline"} className="gap-1.5 h-8" onClick={() => setPanelView("slots")}>
                    <LayoutGrid size={13} /> Slots
                  </Button>
                  <Button size="sm" variant={panelView === "queue" ? "default" : "outline"} className="gap-1.5 h-8" onClick={() => setPanelView("queue")}>
                    <List size={13} /> Queue
                    {arrivedCount > 0 && (
                      <span className="ml-1 px-1.5 py-px text-[9px] bg-green-500 text-white rounded-full font-bold">
                        {arrivedCount}
                      </span>
                    )}
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {panelView === "slots" ? (
                  <SlotGrid slots={doctorSlots} appointments={doctorAppts} onBook={setBookingSlot} onViewAppt={setViewingAppt} />
                ) : (
                  <QueuePanel appointments={doctorAppts} hospitalId={hospitalId!} onRefresh={refresh} onCheckin={setCheckinAppt} />
                )}
                {hospitalId && doctorAppts.length > 0 && (
                  <NoShowRiskPanel
                    hospitalId={hospitalId}
                    date={format(date, "yyyy-MM-dd")}
                    appointments={doctorAppts.map(a => ({
                      id: a.id,
                      patient_id: a.patient_id,
                      appointment_date: a.appointment_date,
                      slot_time: a.slot_time,
                      visit_type: a.visit_type,
                      chief_complaint: a.chief_complaint,
                      status: a.status,
                      patient_name: (a as any).patient?.full_name,
                      patient_phone: (a as any).patient?.phone,
                      doctor_name: selectedDoctorName,
                    }))}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {bookingSlot && (
        <WalkInModal
          hospitalId={hospitalId!}
          mode="appointment"
          appointmentSlot={{
            id: bookingSlot.id,
            doctor_id: bookingSlot.doctor_id,
            slot_date: bookingSlot.slot_date,
            slot_time: bookingSlot.slot_time,
            slot_duration_mins: bookingSlot.slot_duration_mins,
            slot_type: bookingSlot.slot_type,
          }}
          appointmentDoctorName={selectedDoctorName || ""}
          onClose={() => setBookingSlot(null)}
          onCreated={() => { setBookingSlot(null); refresh(); }}
        />
      )}

      {checkinAppt && (
        <WalkInModal
          hospitalId={hospitalId!}
          mode="checkin"
          checkinAppointment={{
            id: checkinAppt.id,
            patient_id: checkinAppt.patient_id,
            patient_name: checkinAppt.patient?.full_name || "",
            uhid: checkinAppt.patient?.uhid || "",
            phone: checkinAppt.patient?.phone || null,
            doctor_id: checkinAppt.doctor_id,
            department_id: checkinAppt.department_id,
            consultation_fee: checkinAppt.consultation_fee,
            visit_type: checkinAppt.visit_type,
            visit_purpose: checkinAppt.visit_purpose,
          }}
          onClose={() => setCheckinAppt(null)}
          onCreated={() => { setCheckinAppt(null); refresh(); }}
        />
      )}

      {viewingAppt && (
        <ApptDetailModal
          appt={viewingAppt}
          onClose={() => setViewingAppt(null)}
          onChanged={() => { setViewingAppt(null); refresh(); }}
          onRefresh={refresh}
          onCheckin={(a) => { setViewingAppt(null); setCheckinAppt(a); }}
        />
      )}
    </div>
  );
};

// ── Slot Grid ─────────────────────────────────────────────────────────────────

const SlotGrid: React.FC<{
  slots: DoctorSlot[];
  appointments: Appt[];
  onBook: (slot: DoctorSlot) => void;
  onViewAppt: (appt: Appt) => void;
}> = ({ slots, appointments, onBook, onViewAppt }) => {
  if (slots.length === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground p-10 space-y-2">
        <div className="font-medium">No slots generated for this doctor on this date.</div>
        <div className="text-xs">Go to <b>Settings → Doctor Schedules</b> and use the <b>Generate Slots</b> section.</div>
      </div>
    );
  }

  // Map slot_id → appointment; fallback to slot_time match
  const apptBySlot = new Map<string, Appt>();
  for (const a of appointments) {
    if (a.slot_id) {
      apptBySlot.set(a.slot_id, a);
    } else {
      const match = slots.find(s => s.slot_time.slice(0, 5) === (a.slot_time || "").slice(0, 5));
      if (match && !apptBySlot.has(match.id)) apptBySlot.set(match.id, a);
    }
  }

  return (
    <div>
      <div className="flex gap-4 text-xs mb-4 text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-400 inline-block"></span>Open</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-400 inline-block"></span>Partial</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-400 inline-block"></span>Full</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-slate-300 inline-block"></span>Blocked</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {slots.map(slot => {
          const appt = apptBySlot.get(slot.id);
          const isFull = slot.booked_count >= slot.max_patients;
          const isPartial = slot.booked_count > 0 && !isFull;
          const isBlocked = slot.is_blocked;

          const cls = isBlocked
            ? "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed opacity-70"
            : isFull
            ? "bg-red-50 border-red-200 hover:bg-red-100 cursor-pointer"
            : isPartial
            ? "bg-amber-50 border-amber-200 hover:bg-amber-100 cursor-pointer"
            : "bg-emerald-50 border-emerald-200 hover:bg-emerald-100 cursor-pointer";

          const handleClick = () => {
            if (isBlocked) return;
            if (appt) onViewAppt(appt);
            else if (!isFull) onBook(slot);
          };

          return (
            <button
              key={slot.id}
              disabled={isBlocked}
              onClick={handleClick}
              className={cn("p-3 rounded-md border text-left transition-all hover:shadow-sm", cls)}
            >
              <div className="text-sm font-medium">{fmtTime(slot.slot_time)}</div>
              {isBlocked ? (
                <div className="text-[11px] text-slate-400 truncate">{slot.block_reason || "Blocked"}</div>
              ) : appt ? (
                <>
                  <div className="text-[11px] truncate text-slate-700">{appt.patient?.full_name || "Booked"}</div>
                  <div className={cn("text-[10px] mt-0.5 px-1 py-px rounded inline-block", STATUS_COLORS[appt.status] || "bg-slate-100 text-slate-500")}>
                    {appt.status.replace("_", " ")}
                  </div>
                </>
              ) : (
                <div className="text-[11px] text-emerald-700">
                  {slot.max_patients > 1 ? `${slot.booked_count}/${slot.max_patients} booked` : "Open"}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ── Queue Panel ───────────────────────────────────────────────────────────────

const QueuePanel: React.FC<{
  appointments: Appt[];
  hospitalId: string;
  onRefresh: () => void;
  onCheckin: (appt: Appt) => void;
}> = ({ appointments, hospitalId, onRefresh, onCheckin }) => {
  const [actingId, setActingId] = useState<string | null>(null);

  if (appointments.length === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground p-10">
        No appointments booked for this doctor today.
      </div>
    );
  }

  const act = async (id: string, fn: () => Promise<void>) => {
    setActingId(id);
    try { await fn(); }
    finally { setActingId(null); }
  };

  const handleMarkArrived = (appt: Appt) => act(appt.id, async () => {
    const { error } = await (supabase as any).from("appointments").update({ status: "arrived" }).eq("id", appt.id);
    if (error) throw error;
    toast.success(`${appt.patient?.full_name} marked as arrived`);
    onRefresh();
  });

  // Issuing a token opens the Walk-in payment + receipt flow (collect fee → create bill →
  // issue token linked to this appointment). Handled by the parent via onCheckin.

  const handleNoShow = (appt: Appt) => act(appt.id, async () => {
    if (!confirm(`Mark ${appt.patient?.full_name} as no-show?`)) return;
    await (supabase as any).from("appointments").update({ status: "no_show" }).eq("id", appt.id);
    toast.success("Marked as no-show");
    onRefresh();
  });

  return (
    <div className="space-y-2">
      {appointments.map(appt => {
        const acting = actingId === appt.id;
        const statusStyle = STATUS_COLORS[appt.status] || "bg-slate-100 text-slate-600";
        const canArrive = ["scheduled", "booked", "confirmed"].includes(appt.status);
        const canIssueToken = appt.status === "arrived";
        const canNoShow = ["scheduled", "booked", "confirmed", "arrived"].includes(appt.status);
        return (
          <div key={appt.id} className="border rounded-lg p-3 bg-card flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{appt.patient?.full_name}</span>
                <span className="text-xs text-muted-foreground">{appt.patient?.uhid}</span>
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium capitalize", statusStyle)}>
                  {appt.status.replace("_", " ")}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 flex gap-3 flex-wrap">
                <span>{fmtTime(appt.slot_time)}</span>
                {appt.visit_type && <span className="capitalize">{appt.visit_type.replace("_", " ")}</span>}
                {appt.chief_complaint && <span className="truncate max-w-[180px]">{appt.chief_complaint}</span>}
                {appt.patient?.phone && <span>{appt.patient.phone}</span>}
              </div>
            </div>
            <div className="flex gap-1.5 flex-shrink-0">
              {canArrive && (
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => handleMarkArrived(appt)} disabled={acting}>
                  {acting ? <Loader2 size={11} className="animate-spin" /> : <UserCheck size={12} />}
                  Arrived
                </Button>
              )}
              {canIssueToken && (
                <Button size="sm" className="h-7 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={() => onCheckin(appt)} disabled={acting}>
                  <Ticket size={12} />
                  Issue Token
                </Button>
              )}
              {canNoShow && (
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-red-500 hover:bg-red-50" onClick={() => handleNoShow(appt)} disabled={acting}>
                  <XCircle size={12} /> No Show
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ── Booking Modal ─────────────────────────────────────────────────────────────

const BookingModal: React.FC<{
  hospitalId: string;
  slot: DoctorSlot;
  doctorName: string;
  onClose: () => void;
  onBooked: () => void;
}> = ({ hospitalId, slot, doctorName, onClose, onBooked }) => {
  const [patientId, setPatientId] = useState("");
  const [visitType, setVisitType] = useState<"new" | "follow_up" | "review">("new");
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [notes, setNotes] = useState("");
  const [fee, setFee] = useState("0");
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("service_rates")
        .select("default_rate")
        .eq("hospital_id", hospitalId)
        .eq("item_code", "consultation")
        .eq("is_active", true)
        .maybeSingle();
      if (data?.default_rate != null) setFee(String(data.default_rate));
    })();
  }, [hospitalId]);

  const handleBook = async () => {
    if (!patientId) { toast.error("Please select a patient"); return; }
    setSaving(true);
    try {
      const endTime = slotEndTime(slot.slot_time, slot.slot_duration_mins || 15);

      const { error: aerr } = await (supabase as any).from("appointments").insert({
        hospital_id: hospitalId,
        patient_id: patientId,
        doctor_id: slot.doctor_id,
        appointment_date: slot.slot_date,
        slot_time: slot.slot_time,
        slot_end_time: endTime + ":00",
        slot_id: slot.id,
        status: "scheduled",
        visit_type: visitType,
        chief_complaint: chiefComplaint || null,
        consultation_fee: Number(fee) || 0,
        booked_via: "front_desk",
      });
      if (aerr) throw aerr;

      // Increment booked_count — best-effort
      await (supabase as any).from("doctor_slots")
        .update({ booked_count: slot.booked_count + 1 })
        .eq("id", slot.id);

      // WhatsApp confirmation — best-effort
      try {
        const [{ data: pat }, { data: hosp }] = await Promise.all([
          supabase.from("patients").select("full_name, phone").eq("id", patientId).maybeSingle(),
          supabase.from("hospitals").select("name").eq("id", hospitalId).maybeSingle(),
        ]);
        if (pat?.phone) {
          const msg = `Dear ${pat.full_name}, your appointment with Dr. ${doctorName} on ${format(parseISO(slot.slot_date), "dd MMM yyyy")} at ${fmtTime(slot.slot_time)} is confirmed. — ${hosp?.name || ""}`;
          await sendWhatsApp({ hospitalId, phone: pat.phone, message: msg });
        }
      } catch (e) { console.warn("WhatsApp send failed", e); }

      toast.success("Appointment booked");
      onBooked();
    } catch (e: any) {
      toast.error(e.message || "Failed to book appointment");
    } finally {
      setSaving(false);
    }
  };

  const endStr = slotEndTime(slot.slot_time, slot.slot_duration_mins || 15);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Book Appointment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-sm bg-muted/40 rounded p-2.5 space-y-0.5">
            <div><b>Dr.</b> {doctorName}</div>
            <div><b>Date:</b> {format(parseISO(slot.slot_date), "dd MMM yyyy")} · <b>Time:</b> {fmtTime(slot.slot_time)} – {fmtTime(endStr)}</div>
            <div><b>Type:</b> <span className="capitalize">{slot.slot_type || "OPD"}</span></div>
          </div>
          <div>
            <Label>Patient *</Label>
            <PatientSearchPicker hospitalId={hospitalId} value={patientId} onChange={setPatientId} />
          </div>
          <div>
            <Label>Visit Type</Label>
            <Select value={visitType} onValueChange={(v) => setVisitType(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="follow_up">Follow-up</SelectItem>
                <SelectItem value="review">Review</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Chief Complaint</Label>
            <Textarea value={chiefComplaint} onChange={e => setChiefComplaint(e.target.value)} rows={2} placeholder="Brief reason for visit" />
          </div>
          <div>
            <Label>Consultation Fee (₹)</Label>
            <Input type="number" value={fee} onChange={e => setFee(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleBook} disabled={saving}>
            {saving && <Loader2 className="animate-spin mr-2" size={14} />}
            Book Appointment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ── Appointment Detail / Cancel ───────────────────────────────────────────────

const ApptDetailModal: React.FC<{
  appt: Appt;
  onClose: () => void;
  onChanged: () => void;
  onRefresh: () => void;
  onCheckin: (appt: Appt) => void;
}> = ({ appt, onClose, onChanged, onRefresh, onCheckin }) => {
  const [cancelling, setCancelling] = useState(false);
  const [acting, setActing] = useState(false);
  const [status, setStatus] = useState(appt.status);

  const handleMarkArrived = async () => {
    setActing(true);
    try {
      const { error } = await (supabase as any).from("appointments").update({ status: "arrived" }).eq("id", appt.id);
      if (error) throw error;
      setStatus("arrived");
      toast.success(`${appt.patient?.full_name} marked as arrived`);
      onRefresh();
    } catch (e: any) {
      toast.error(e.message || "Failed to mark arrived");
    } finally {
      setActing(false);
    }
  };

  const handleCancel = async () => {
    if (!confirm("Cancel this appointment?")) return;
    setCancelling(true);
    try {
      await (supabase as any).from("appointments").update({ status: "cancelled" }).eq("id", appt.id);

      // Decrement slot booked_count
      if (appt.slot_id) {
        const { data: slot } = await (supabase as any)
          .from("doctor_slots").select("booked_count").eq("id", appt.slot_id).maybeSingle();
        if (slot && slot.booked_count > 0) {
          await (supabase as any).from("doctor_slots")
            .update({ booked_count: slot.booked_count - 1 }).eq("id", appt.slot_id);
        }
      }

      // WhatsApp cancellation — best-effort
      try {
        const { data: pat } = await supabase.from("patients").select("full_name, phone, hospital_id").eq("id", appt.patient_id).maybeSingle();
        if (pat?.phone && pat?.hospital_id) {
          const msg = `Dear ${pat.full_name}, your appointment on ${format(parseISO(appt.appointment_date), "dd MMM yyyy")} at ${fmtTime(appt.slot_time)} has been cancelled. Please contact us to reschedule.`;
          await sendWhatsApp({ hospitalId: pat.hospital_id, phone: pat.phone, message: msg });
        }
      } catch (e) { console.warn("WhatsApp cancel failed", e); }

      toast.success("Appointment cancelled");
      onChanged();
    } catch (e: any) {
      toast.error(e.message || "Failed to cancel");
    } finally {
      setCancelling(false);
    }
  };

  const statusStyle = STATUS_COLORS[status] || "bg-slate-100 text-slate-600";
  const isFinal = ["cancelled", "completed", "no_show", "in_consultation"].includes(status);
  const canArrive = ["scheduled", "booked", "confirmed"].includes(status);
  const canIssueToken = status === "arrived";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Appointment Details</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <div><b>Patient:</b> {appt.patient?.full_name} ({appt.patient?.uhid})</div>
          {appt.patient?.phone && <div><b>Phone:</b> {appt.patient.phone}</div>}
          <div><b>Time:</b> {fmtTime(appt.slot_time)}</div>
          <div><b>Visit:</b> <span className="capitalize">{(appt.visit_type || "").replace("_", " ") || "—"}</span></div>
          {appt.chief_complaint && <div><b>Complaint:</b> {appt.chief_complaint}</div>}
          {appt.notes && <div><b>Notes:</b> {appt.notes}</div>}
          <div className="flex items-center gap-2">
            <b>Status:</b>
            <span className={cn("text-[11px] px-2 py-0.5 rounded font-medium capitalize", statusStyle)}>
              {status.replace("_", " ")}
            </span>
          </div>
          <div><b>Fee:</b> ₹{Number(appt.consultation_fee || 0).toLocaleString("en-IN")}</div>
          {appt.booking_source && (
            <div><b>Source:</b> <span className="capitalize">{appt.booking_source.replace("_", " ")}</span></div>
          )}
        </div>
        <DialogFooter className="flex-wrap gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {canArrive && (
            <Button onClick={handleMarkArrived} disabled={acting}>
              {acting ? <Loader2 className="animate-spin mr-2" size={14} /> : <UserCheck size={14} className="mr-1" />}
              Mark Arrived
            </Button>
          )}
          {canIssueToken && (
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => onCheckin(appt)}>
              <Ticket size={14} className="mr-1" />
              Collect Fee &amp; Issue Token
            </Button>
          )}
          {!isFinal && (
            <Button variant="destructive" onClick={handleCancel} disabled={cancelling}>
              {cancelling ? <Loader2 className="animate-spin mr-2" size={14} /> : <XCircle size={14} className="mr-1" />}
              Cancel Appointment
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SchedulingPage;

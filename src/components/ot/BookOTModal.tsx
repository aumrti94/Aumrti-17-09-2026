import React, { useState, useEffect } from "react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import PatientSearchPicker from "@/components/shared/PatientSearchPicker";
import type { OTRoom } from "@/pages/ot/OTPage";

interface Props {
  rooms: OTRoom[];
  selectedRoomId: string;
  selectedDate: string;
  prefillTime: string | null;
  onClose: () => void;
  onBooked: (date?: string, roomId?: string) => void;
  initialPatientId?: string;
  initialPatientName?: string;
  initialDiagnosis?: string;
  initialUrgency?: "emergency" | "urgent" | "routine";
  initialSurgeonId?: string;
}

const CATEGORIES = ["general", "orthopaedic", "gynaecology", "urology", "cardiothoracic", "neurosurgery", "ent", "ophthalmology", "paediatric", "plastic", "emergency", "endoscopy", "other"];
const ANAESTHESIA = ["general", "spinal", "epidural", "regional", "local", "sedation", "none"];
const DURATIONS = [30, 45, 60, 90, 120, 150, 180, 240];

const BookOTModal: React.FC<Props> = ({ rooms, selectedRoomId, selectedDate, prefillTime, onClose, onBooked, initialPatientId, initialPatientName, initialDiagnosis, initialUrgency, initialSurgeonId }) => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [doctors, setDoctors] = useState<any[]>([]);
  const isEmergencyReferral = initialUrgency === "emergency";
  const [form, setForm] = useState({
    patientId: initialPatientId || "",
    surgeryName: initialDiagnosis || "",
    category: isEmergencyReferral ? "emergency" : "general",
    date: selectedDate,
    roomId: selectedRoomId || "",
    startTime: prefillTime || (isEmergencyReferral ? new Date().toTimeString().slice(0, 5) : "09:00"),
    duration: 60,
    surgeonId: initialSurgeonId || "",
    anaesthetistId: "",
    anaesthesiaType: "general",
    notes: isEmergencyReferral ? "Referred from Emergency Department" : "",
  });
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);

  useEffect(() => {
    if (!hospitalId) return;
    const fetchData = async () => {
      const { data: docs } = await supabase
        .from("users")
        .select("id, full_name, role")
        .eq("hospital_id", hospitalId)
        .in("role", ["doctor", "super_admin", "hospital_admin"])
        .eq("is_active", true)
        .order("full_name");
      setDoctors(docs || []);
    };
    fetchData();
  }, [hospitalId]);

  const addMinutes = (time: string, mins: number) => {
    const [h, m] = time.split(":").map(Number);
    const total = h * 60 + m + mins;
    return `${Math.floor(total / 60).toString().padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
  };

  const endTime = addMinutes(form.startTime, form.duration);
  const timeToMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

  const checkConflict = async () => {
    const { data } = await supabase
      .from("ot_schedules")
      .select("id, surgery_name, scheduled_start_time, scheduled_end_time")
      .eq("ot_room_id", form.roomId)
      .eq("scheduled_date", form.date)
      .neq("status", "cancelled");

    if (data) {
      const startMin = timeToMin(form.startTime);
      const endMin = timeToMin(endTime);
      const overlapping = data.find((s) => {
        const sStart = timeToMin(s.scheduled_start_time);
        const sEnd = timeToMin(s.scheduled_end_time);
        return startMin < sEnd && endMin > sStart;
      });
      setConflict(overlapping ? `⚠️ Room is booked from ${overlapping.scheduled_start_time.slice(0, 5)} to ${overlapping.scheduled_end_time.slice(0, 5)} for ${overlapping.surgery_name}` : null);
    }
  };

  useEffect(() => { if (form.roomId && form.date && form.startTime) checkConflict(); }, [form.roomId, form.date, form.startTime, form.duration]);

  const handleSubmit = async () => {
    if (!form.patientId || !form.surgeryName || !form.surgeonId || !form.roomId) {
      toast({ title: "Please fill all required fields", variant: "destructive" });
      return;
    }
    if (form.duration <= 0) {
      toast({ title: "Duration must be greater than 0", variant: "destructive" });
      return;
    }
    if (conflict) {
      toast({ title: "Cannot book — time slot has a conflict", variant: "destructive" });
      return;
    }
    setSaving(true);
    const hid = (await supabase.rpc("get_user_hospital_id")) as any;
    const hospitalId = hid?.data;

    const { data: schedule, error } = await supabase
      .from("ot_schedules")
      .insert({
        hospital_id: hospitalId,
        ot_room_id: form.roomId,
        patient_id: form.patientId,
        surgeon_id: form.surgeonId,
        anaesthetist_id: form.anaesthetistId || null,
        surgery_name: form.surgeryName,
        surgery_category: form.category,
        scheduled_date: form.date,
        scheduled_start_time: form.startTime,
        scheduled_end_time: endTime,
        estimated_duration_minutes: form.duration,
        anaesthesia_type: form.anaesthesiaType,
        booking_notes: form.notes || null,
      })
      .select("id")
      .maybeSingle();

    if (error) {
      toast({ title: "Failed to book OT", description: error.message, variant: "destructive" });
      setSaving(false);
      return;
    }

    if (schedule) {
      await supabase.from("ot_checklists").insert({
        hospital_id: hospitalId,
        ot_schedule_id: schedule.id,
      });

      // Pre-operative blood request for major surgeries
      const createPreOpBloodRequest = async (otSchedule: any) => {
        const majorSurgeryTypes = ["cardiac", "ortho", "neuro", "abdominal", "vascular", "thoracic", "liver", "transplant"];
        const isMajor = majorSurgeryTypes.some(
          (t) =>
            otSchedule.surgery_category?.toLowerCase().includes(t) ||
            otSchedule.surgery_name?.toLowerCase().includes(t)
        );

        if (!isMajor && !otSchedule.booking_notes?.toLowerCase().includes("blood")) return;

        const { data: patient } = await supabase
          .from("patients")
          .select("blood_group, full_name")
          .eq("id", otSchedule.patient_id)
          .maybeSingle();

        const bloodGroup = patient?.blood_group?.replace(/[+-]/g, "").trim() || null;
        const rhFactor = patient?.blood_group?.includes("+") ? "positive" : "negative";

        if (!bloodGroup) {
          await supabase.from("clinical_alerts").insert({
            hospital_id: hospitalId,
            patient_id: otSchedule.patient_id,
            alert_type: "pre_op_blood_group_unknown",
            severity: "medium",
            alert_message: `Surgery scheduled for ${patient?.full_name} on ${otSchedule.scheduled_date}. Blood group unknown — obtain blood group before surgery.`,
          });
          return;
        }

        await supabase.from("blood_requests").insert({
          hospital_id: hospitalId,
          patient_id: otSchedule.patient_id,
          admission_id: otSchedule.admission_id || null,
          ot_id: otSchedule.id,
          blood_group: bloodGroup,
          rh_factor: rhFactor,
          component: "rbc",
          units_required: 2,
          urgency: "routine",
          indication: `Pre-operative for ${otSchedule.surgery_name} on ${otSchedule.scheduled_date}`,
          requested_by: form.surgeonId,
          status: "pending",
        });

        toast({ title: "Pre-operative blood request sent to Blood Bank" });
      };

      await createPreOpBloodRequest({
        id: schedule.id,
        patient_id: form.patientId,
        surgery_name: form.surgeryName,
        surgery_category: form.category,
        scheduled_date: form.date,
        admission_id: null,
        booking_notes: form.notes,
      });
    }

    toast({ title: `OT booked — ${form.surgeryName} on ${form.date} at ${form.startTime}` });
    setSaving(false);
    onBooked(form.date, form.roomId);
  };


  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-2xl w-full max-w-[560px] max-h-[calc(100vh-80px)] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-border">
          <div>
            <h2 className="text-lg font-bold text-foreground">Book OT Slot</h2>
            <p className="text-[13px] text-muted-foreground">Schedule a surgical procedure</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 active:scale-95"><X size={18} /></button>
        </div>

        <div className="px-6 py-4 space-y-3">
          {/* Patient */}
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Patient *</label>
            <PatientSearchPicker
              hospitalId={hospitalId || ""}
              value={form.patientId}
              onChange={(pid) => setForm({ ...form, patientId: pid })}
              selectedLabel={initialPatientName}
              placeholder="Search by name or UHID…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Surgery Name *</label>
              <input value={form.surgeryName} onChange={(e) => setForm({ ...form, surgeryName: e.target.value })} placeholder="e.g. Appendicectomy" className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Category *</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background capitalize focus:outline-none focus:ring-1 focus:ring-primary">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Date *</label>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">OT Room *</label>
              <select value={form.roomId} onChange={(e) => setForm({ ...form, roomId: e.target.value })} className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary">
                {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Start Time *</label>
              <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} step="1800" className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Duration</label>
              <select value={form.duration} onChange={(e) => setForm({ ...form, duration: Number(e.target.value) })} className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary">
                {DURATIONS.map((d) => <option key={d} value={d}>{d} min</option>)}
              </select>
              <p className="text-[10px] text-muted-foreground mt-0.5">Ends at {endTime}</p>
            </div>
          </div>

          {conflict && (
            <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-700">{conflict}</div>
          )}

          <div>
            <label className="text-xs font-medium mb-1 block">Surgeon *</label>
            <select value={form.surgeonId} onChange={(e) => setForm({ ...form, surgeonId: e.target.value })} className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary">
              <option value="">Select surgeon...</option>
              {doctors.map((d) => <option key={d.id} value={d.id}>Dr. {d.full_name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Anaesthetist</label>
              <select value={form.anaesthetistId} onChange={(e) => setForm({ ...form, anaesthetistId: e.target.value })} className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary">
                <option value="">Not required</option>
                {doctors.map((d) => <option key={d.id} value={d.id}>Dr. {d.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Anaesthesia Type</label>
              <select value={form.anaesthesiaType} onChange={(e) => setForm({ ...form, anaesthesiaType: e.target.value })} className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background capitalize focus:outline-none focus:ring-1 focus:ring-primary">
                {ANAESTHESIA.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium mb-1 block">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Special instructions..." rows={2} className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
        </div>

        <div className="px-6 pb-5 pt-2">
          <button onClick={handleSubmit} disabled={saving}
            className="w-full bg-[hsl(var(--sidebar-accent))] text-white font-semibold py-3 rounded-lg hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50">
            {saving ? "Booking..." : "📅 Confirm OT Booking"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BookOTModal;

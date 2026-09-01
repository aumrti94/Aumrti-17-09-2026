import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { format, addDays, startOfDay, subDays } from "date-fns";
import {
  Calendar, Clock, User, Phone, ChevronLeft, ChevronRight,
  CheckCircle2, Loader2, Search, AlertCircle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Hospital {
  id: string;
  name: string;
  logo_url: string | null;
  primary_color: string | null;
  address: string | null;
  phone: string | null;
}

interface Doctor {
  id: string;
  full_name: string;
  department_id: string | null;
  department_name: string | null;
  consultation_fee: number | null;
}

interface Slot {
  id: string;
  slot_date: string;
  slot_time: string;
  slot_duration_mins: number;
  max_patients: number;
  booked_count: number;
  slot_type: string;
  is_blocked: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  "new": "New Consultation",
  "follow_up": "Follow-up",
  "teleconsult": "Telemedicine",
};

function fmtTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

export default function PublicAppointmentPage() {
  const { slug } = useParams<{ slug: string }>();

  const [hospital, setHospital]     = useState<Hospital | null>(null);
  const [doctors, setDoctors]       = useState<Doctor[]>([]);
  const [slots, setSlots]           = useState<Slot[]>([]);
  const [loading, setLoading]       = useState(true);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [notFound, setNotFound]     = useState(false);

  // Selection state
  const [search, setSearch]         = useState("");
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [visitType, setVisitType]   = useState("new");

  // Booking form
  const [step, setStep]             = useState<"select" | "form" | "confirm">("select");
  const [name, setName]             = useState("");
  const [phone, setPhone]           = useState("");
  const [complaint, setComplaint]   = useState("");
  const [booking, setBooking]       = useState(false);
  const [bookingRef, setBookingRef] = useState("");
  const [bookingError, setBookingError] = useState("");

  // Load hospital by subdomain slug
  useEffect(() => {
    if (!slug) return;
    (supabase as any)
      .from("hospitals")
      .select("id, name, logo_url, primary_color, address, phone")
      .eq("subdomain", slug)
      .eq("is_active", true)
      .maybeSingle()
      .then(({ data }: any) => {
        if (!data) { setNotFound(true); setLoading(false); return; }
        setHospital(data);
        // Load doctors
        return (supabase as any)
          .from("users")
          .select("id, full_name, department_id, departments:department_id(name), consultation_fee")
          .eq("hospital_id", data.id)
          .eq("role", "doctor")
          .eq("is_active", true)
          .order("full_name");
      })
      .then((res: any) => {
        if (!res) return;
        const docs = (res.data || []).map((d: any) => ({
          id: d.id,
          full_name: d.full_name,
          department_id: d.department_id,
          department_name: d.departments?.name || null,
          consultation_fee: d.consultation_fee || null,
        }));
        setDoctors(docs);
        setLoading(false);
      })
      .catch(() => { setNotFound(true); setLoading(false); });
  }, [slug]);

  // Load slots when doctor + date changes
  const loadSlots = useCallback(async () => {
    if (!selectedDoctor || !hospital) return;
    setSlotsLoading(true);
    const dateStr = format(selectedDate, "yyyy-MM-dd");
    const { data } = await (supabase as any)
      .from("doctor_slots")
      .select("*")
      .eq("hospital_id", hospital.id)
      .eq("doctor_id", selectedDoctor.id)
      .eq("slot_date", dateStr)
      .eq("is_blocked", false)
      .order("slot_time");
    setSlots(data || []);
    setSlotsLoading(false);
    setSelectedSlot(null);
  }, [selectedDoctor, selectedDate, hospital]);

  useEffect(() => { loadSlots(); }, [loadSlots]);

  const filteredDoctors = doctors.filter(d =>
    !search || d.full_name.toLowerCase().includes(search.toLowerCase()) ||
    (d.department_name || "").toLowerCase().includes(search.toLowerCase())
  );

  const confirmBooking = async () => {
    if (!hospital || !selectedDoctor || !selectedSlot || !name.trim() || !phone.trim()) return;
    setBooking(true);
    setBookingError("");

    // The booking is done server-side by create_public_appointment (SECURITY DEFINER).
    // An anonymous visitor has no users row, so get_user_hospital_id() returns NULL and a
    // direct insert into patients / appointments can never pass RLS — which is why this
    // page never actually created an appointment. The RPC also derives doctor, department,
    // date, time, slot_end_time, fee and status from the slot itself, so none of those can
    // be tampered with from the browser, and it enforces slot capacity under a row lock.
    const { data, error } = await (supabase as any).rpc("create_public_appointment", {
      p_hospital_id:     hospital.id,
      p_slot_id:         selectedSlot.id,
      p_patient_name:    name.trim(),
      p_patient_phone:   phone.trim(),
      p_visit_type:      visitType,
      p_chief_complaint: complaint || null,
    });

    if (error || !data?.appointment_id) {
      // Never advance to the confirmation screen on failure. Showing "Appointment
      // Confirmed" after a failed write is precisely the bug this replaces.
      setBookingError(
        error?.message ||
        "We could not complete your booking. Please try again, or call the hospital."
      );
      setBooking(false);
      loadSlots(); // the slot may have just been taken — refresh availability
      return;
    }

    const ref = data.reference as string;

    // WhatsApp confirmation via wa.me (no auth needed for public page)
    const msg = `*Appointment Confirmed* ✅\n\nHospital: ${hospital.name}\nDoctor: Dr. ${selectedDoctor.full_name}\nDate: ${format(selectedDate, "dd MMM yyyy")}\nTime: ${fmtTime(selectedSlot.slot_time)}\nRef: ${ref}\n\nPlease arrive 10 minutes early.`;
    const waUrl = `https://wa.me/91${phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`;
    window.open(waUrl, "_blank", "noopener,noreferrer");

    setBookingRef(ref);
    setBooking(false);
    setStep("confirm");
  };

  const brandColor = hospital?.primary_color || "#1A2F5A";

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Loader2 size={28} className="animate-spin text-slate-400" />
    </div>
  );

  if (notFound) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <AlertCircle size={40} className="text-slate-400 mx-auto mb-3" />
        <p className="text-[16px] font-semibold text-slate-700">Hospital not found</p>
        <p className="text-[13px] text-slate-500 mt-1">Check the URL and try again.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="text-white py-6 px-4" style={{ backgroundColor: brandColor }}>
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          {hospital?.logo_url ? (
            <img src={hospital.logo_url} alt="logo" className="h-12 object-contain" />
          ) : (
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
              <Calendar size={22} className="text-white" />
            </div>
          )}
          <div>
            <h1 className="text-[20px] font-bold">{hospital?.name}</h1>
            <p className="text-[13px] opacity-75">Book an Appointment</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* ── Step: Select doctor + slot ── */}
        {step === "select" && (
          <div className="space-y-5">
            {/* Doctor search */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <p className="text-[14px] font-semibold text-slate-800 mb-3">Choose Doctor</p>
              <div className="relative mb-3">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by name or specialty…"
                  className="pl-9 h-10 text-[14px]"
                />
              </div>
              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {filteredDoctors.map(d => (
                  <button
                    key={d.id}
                    onClick={() => setSelectedDoctor(d)}
                    className={cn(
                      "w-full text-left p-3 rounded-xl border transition-colors",
                      selectedDoctor?.id === d.id
                        ? "border-blue-500 bg-blue-50"
                        : "border-slate-100 hover:border-slate-300 hover:bg-slate-50"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[14px] font-semibold text-slate-800">Dr. {d.full_name}</p>
                        {d.department_name && <p className="text-[12px] text-slate-500">{d.department_name}</p>}
                      </div>
                      {d.consultation_fee && (
                        <span className="text-[12px] text-slate-600 font-medium">₹{d.consultation_fee}</span>
                      )}
                    </div>
                  </button>
                ))}
                {filteredDoctors.length === 0 && (
                  <p className="text-[13px] text-slate-400 text-center py-4">No doctors found.</p>
                )}
              </div>
            </div>

            {/* Date picker */}
            {selectedDoctor && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                <p className="text-[14px] font-semibold text-slate-800 mb-3">Select Date</p>
                <div className="flex items-center gap-2 mb-4">
                  <button onClick={() => setSelectedDate(d => { const n = subDays(d, 1); return n >= startOfDay(new Date()) ? n : d; })} className="p-2 rounded-lg border hover:bg-slate-50 text-slate-500 disabled:opacity-30">
                    <ChevronLeft size={16} />
                  </button>
                  <div className="flex-1 grid grid-cols-7 gap-1">
                    {Array.from({ length: 7 }, (_, i) => {
                      const day = addDays(new Date(), i);
                      const isSelected = format(day, "yyyy-MM-dd") === format(selectedDate, "yyyy-MM-dd");
                      return (
                        <button
                          key={i}
                          onClick={() => setSelectedDate(day)}
                          className={cn(
                            "flex flex-col items-center py-2 rounded-xl border text-[11px] font-medium transition-colors",
                            isSelected ? "border-blue-500 bg-blue-500 text-white" : "border-slate-100 hover:border-slate-300 text-slate-700"
                          )}
                        >
                          <span>{format(day, "EEE")}</span>
                          <span className="text-[14px] font-bold mt-0.5">{format(day, "d")}</span>
                        </button>
                      );
                    })}
                  </div>
                  <button onClick={() => setSelectedDate(d => addDays(d, 1))} className="p-2 rounded-lg border hover:bg-slate-50 text-slate-500">
                    <ChevronRight size={16} />
                  </button>
                </div>

                {/* Visit type */}
                <div className="flex gap-2 mb-4">
                  {Object.entries(TYPE_LABELS).map(([v, l]) => (
                    <button key={v} onClick={() => setVisitType(v)}
                      className={cn("flex-1 py-2 rounded-xl text-[12px] font-medium border transition-colors",
                        visitType === v ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-100 text-slate-600 hover:border-slate-300"
                      )}>
                      {l}
                    </button>
                  ))}
                </div>

                {/* Slots */}
                {slotsLoading ? (
                  <div className="flex items-center justify-center py-6"><Loader2 size={20} className="animate-spin text-slate-400" /></div>
                ) : slots.length === 0 ? (
                  <p className="text-[13px] text-slate-400 text-center py-4">No slots available on this date.</p>
                ) : (
                  <div className="grid grid-cols-4 gap-2">
                    {slots.map(s => {
                      const full = s.booked_count >= s.max_patients;
                      const selected = selectedSlot?.id === s.id;
                      return (
                        <button
                          key={s.id}
                          disabled={full}
                          onClick={() => setSelectedSlot(s)}
                          className={cn(
                            "py-2 rounded-xl text-[12px] font-medium border transition-colors",
                            full ? "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed line-through"
                            : selected ? "border-blue-500 bg-blue-500 text-white"
                            : "border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-slate-700"
                          )}
                        >
                          {fmtTime(s.slot_time)}
                          {!full && <div className="text-[10px] opacity-70">{s.max_patients - s.booked_count} left</div>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Proceed button */}
            {selectedSlot && (
              <Button
                onClick={() => setStep("form")}
                className="w-full h-12 text-[15px] font-semibold"
                style={{ backgroundColor: brandColor }}
              >
                Continue — {format(selectedDate, "dd MMM")} at {fmtTime(selectedSlot.slot_time)}
              </Button>
            )}
          </div>
        )}

        {/* ── Step: Patient form ── */}
        {step === "form" && selectedDoctor && selectedSlot && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
            <button onClick={() => setStep("select")} className="flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-700 mb-2">
              <ChevronLeft size={14} /> Back to slot selection
            </button>

            <div className="bg-slate-50 rounded-xl p-3 space-y-1">
              <p className="text-[13px] font-semibold text-slate-800">Dr. {selectedDoctor.full_name}</p>
              <p className="text-[12px] text-slate-500">{format(selectedDate, "dd MMM yyyy")} · {fmtTime(selectedSlot.slot_time)} · {TYPE_LABELS[visitType]}</p>
              {selectedDoctor.consultation_fee && <p className="text-[12px] text-slate-600">Fee: ₹{selectedDoctor.consultation_fee}</p>}
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[13px] font-medium text-slate-700 block mb-1">Full Name *</label>
                <div className="relative">
                  <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input value={name} onChange={e => setName(e.target.value)} placeholder="Patient full name" className="pl-9 h-11 text-[14px]" />
                </div>
              </div>
              <div>
                <label className="text-[13px] font-medium text-slate-700 block mb-1">Mobile Number * (for WhatsApp confirmation)</label>
                <div className="relative">
                  <Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="10-digit mobile number" type="tel" className="pl-9 h-11 text-[14px]" />
                </div>
              </div>
              <div>
                <label className="text-[13px] font-medium text-slate-700 block mb-1">Chief Complaint (optional)</label>
                <Input value={complaint} onChange={e => setComplaint(e.target.value)} placeholder="Brief reason for visit…" className="h-11 text-[14px]" />
              </div>
            </div>

            {bookingError && (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3">
                <AlertCircle size={15} className="text-red-600 mt-0.5 flex-shrink-0" />
                <p className="text-[13px] text-red-700">{bookingError}</p>
              </div>
            )}

            <Button
              onClick={confirmBooking}
              disabled={booking || !name.trim() || !phone.trim()}
              className="w-full h-12 text-[15px] font-semibold gap-2"
              style={{ backgroundColor: brandColor }}
            >
              {booking ? <><Loader2 size={16} className="animate-spin" /> Booking…</> : "Confirm Appointment"}
            </Button>
          </div>
        )}

        {/* ── Step: Confirmation ── */}
        {step === "confirm" && selectedDoctor && selectedSlot && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
              <CheckCircle2 size={32} className="text-green-600" />
            </div>
            <div>
              <p className="text-[20px] font-bold text-slate-800">Appointment Confirmed!</p>
              <p className="text-[14px] text-slate-500 mt-1">A WhatsApp confirmation has been sent to {phone}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 text-left space-y-2">
              <p className="text-[12px] text-slate-500 font-mono">Ref: {bookingRef}</p>
              <p className="text-[14px] font-semibold text-slate-800">Dr. {selectedDoctor.full_name}</p>
              <p className="text-[13px] text-slate-600">{format(selectedDate, "EEEE, dd MMM yyyy")} · {fmtTime(selectedSlot.slot_time)}</p>
              <p className="text-[13px] text-slate-600">{hospital?.name}</p>
              {hospital?.address && <p className="text-[12px] text-slate-500">{hospital.address}</p>}
            </div>
            <p className="text-[12px] text-slate-400">Please arrive 10 minutes before your appointment time.</p>
            <button onClick={() => { setStep("select"); setSelectedSlot(null); setSelectedDoctor(null); setName(""); setPhone(""); setComplaint(""); setBookingError(""); }} className="text-[13px] text-blue-600 hover:underline">
              Book another appointment
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

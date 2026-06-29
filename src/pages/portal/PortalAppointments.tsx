import React, { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { PortalSession } from "./PortalLogin";
import { ArrowLeft, Check, ChevronDown, ChevronUp, Calendar } from "lucide-react";
import { toast } from "sonner";
import { sendAppointmentConfirmation } from "@/lib/whatsapp-notifications";
import VoiceInputButton from "@/components/portal/VoiceInputButton";
import LanguageSelector from "@/components/portal/LanguageSelector";

const DEPT_ICONS: Record<string, string> = {
  "general medicine": "🏥", medicine: "🏥",
  gynaecology: "👩‍⚕️", gynecology: "👩‍⚕️", "obs & gynae": "👩‍⚕️",
  orthopaedics: "🦴", orthopedics: "🦴",
  cardiology: "❤️",
  paediatrics: "👶", pediatrics: "👶",
  ent: "👂",
  ophthalmology: "👁️",
  dentistry: "🦷", dental: "🦷",
};

function getDeptIcon(name: string) {
  const key = name.toLowerCase();
  for (const [k, v] of Object.entries(DEPT_ICONS)) {
    if (key.includes(k)) return v;
  }
  return "🩺";
}

function getNext7Days() {
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
}

const SLOTS = [
  "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
  "12:00", "12:30", "14:00", "14:30", "15:00", "15:30",
  "16:00", "16:30", "17:00",
];

const PortalAppointments: React.FC<{ session: PortalSession }> = ({ session }) => {
  const [tab, setTab] = useState<"book" | "history">("book");

  return (
    <div className="px-4 py-0">
      {/* Tabs */}
      <div className="flex" style={{ height: 44, borderBottom: "1px solid #E2E8F0" }}>
        {[
          { key: "book" as const, label: "📅 Book New" },
          { key: "history" as const, label: "📋 My History" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex-1 text-sm font-medium transition-colors"
            style={{
              color: tab === t.key ? "#0E7B7B" : "#94A3B8",
              borderBottom: tab === t.key ? "2px solid #0E7B7B" : "2px solid transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "book" ? (
        <BookNewTab session={session} />
      ) : (
        <HistoryTab session={session} />
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════ */
/* BOOK NEW TAB — 4-step wizard               */
/* ═══════════════════════════════════════════ */
const BookNewTab: React.FC<{ session: PortalSession }> = ({ session }) => {
  const [step, setStep] = useState(1);
  const [departments, setDepartments] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [selectedDept, setSelectedDept] = useState<any>(null);
  const [selectedDoctor, setSelectedDoctor] = useState<any>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [visitMode, setVisitMode] = useState<"in_person" | "teleconsult">("in_person");
  const [notes, setNotes] = useState("");
  const [voiceLang, setVoiceLang] = useState("en");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [teleconsultSessionId, setTeleconsultSessionId] = useState<string | null>(null);

  // Step 1: load departments
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("departments")
        .select("id, name, type")
        .eq("hospital_id", session.hospitalId)
        .eq("is_active", true)
        .order("name");
      setDepartments(data || []);
      setLoading(false);
    })();
  }, [session.hospitalId]);

  // Step 2: load doctors for dept
  useEffect(() => {
    if (!selectedDept) return;
    (async () => {
      const { data } = await supabase
        .from("users")
        .select("id, full_name, department_id")
        .eq("hospital_id", session.hospitalId)
        .eq("department_id", selectedDept.id)
        .eq("role", "doctor")
        .eq("is_active", true)
        .order("full_name");
      setDoctors(data || []);
    })();
  }, [selectedDept, session.hospitalId]);

  const dates = useMemo(() => getNext7Days(), []);

  if (success) {
    return (
      <div className="py-16 text-center">
        <div
          className="w-16 h-16 rounded-full mx-auto flex items-center justify-center mb-4"
          style={{ background: "#DCFCE7" }}
        >
          <Check size={32} style={{ color: "#15803D" }} />
        </div>
        <p className="text-lg font-bold" style={{ color: "#0F172A" }}>Appointment Confirmed!</p>
        <div className="mt-4 bg-white rounded-xl p-4 text-left mx-auto max-w-xs" style={{ border: "1px solid #E2E8F0" }}>
          <p className="text-sm font-bold" style={{ color: "#0F172A" }}>Dr. {selectedDoctor?.full_name}</p>
          <p className="text-xs mt-1" style={{ color: "#64748B" }}>{selectedDept?.name}</p>
          <p className="text-xs mt-1" style={{ color: "#64748B" }}>
            {selectedDate?.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} at {selectedSlot}
          </p>
        </div>
        {visitMode === "teleconsult" && teleconsultSessionId && (
          <a
            href={`/join/${teleconsultSessionId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex items-center justify-center gap-2 rounded-xl text-white text-sm font-bold py-3 px-4"
            style={{ background: "#0E7B7B" }}
          >
            📹 Join Video Consult
          </a>
        )}
        <button
          onClick={() => { setSuccess(false); setStep(1); setSelectedDept(null); setSelectedDoctor(null); setSelectedDate(null); setSelectedSlot(null); setNotes(""); setVisitMode("in_person"); setTeleconsultSessionId(null); }}
          className="mt-6 text-sm font-bold"
          style={{ color: "#0E7B7B" }}
        >
          Book Another
        </button>
      </div>
    );
  }

  const handleConfirm = async () => {
    if (!selectedDoctor || !selectedDate || !selectedSlot) return;
    setSubmitting(true);

    // Count existing tokens for that day+doctor to generate token number
    const visitDate = selectedDate.toISOString().slice(0, 10);
    const { count } = await supabase
      .from("opd_tokens")
      .select("id", { count: "exact", head: true })
      .eq("hospital_id", session.hospitalId)
      .eq("doctor_id", selectedDoctor.id)
      .eq("visit_date", visitDate);

    const tokenNum = `P${((count || 0) + 1).toString().padStart(3, "0")}`;

    const { data: tokenData, error } = await supabase.from("opd_tokens").insert({
      hospital_id: session.hospitalId,
      patient_id: session.patientId,
      doctor_id: selectedDoctor.id,
      department_id: selectedDept?.id || null,
      visit_date: visitDate,
      token_number: tokenNum,
      status: "waiting",
      priority: "normal",
      visit_mode: visitMode,
    } as any).select("id").maybeSingle();

    // If video consult, create a linked teleconsult session
    let sessionId: string | null = null;
    if (!error && visitMode === "teleconsult" && tokenData?.id) {
      const roomId = crypto.randomUUID();
      const scheduledAt = new Date(`${visitDate}T${selectedSlot?.replace(":", ":")}:00`).toISOString();
      const { data: tsData } = await (supabase as any)
        .from("teleconsult_sessions")
        .insert({
          hospital_id: session.hospitalId,
          patient_id: session.patientId,
          doctor_id: selectedDoctor.id,
          opd_token_id: tokenData.id,
          room_id: roomId,
          scheduled_at: scheduledAt,
          duration_minutes: 30,
          patient_phone: session.phone,
          status: "scheduled",
        })
        .select("id")
        .maybeSingle();
      sessionId = tsData?.id || null;
      setTeleconsultSessionId(sessionId);
    }

    setSubmitting(false);
    if (error) {
      toast.error("Could not book appointment. Please try again.");
    } else {
      // Send WhatsApp confirmation
      const dateStr = selectedDate.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
      const result = await sendAppointmentConfirmation({
        hospitalId: session.hospitalId,
        hospitalName: session.hospitalName,
        patientId: session.patientId,
        patientName: session.fullName,
        phone: session.phone,
        doctorName: selectedDoctor.full_name,
        department: selectedDept?.name,
        date: dateStr,
        time: selectedSlot || undefined,
        tokenNumber: tokenNum,
      });
      // For teleconsult, send WhatsApp with join link
      if (visitMode === "teleconsult" && sessionId) {
        const joinUrl = `${window.location.origin}/join/${sessionId}`;
        const doctorLine = `Dr. ${selectedDoctor.full_name}`;
        const msg = `📹 Video Consult Confirmed!\n\nDoctor: ${doctorLine}\nDate: ${dateStr} at ${selectedSlot}\n\nJoin here: ${joinUrl}\n\nPlease join 5 minutes early.`;
        const clean = session.phone.replace(/\D/g, "");
        const intl = clean.startsWith("91") ? clean : `91${clean}`;
        window.open(`https://wa.me/${intl}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
      } else {
        window.open(result.waUrl, "_blank", "noopener,noreferrer");
      }
      setSuccess(true);
    }
  };

  return (
    <div className="py-4">
      {/* STEP 1 — DEPARTMENT */}
      {step === 1 && (
        <>
          <p className="text-base font-bold mb-3" style={{ color: "#0F172A" }}>Which department?</p>
          {loading ? (
            <SkeletonGrid />
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {departments.map((d) => (
                <button
                  key={d.id}
                  onClick={() => { setSelectedDept(d); setStep(2); }}
                  className="bg-white rounded-xl p-3.5 text-left flex items-center gap-2.5 transition-all active:scale-95"
                  style={{ border: "1px solid #E2E8F0" }}
                >
                  <span className="text-2xl">{getDeptIcon(d.name)}</span>
                  <span className="text-[13px] font-bold" style={{ color: "#374151" }}>{d.name}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* STEP 2 — DOCTOR */}
      {step === 2 && (
        <>
          <button onClick={() => setStep(1)} className="flex items-center gap-1 text-sm mb-3" style={{ color: "#0E7B7B" }}>
            <ArrowLeft size={16} /> Back
          </button>
          <p className="text-base font-bold mb-3" style={{ color: "#0F172A" }}>Select Doctor</p>
          {doctors.length === 0 ? (
            <EmptyCard text="No doctors available in this department" />
          ) : (
            <div className="space-y-2.5">
              {doctors.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => { setSelectedDoctor(doc); setStep(3); }}
                  className="w-full bg-white rounded-xl p-3.5 text-left flex items-center gap-3 transition-all active:scale-[0.98]"
                  style={{ border: "1px solid #E2E8F0" }}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                    style={{ background: "#0E7B7B" }}
                  >
                    {doc.full_name?.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-bold" style={{ color: "#0F172A" }}>Dr. {doc.full_name}</p>
                    <p className="text-xs" style={{ color: "#64748B" }}>{selectedDept?.name}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* STEP 3 — VISIT TYPE + DATE + TIME */}
      {step === 3 && (
        <>
          <button onClick={() => setStep(2)} className="flex items-center gap-1 text-sm mb-3" style={{ color: "#0E7B7B" }}>
            <ArrowLeft size={16} /> Back
          </button>

          {/* Visit type toggle */}
          <p className="text-sm font-bold mb-2" style={{ color: "#0F172A" }}>Visit Type</p>
          <div className="flex gap-2 mb-4">
            {[
              { key: "in_person" as const, label: "🏥 In-Person" },
              { key: "teleconsult" as const, label: "📹 Video Consult" },
            ].map((m) => (
              <button
                key={m.key}
                onClick={() => setVisitMode(m.key)}
                className="flex-1 rounded-xl py-2.5 text-sm font-bold transition-all"
                style={{
                  background: visitMode === m.key ? "#0E7B7B" : "#FFFFFF",
                  color: visitMode === m.key ? "#FFFFFF" : "#374151",
                  border: visitMode === m.key ? "1.5px solid #0E7B7B" : "1.5px solid #E2E8F0",
                }}
              >
                {m.label}
              </button>
            ))}
          </div>

          <p className="text-base font-bold mb-3" style={{ color: "#0F172A" }}>Select Date</p>

          {/* Horizontal date scroller */}
          <div className="flex gap-2 overflow-x-auto pb-3 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
            {dates.map((d) => {
              const isSelected = selectedDate?.toDateString() === d.toDateString();
              const isToday = d.toDateString() === new Date().toDateString();
              return (
                <button
                  key={d.toISOString()}
                  onClick={() => setSelectedDate(d)}
                  className="shrink-0 w-14 rounded-xl py-2.5 flex flex-col items-center transition-all"
                  style={{
                    background: isSelected ? "#0E7B7B" : "#FFFFFF",
                    border: isSelected ? "1.5px solid #0E7B7B" : "1.5px solid #E2E8F0",
                    color: isSelected ? "#FFFFFF" : "#374151",
                  }}
                >
                  <span className="text-[10px] font-medium" style={{ opacity: 0.8 }}>
                    {d.toLocaleDateString("en-IN", { weekday: "short" })}
                  </span>
                  <span className="text-lg font-bold">{d.getDate()}</span>
                  {isToday && !isSelected && (
                    <span className="text-[8px] font-bold" style={{ color: "#0E7B7B" }}>TODAY</span>
                  )}
                </button>
              );
            })}
          </div>

          {selectedDate && (
            <>
              <p className="text-sm font-bold mb-2 mt-2" style={{ color: "#0F172A" }}>Available Slots</p>
              <div className="grid grid-cols-3 gap-2">
                {SLOTS.map((s) => {
                  const isSelected = selectedSlot === s;
                  return (
                    <button
                      key={s}
                      onClick={() => { setSelectedSlot(s); setStep(4); }}
                      className="rounded-lg py-2.5 text-sm font-bold transition-all"
                      style={{
                        background: isSelected ? "#0E7B7B" : "#FFFFFF",
                        color: isSelected ? "#FFFFFF" : "#374151",
                        border: isSelected ? "1.5px solid #0E7B7B" : "1.5px solid #E2E8F0",
                      }}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* STEP 4 — CONFIRM */}
      {step === 4 && (
        <>
          <button onClick={() => setStep(3)} className="flex items-center gap-1 text-sm mb-3" style={{ color: "#0E7B7B" }}>
            <ArrowLeft size={16} /> Back
          </button>
          <p className="text-base font-bold mb-3" style={{ color: "#0F172A" }}>Confirm Appointment</p>

          <div className="bg-white rounded-xl p-4 space-y-2" style={{ border: "1px solid #E2E8F0" }}>
            <Row label="Doctor" value={`Dr. ${selectedDoctor?.full_name}`} />
            <Row label="Department" value={selectedDept?.name} />
            <Row label="Date" value={selectedDate?.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })} />
            <Row label="Time" value={selectedSlot || ""} />
            <Row label="Patient" value={session.fullName} />
            <Row label="Visit Type" value={visitMode === "teleconsult" ? "📹 Video Consult" : "🏥 In-Person"} />
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-gray-500">Any specific concern? (optional)</span>
              <div className="flex items-center gap-2">
                <LanguageSelector value={voiceLang} onChange={setVoiceLang} compact />
                <VoiceInputButton
                  languageCode={voiceLang}
                  onTranscript={t => setNotes(prev => prev ? prev + " " + t : t)}
                  patientId={session.patientId}
                  hospitalId={session.hospitalId}
                  sessionType="appointment_booking"
                  size="sm"
                />
              </div>
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Speak or type your concern..."
              rows={2}
              className="w-full rounded-lg p-3 text-sm resize-none"
              style={{ border: "1.5px solid #E2E8F0", outline: "none" }}
            />
          </div>

          <button
            onClick={handleConfirm}
            disabled={submitting}
            className="w-full mt-4 rounded-xl text-white font-bold text-[15px] flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-60"
            style={{ height: 52, background: "#0E7B7B" }}
          >
            {submitting ? "Booking..." : "✓ Confirm Appointment"}
          </button>
        </>
      )}
    </div>
  );
};

const Row: React.FC<{ label: string; value?: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between">
    <span className="text-xs" style={{ color: "#94A3B8" }}>{label}</span>
    <span className="text-sm font-bold" style={{ color: "#0F172A" }}>{value}</span>
  </div>
);

/* ═══════════════════════════════════════════ */
/* HISTORY TAB                                 */
/* ═══════════════════════════════════════════ */
const HistoryTab: React.FC<{ session: PortalSession }> = ({ session }) => {
  const [encounters, setEncounters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // Fetch tokens (which serve as appointments)
      const { data: tokens } = await supabase
        .from("opd_tokens")
        .select("id, token_number, visit_date, status, priority, doctor_id, department_id, visit_mode")
        .eq("patient_id", session.patientId)
        .eq("hospital_id", session.hospitalId)
        .order("visit_date", { ascending: false })
        .limit(20);

      // Enrich with doctor + dept names
      const enriched = await Promise.all(
        (tokens || []).map(async (t) => {
          let doctorName = "";
          let deptName = "";
          if (t.doctor_id) {
            const { data: doc } = await supabase
              .from("users")
              .select("full_name, department_id")
              .eq("id", t.doctor_id)
              .maybeSingle();
            doctorName = doc?.full_name || "";
            if (t.department_id) {
              const { data: dept } = await supabase
                .from("departments")
                .select("name")
                .eq("id", t.department_id)
                .maybeSingle();
              deptName = dept?.name || "";
            }
          }

          // Try to find corresponding encounter
          let encounter: any = null;
          const { data: enc } = await supabase
            .from("opd_encounters")
            .select("chief_complaint, diagnosis, soap_plan")
            .eq("token_id", t.id)
            .maybeSingle();
          if (enc) encounter = enc;

          return { ...t, doctorName, deptName, encounter };
        })
      );

      setEncounters(enriched);
      setLoading(false);
    })();
  }, [session]);

  const today = new Date().toISOString().slice(0, 10);

  const getStatusStyle = (status: string, visitDate: string) => {
    if (status === "completed" || status === "consultation_done")
      return { color: "#15803D", bg: "#DCFCE7", label: "Completed" };
    if (status === "cancelled")
      return { color: "#EF4444", bg: "#FEE2E2", label: "Cancelled" };
    if (visitDate >= today)
      return { color: "#0E7B7B", bg: "#EEF9F9", label: "Upcoming" };
    return { color: "#64748B", bg: "#F1F5F9", label: status };
  };

  return (
    <div className="py-4">
      {loading ? (
        <SkeletonList />
      ) : encounters.length === 0 ? (
        <EmptyCard text="No appointment history found" />
      ) : (
        <div className="space-y-2.5">
          {encounters.map((t) => {
            const s = getStatusStyle(t.status, t.visit_date);
            const isExp = expanded === t.id;
            return (
              <div key={t.id} className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #E2E8F0" }}>
                <button onClick={() => setExpanded(isExp ? null : t.id)} className="w-full p-3.5 text-left">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-mono" style={{ color: "#94A3B8" }}>Token #{t.token_number}</span>
                    <span
                      className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                      style={{ color: s.color, background: s.bg }}
                    >
                      {s.label}
                    </span>
                  </div>
                  <p className="text-sm font-bold" style={{ color: "#0F172A" }}>
                    {t.doctorName ? `Dr. ${t.doctorName}` : "Doctor"}
                  </p>
                  <div className="flex items-center justify-between mt-0.5">
                    <div className="flex items-center gap-1.5">
                      {(t as any).visit_mode === "teleconsult" && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "#EEF9F9", color: "#0E7B7B" }}>📹 Video</span>
                      )}
                      <p className="text-xs" style={{ color: "#64748B" }}>
                        {t.deptName && `${t.deptName} · `}
                        {new Date(t.visit_date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </div>
                    {t.encounter && (isExp ? <ChevronUp size={14} color="#94A3B8" /> : <ChevronDown size={14} color="#94A3B8" />)}
                  </div>
                </button>

                {isExp && t.encounter && (
                  <div className="px-3.5 pb-3.5 space-y-1.5" style={{ borderTop: "1px solid #F1F5F9" }}>
                    {t.encounter.chief_complaint && (
                      <Detail label="Chief Complaint" value={t.encounter.chief_complaint} />
                    )}
                    {t.encounter.diagnosis && (
                      <Detail label="Diagnosis" value={t.encounter.diagnosis} />
                    )}
                    {t.encounter.soap_plan && (
                      <Detail label="Plan" value={t.encounter.soap_plan} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const Detail: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <span className="text-[10px] font-bold uppercase" style={{ color: "#94A3B8" }}>{label}</span>
    <p className="text-xs" style={{ color: "#374151" }}>{value}</p>
  </div>
);

const EmptyCard: React.FC<{ text: string }> = ({ text }) => (
  <div className="bg-white rounded-xl p-10 text-center" style={{ border: "1px solid #E2E8F0" }}>
    <p className="text-sm" style={{ color: "#94A3B8" }}>{text}</p>
  </div>
);

const SkeletonList: React.FC = () => (
  <div className="space-y-2.5">
    {[1, 2, 3].map((i) => (
      <div key={i} className="bg-white rounded-xl p-4 animate-pulse" style={{ border: "1px solid #E2E8F0" }}>
        <div className="h-3 w-20 rounded" style={{ background: "#E2E8F0" }} />
        <div className="h-4 w-32 rounded mt-2" style={{ background: "#E2E8F0" }} />
      </div>
    ))}
  </div>
);

const SkeletonGrid: React.FC = () => (
  <div className="grid grid-cols-2 gap-2.5">
    {[1, 2, 3, 4].map((i) => (
      <div key={i} className="bg-white rounded-xl p-4 animate-pulse" style={{ border: "1px solid #E2E8F0", height: 60 }}>
        <div className="h-4 w-20 rounded" style={{ background: "#E2E8F0" }} />
      </div>
    ))}
  </div>
);

export default PortalAppointments;

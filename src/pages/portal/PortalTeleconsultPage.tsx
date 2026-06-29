import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { usePatientPortal } from "@/contexts/PatientPortalContext";
import {
  Video, CalendarX, Clock, ChevronRight,
  FileText, Pill, ExternalLink, RefreshCw,
} from "lucide-react";

// ── Join-window configuration ─────────────────────────────────────────────
const JOIN_BEFORE_MIN = 10;   // patient may join this many minutes before start
const JOIN_AFTER_MIN  = 30;   // and up to this many minutes after start

// ── Types ─────────────────────────────────────────────────────────────────
interface TeleSession {
  id: string;
  scheduled_at: string;
  duration_minutes: number | null;
  status: string;
  room_id: string;
  doctor_id: string;
  encounter_id: string | null;
  prescription_sent: boolean | null;
  bill_id: string | null;
  doctorName: string;
}

// ── Time helpers ──────────────────────────────────────────────────────────
function inJoinWindow(scheduledAt: string): boolean {
  const now  = Date.now();
  const start = new Date(scheduledAt).getTime();
  return now >= start - JOIN_BEFORE_MIN * 60_000 &&
         now <= start + JOIN_AFTER_MIN  * 60_000;
}

function minutesUntilWindow(scheduledAt: string): number {
  const windowOpen = new Date(scheduledAt).getTime() - JOIN_BEFORE_MIN * 60_000;
  return Math.max(0, Math.ceil((windowOpen - Date.now()) / 60_000));
}

function fmtDT(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      weekday: "short", day: "numeric", month: "short",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch { return iso; }
}

// ── Status display config ─────────────────────────────────────────────────
const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  scheduled:   { label: "Scheduled",   color: "#0E7B7B", bg: "#ECFDF5" },
  waiting:     { label: "Waiting",     color: "#D97706", bg: "#FEF3C7" },
  in_progress: { label: "● Live",      color: "#059669", bg: "#D1FAE5" },
  completed:   { label: "Completed",   color: "#64748B", bg: "#F1F5F9" },
  cancelled:   { label: "Cancelled",   color: "#EF4444", bg: "#FEF2F2" },
  missed:      { label: "Missed",      color: "#EF4444", bg: "#FEF2F2" },
};

// ── Skeleton ──────────────────────────────────────────────────────────────
const Skeleton: React.FC = () => (
  <div className="space-y-2">
    {[1, 2].map((i) => (
      <div key={i} className="bg-white rounded-xl p-4 animate-pulse" style={{ border: "1px solid #E2E8F0" }}>
        <div className="h-3 w-20 rounded" style={{ background: "#E2E8F0" }} />
        <div className="h-4 w-36 rounded mt-2" style={{ background: "#E2E8F0" }} />
        <div className="h-3 w-28 rounded mt-1.5" style={{ background: "#E2E8F0" }} />
      </div>
    ))}
  </div>
);

// ── Upcoming Session Card ─────────────────────────────────────────────────
const UpcomingCard: React.FC<{ s: TeleSession; onJoin: () => void }> = ({ s, onJoin }) => {
  const cfg     = STATUS_CFG[s.status] ?? STATUS_CFG.scheduled;
  const inWindow = inJoinWindow(s.scheduled_at);
  const minsLeft = minutesUntilWindow(s.scheduled_at);
  const isLive   = s.status === "in_progress";

  return (
    <div
      className="bg-white rounded-xl p-3.5"
      style={{ border: "1px solid #E2E8F0", borderLeft: `3px solid ${cfg.color}` }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ color: cfg.color, background: cfg.bg }}
            >
              {cfg.label}
            </span>
          </div>
          <p className="text-[13px] font-bold" style={{ color: "#0F172A" }}>
            {s.doctorName || "Doctor"}
          </p>
          <p className="text-xs mt-0.5 flex items-center gap-1" style={{ color: "#64748B" }}>
            <Clock size={11} />
            {fmtDT(s.scheduled_at)}
            {s.duration_minutes ? ` · ${s.duration_minutes} min` : ""}
          </p>

          {/* Join-window hint */}
          {!inWindow && !isLive && (
            <p className="text-[11px] mt-1.5" style={{ color: "#94A3B8" }}>
              {minsLeft > 0
                ? `Join opens in ${minsLeft} min — you can join 10 minutes before your scheduled time`
                : `You can join 10 minutes before your scheduled time`}
            </p>
          )}
          {inWindow && !isLive && (
            <p className="text-[11px] mt-1.5 font-medium" style={{ color: "#059669" }}>
              Join window is open now
            </p>
          )}
        </div>

        {/* Join button — visible only within window or when live */}
        {(inWindow || isLive) ? (
          <button
            onClick={onJoin}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-white text-xs font-bold shrink-0"
            style={{ background: isLive ? "#059669" : "#0E7B7B" }}
          >
            <Video size={13} />
            {isLive ? "Join Now" : "Join"}
          </button>
        ) : (
          <div
            className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium shrink-0"
            style={{ background: "#F1F5F9", color: "#94A3B8" }}
          >
            <Clock size={12} />
            {minsLeft}m
          </div>
        )}
      </div>
    </div>
  );
};

// ── Past Session Card ─────────────────────────────────────────────────────
const PastCard: React.FC<{ s: TeleSession; onViewReports: () => void }> = ({ s, onViewReports }) => {
  const cfg = STATUS_CFG[s.status] ?? STATUS_CFG.completed;

  return (
    <div className="bg-white rounded-xl p-3.5" style={{ border: "1px solid #E2E8F0" }}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ color: cfg.color, background: cfg.bg }}
            >
              {cfg.label}
            </span>
            {s.prescription_sent && (
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ color: "#7C3AED", background: "#EDE9FE" }}
              >
                Rx sent
              </span>
            )}
          </div>
          <p className="text-[13px] font-bold" style={{ color: "#0F172A" }}>
            {s.doctorName || "Doctor"}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "#64748B" }}>
            {fmtDate(s.scheduled_at)}
            {s.duration_minutes ? ` · ${s.duration_minutes} min` : ""}
          </p>

          {/* Links to records */}
          {(s.encounter_id || s.prescription_sent) && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {s.prescription_sent && (
                <button
                  onClick={onViewReports}
                  className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md"
                  style={{ background: "#F5F3FF", color: "#7C3AED" }}
                >
                  <Pill size={11} />
                  View Prescription
                </button>
              )}
              {s.encounter_id && (
                <button
                  onClick={onViewReports}
                  className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md"
                  style={{ background: "#F0FAFA", color: "#0E7B7B" }}
                >
                  <FileText size={11} />
                  View Reports
                </button>
              )}
            </div>
          )}
        </div>

        <ChevronRight size={16} color="#CBD5E1" className="mt-1 shrink-0" />
      </div>
    </div>
  );
};

// ── Root component ────────────────────────────────────────────────────────
const PortalTeleconsultPage: React.FC<{ session?: unknown }> = () => {
  const { patientId, hospitalId, patient } = usePatientPortal();
  const navigate = useNavigate();

  const [upcoming, setUpcoming] = useState<TeleSession[]>([]);
  const [past,     setPast]     = useState<TeleSession[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [, setTick]             = useState(0); // re-render to refresh countdown

  // Tick every 30 s so join-window state recalculates automatically
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    if (!patientId || !hospitalId) return;

    const base = (supabase as any)
      .from("teleconsult_sessions")
      .select("id, scheduled_at, duration_minutes, status, room_id, doctor_id, encounter_id, prescription_sent, bill_id, users!doctor_id(full_name)")
      .eq("patient_id", patientId)
      .eq("hospital_id", hospitalId);

    const [{ data: up }, { data: done }] = await Promise.all([
      base
        .in("status", ["scheduled", "waiting", "in_progress"])
        .order("scheduled_at", { ascending: true })
        .limit(10),
      base
        .in("status", ["completed", "cancelled", "missed"])
        .order("scheduled_at", { ascending: false })
        .limit(15),
    ]);

    const enrich = (rows: any[]): TeleSession[] =>
      (rows || []).map((r) => ({
        ...r,
        doctorName: r.users?.full_name ? `Dr. ${r.users.full_name}` : "Doctor",
      }));

    setUpcoming(enrich(up));
    setPast(enrich(done));
    setLoading(false);
  }, [patientId, hospitalId]);

  useEffect(() => { load(); }, [load]);

  // Realtime — refresh when any session for this patient changes status
  useEffect(() => {
    if (!hospitalId) return;
    const ch = supabase
      .channel(`portal-tele-${patientId}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "teleconsult_sessions",
        filter: `hospital_id=eq.${hospitalId}`,
      }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [hospitalId, patientId, load]);

  const handleJoin = (s: TeleSession) => {
    // Mark patient as waiting (updates status for doctor's view)
    if (s.status === "scheduled") {
      (supabase as any)
        .from("teleconsult_sessions")
        .update({ status: "waiting", patient_joined_at: new Date().toISOString() })
        .eq("id", s.id);
    }
    // Patient token = base64-encoded patientId passed as query param
    const token = btoa(patientId ?? "");
    window.open(`/join/${s.id}?pt=${token}`, "_blank", "noopener,noreferrer");
  };

  const goToReports = () => navigate("/portal/reports");

  if (loading) {
    return (
      <div className="px-4 py-4">
        <div className="h-5 w-40 rounded mb-4 animate-pulse" style={{ background: "#E2E8F0" }} />
        <Skeleton />
      </div>
    );
  }

  return (
    <div className="px-4 py-4 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-base font-bold" style={{ color: "#0F172A" }}>Video Teleconsult</p>
          <p className="text-xs" style={{ color: "#64748B" }}>Your online doctor consultations</p>
        </div>
        <button onClick={load} className="p-1.5 rounded-full hover:bg-slate-100">
          <RefreshCw size={15} color="#94A3B8" />
        </button>
      </div>

      {/* Upcoming */}
      <div>
        <p className="text-[11px] font-bold uppercase mb-2" style={{ color: "#94A3B8" }}>Upcoming</p>
        {upcoming.length === 0 ? (
          <div className="bg-white rounded-xl p-6 text-center" style={{ border: "1px solid #E2E8F0" }}>
            <CalendarX size={28} color="#CBD5E1" className="mx-auto mb-2" />
            <p className="text-sm" style={{ color: "#94A3B8" }}>No upcoming teleconsults</p>
            <p className="text-[11px] mt-0.5" style={{ color: "#CBD5E1" }}>
              Book one via the Appointments section
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {upcoming.map((s) => (
              <UpcomingCard key={s.id} s={s} onJoin={() => handleJoin(s)} />
            ))}
          </div>
        )}
      </div>

      {/* Past sessions */}
      {past.length > 0 && (
        <div>
          <p className="text-[11px] font-bold uppercase mb-2" style={{ color: "#94A3B8" }}>Past Sessions</p>
          <div className="space-y-2">
            {past.map((s) => (
              <PastCard key={s.id} s={s} onViewReports={goToReports} />
            ))}
          </div>
        </div>
      )}

      {/* Info banner */}
      <div className="rounded-xl p-3.5" style={{ background: "#EFF6FF", border: "1px solid #BFDBFE" }}>
        <p className="text-[11px] font-bold mb-1" style={{ color: "#1D4ED8" }}>
          ℹ️ How to join your teleconsult
        </p>
        <ul className="text-[11px] space-y-0.5" style={{ color: "#3B82F6" }}>
          <li>• The Join button appears {JOIN_BEFORE_MIN} minutes before your appointment</li>
          <li>• Allow camera and microphone access when prompted</li>
          <li>• No app required — runs directly in your browser</li>
          <li>• If you miss the window, contact the hospital to reschedule</li>
        </ul>
      </div>

      {/* External join link fallback */}
      {upcoming.some((s) => inJoinWindow(s.scheduled_at) || s.status === "in_progress") && (
        <div className="rounded-xl p-3 flex items-center gap-2" style={{ background: "#F0FDF4", border: "1px solid #BBF7D0" }}>
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#22C55E" }} />
          <p className="text-[12px] font-semibold flex-1" style={{ color: "#166534" }}>
            Active session — click Join on the card above
          </p>
          <ExternalLink size={13} color="#22C55E" />
        </div>
      )}
    </div>
  );
};

export default PortalTeleconsultPage;

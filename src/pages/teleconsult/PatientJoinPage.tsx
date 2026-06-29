import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Video, Clock, User, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { format } from "date-fns";

const STATUS_INFO: Record<string, { label: string; msg: string; color: string; icon: React.ReactNode }> = {
  scheduled: {
    label: "Scheduled",
    msg: "Your appointment is confirmed. Click 'Join Call' when you're ready.",
    color: "text-blue-600",
    icon: <Clock size={18} className="text-blue-500" />,
  },
  waiting: {
    label: "Waiting Room",
    msg: "You're in the waiting room. Your doctor will join shortly.",
    color: "text-amber-600",
    icon: <div className="w-3 h-3 rounded-full bg-amber-500 animate-pulse" />,
  },
  in_progress: {
    label: "Call Active",
    msg: "The call is in progress. Join now!",
    color: "text-emerald-600",
    icon: <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />,
  },
  completed: {
    label: "Completed",
    msg: "This teleconsult has ended.",
    color: "text-muted-foreground",
    icon: <CheckCircle2 size={18} className="text-emerald-500" />,
  },
  cancelled: {
    label: "Cancelled",
    msg: "This appointment was cancelled. Please contact the hospital to reschedule.",
    color: "text-red-600",
    icon: <XCircle size={18} className="text-red-500" />,
  },
  missed: {
    label: "Missed",
    msg: "This appointment slot was missed. Please contact the hospital to reschedule.",
    color: "text-red-600",
    icon: <XCircle size={18} className="text-red-500" />,
  },
};

const PatientJoinPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<any>(null);
  const [hospitalName, setHospitalName] = useState("Hospital");
  const [loading, setLoading] = useState(true);
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);

  const fetchSession = async () => {
    if (!sessionId) return;
    const { data } = await (supabase as any)
      .from("teleconsult_sessions")
      .select("id, room_id, scheduled_at, duration_minutes, status, patient_phone, hospital_id, patients(full_name), users!doctor_id(full_name)")
      .eq("id", sessionId)
      .maybeSingle();
    if (data) {
      setSession(data);
      // Fetch hospital name
      const { data: hosp } = await supabase.from("hospitals").select("name").eq("id", data.hospital_id).maybeSingle();
      if (hosp?.name) setHospitalName(hosp.name);
      // Auto-join if already in_progress
      if (data.status === "in_progress" || data.status === "waiting") {
        setJoined(true);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchSession();
  }, [sessionId]);

  // Real-time subscription — auto-open iframe when doctor starts the call
  useEffect(() => {
    if (!sessionId) return;
    const ch = supabase
      .channel(`patient-join-${sessionId}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "teleconsult_sessions",
        filter: `id=eq.${sessionId}`,
      }, (payload) => {
        const updated = payload.new as any;
        setSession((prev: any) => ({ ...prev, ...updated }));
        if (updated.status === "in_progress" || updated.status === "waiting") {
          setJoined(true);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [sessionId]);

  const handleJoin = async () => {
    if (!session || joining) return;
    setJoining(true);
    await (supabase as any)
      .from("teleconsult_sessions")
      .update({ status: "waiting", patient_joined_at: new Date().toISOString() })
      .eq("id", session.id);
    setSession((prev: any) => ({ ...prev, status: "waiting" }));
    setJoined(true);
    setJoining(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f0fafa] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#0E7B7B]" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-[#f0fafa] flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <XCircle size={40} className="text-red-400 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-gray-800 mb-1">Session Not Found</h2>
          <p className="text-sm text-gray-500">This link may be invalid or expired. Please contact your doctor or hospital.</p>
        </div>
      </div>
    );
  }

  const patientName = session.patients?.full_name || "Patient";
  const doctorName = session.users?.full_name ? `Dr. ${session.users.full_name}` : "Your Doctor";
  const statusInfo = STATUS_INFO[session.status] || STATUS_INFO.scheduled;
  const canJoin = ["scheduled", "waiting", "in_progress"].includes(session.status);
  const isTerminal = ["completed", "cancelled", "missed"].includes(session.status);

  if (joined && canJoin) {
    return (
      <div className="fixed inset-0 flex flex-col bg-black">
        <div className="h-10 bg-black/80 flex items-center px-4 gap-3 shrink-0">
          <Video size={14} className="text-white/70" />
          <span className="text-sm text-white">Teleconsult — {doctorName}</span>
          <span className="text-xs text-white/50 ml-auto">{hospitalName}</span>
          <button
            onClick={() => { setJoined(false); setSession((p: any) => ({ ...p, status: "completed" })); }}
            className="text-xs text-red-400 hover:text-red-300 border border-red-400/40 rounded px-2 py-0.5"
          >
            Leave
          </button>
        </div>
        <iframe
          src={`https://meet.jit.si/HMS-${session.room_id}?userDisplayName=${encodeURIComponent(patientName)}`}
          allow="camera; microphone; fullscreen; display-capture"
          className="flex-1 w-full border-none"
          title="Teleconsult"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0fafa] flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-lg p-6 max-w-sm w-full">
        {/* Hospital header */}
        <div className="flex items-center gap-2 mb-5 pb-4 border-b border-gray-100">
          <div className="w-8 h-8 rounded-full bg-[#0E7B7B] flex items-center justify-center">
            <span className="text-white text-xs font-bold">🏥</span>
          </div>
          <span className="text-sm font-semibold text-gray-700">{hospitalName}</span>
        </div>

        {/* Appointment info */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-1">
            <User size={14} className="text-[#0E7B7B]" />
            <span className="text-base font-bold text-gray-800">Teleconsult with {doctorName}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500 mt-1.5">
            <Clock size={12} />
            <span>
              {format(new Date(session.scheduled_at), "dd MMM yyyy, hh:mm a")} · {session.duration_minutes} min
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">For: <span className="font-medium text-gray-700">{patientName}</span></p>
        </div>

        {/* Status */}
        <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5 mb-5">
          {statusInfo.icon}
          <div>
            <p className={`text-xs font-bold ${statusInfo.color}`}>{statusInfo.label}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">{statusInfo.msg}</p>
          </div>
        </div>

        {/* Action */}
        {canJoin && (
          <Button
            className="w-full gap-2 bg-[#0E7B7B] hover:bg-[#0a6666]"
            onClick={handleJoin}
            disabled={joining}
          >
            {joining ? <Loader2 size={16} className="animate-spin" /> : <Video size={16} />}
            {joining ? "Connecting..." : "Join Call"}
          </Button>
        )}

        {isTerminal && (
          <div className="text-center">
            <p className="text-xs text-gray-400 mt-2">
              For help, call the hospital reception.
            </p>
          </div>
        )}

        <p className="text-[10px] text-center text-gray-300 mt-4">Powered by HMS Platform</p>
      </div>
    </div>
  );
};

export default PatientJoinPage;

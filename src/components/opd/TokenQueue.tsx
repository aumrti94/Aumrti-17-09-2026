import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Video, ChevronLeft, ChevronRight, CalendarDays, X, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalContext } from "@/contexts/HospitalContext";
import { hasActionAccess } from "@/lib/tabPermissions";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import EmptyState from "@/components/EmptyState";
import NABHBadge from "@/components/nabh/NABHBadge";
import ABHABadge from "@/components/abdm/ABHABadge";
import WalkInModal from "./WalkInModal";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared";
import { predictNoShow, type NoShowPrediction } from "@/lib/clinicalPredictions";
import { sendWhatsApp } from "@/lib/whatsapp-send";
import type { OpdToken } from "@/pages/opd/OPDPage";

interface Props {
  tokens: OpdToken[];
  selectedTokenId: string | null;
  onSelectToken: (id: string) => void;
  hospitalId: string | null;
  loading: boolean;
  onTokenCreated: () => void;
  selectedDate?: string;
  onDateChange?: (date: string) => void;
}

const statusOrder: Record<string, number> = {
  called: 0,
  in_consultation: 1,
  waiting: 2,
  completed: 3,
  no_show: 4,
  cancelled: 5,
};

// Emergency walk-ins carry the "URG" token prefix / "emergency" visit type and jump the queue.
const isEmergencyToken = (t: OpdToken) =>
  (t as any).visit_type === "emergency" || t.token_prefix === "URG";

const priorityBadge: Record<string, { label: string; bg: string; text: string }> = {
  urgent: { label: "URGENT", bg: "bg-red-100", text: "text-red-600" },
  elderly: { label: "ELDER", bg: "bg-amber-100", text: "text-amber-700" },
  pregnant: { label: "PREG", bg: "bg-pink-100", text: "text-pink-700" },
  disabled: { label: "ASSIST", bg: "bg-violet-100", text: "text-violet-700" },
};

const statusStyles: Record<string, string> = {
  waiting: "bg-white border-slate-100",
  called: "bg-orange-50 border-orange-200",
  in_consultation: "bg-blue-50 border-blue-200",
  completed: "bg-green-50 border-green-200 opacity-70",
  no_show: "bg-slate-50 border-slate-200 opacity-50",
  cancelled: "bg-slate-50 border-slate-200 opacity-50",
};

function getWaitMinutes(createdAt: string): string {
  const diff = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
  if (diff < 1) return "< 1 min";
  return `${diff} min`;
}

/**
 * TokenQueue component displays a list of OPD tokens, allowing filtering by department
 * and showing real-time updates and no-show predictions.
 */
const pad = (n: number) => String(n).padStart(2, "0");
const toLocalISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = toLocalISO(new Date());
const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return toLocalISO(d); })();

function formatDateLabel(d: string): string {
  if (d === today) return "Today";
  if (d === yesterday) return "Yesterday";
  return new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

const TokenQueue: React.FC<Props> = ({ tokens, selectedTokenId, onSelectToken, hospitalId, loading, onTokenCreated, selectedDate = today, onDateChange }) => {
  const navigate = useNavigate();
  const { permissions, role } = useHospitalContext();
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [doctors, setDoctors] = useState<{ id: string; full_name: string }[]>([]);
  const [activeDept, setActiveDept] = useState<string>("all");
  const [activeDoctor, setActiveDoctor] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showModal, setShowModal] = useState(false);
  const [predictions, setPredictions] = useState<Record<string, NoShowPrediction>>({});
  const [predictingIds, setPredictingIds] = useState<Set<string>>(new Set());
  const [reminderSending, setReminderSending] = useState<string | null>(null);
  const [noShowHistory, setNoShowHistory] = useState<Record<string, number>>({});
  const [callNextLoading, setCallNextLoading] = useState(false);
  const datePickerRef = useRef<HTMLInputElement>(null);
  const [lastCalledToken, setLastCalledToken] = useState<string | null>(null);

  useEffect(() => {
    if (!hospitalId) return;
    Promise.all([
      supabase.from("departments").select("id, name").eq("hospital_id", hospitalId).eq("is_active", true).order("name"),
      supabase.from("users").select("id, full_name").eq("hospital_id", hospitalId).eq("role", "doctor").eq("is_active", true).order("full_name"),
    ]).then(([{ data: deptData }, { data: docData }]) => {
      setDepartments(deptData || []);
      setDoctors(docData || []);
    });
  }, [hospitalId]);

  // Run no-show predictions for waiting tokens
  const runPredictions = useCallback(async () => {
    if (!hospitalId || tokens.length === 0) return;
    const waitingTokens = tokens.filter(t => t.status === "waiting" && !predictions[t.id] && !predictingIds.has(t.id));
    if (waitingTokens.length === 0) return;

    const newPredicting = new Set(predictingIds);
    waitingTokens.forEach(t => newPredicting.add(t.id));
    setPredictingIds(newPredicting);

    for (const token of waitingTokens.slice(0, 5)) {
      const result = await predictNoShow(
        { id: token.id, patient_id: token.patient_id, doctor_id: token.doctor_id, created_at: token.created_at, hospital_id: token.hospital_id },
        token.patient?.full_name || "Patient",
        token.doctor?.full_name || null
      );
      if (result) {
        setPredictions(prev => ({ ...prev, [token.id]: result }));
      }
    }
  }, [hospitalId, tokens, predictions, predictingIds]);

  useEffect(() => {
    if (!loading && tokens.length > 0) {
      const timer = setTimeout(runPredictions, 2000);
      return () => clearTimeout(timer);
    }
  }, [loading, tokens.length, runPredictions]);

  useEffect(() => {
    if (!hospitalId || tokens.length === 0) return;
    const patientIds = [...new Set(tokens.map(t => t.patient_id).filter(Boolean))];
    supabase
      .from("opd_tokens")
      .select("patient_id")
      .eq("hospital_id", hospitalId)
      .eq("status", "no_show")
      .in("patient_id", patientIds)
      .then(({ data }) => {
        const map: Record<string, number> = {};
        (data || []).forEach((r: any) => {
          map[r.patient_id] = (map[r.patient_id] || 0) + 1;
        });
        setNoShowHistory(map);
      });
  }, [hospitalId, tokens]);

  const handleSendReminder = async (token: OpdToken) => {
    if (!hospitalId || !token.patient?.phone) return;
    setReminderSending(token.id);
    const doctorName = token.doctor?.full_name || "your doctor";
    const message = `Dear ${token.patient.full_name}, reminder: your appointment with Dr. ${doctorName} is today. Please confirm attendance. Reply YES to confirm or call the hospital to reschedule.`;
    await sendWhatsApp({ hospitalId, phone: token.patient.phone, message });
    await supabase.from("no_show_predictions").update({ reminder_sent: true } as any).eq("appointment_id", token.id);
    setReminderSending(null);
  };

  const filtered = useMemo(() => {
    let list = [...tokens];
    if (activeDept !== "all") list = list.filter((t) => t.department_id === activeDept);
    if (activeDoctor !== "all") list = list.filter((t) => t.doctor_id === activeDoctor);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((t) =>
        t.patient?.full_name?.toLowerCase().includes(q) ||
        t.patient?.uhid?.toLowerCase().includes(q) ||
        t.patient?.phone?.toLowerCase().includes(q) ||
        t.token_number?.toLowerCase().includes(q) ||
        t.token_prefix?.toLowerCase().includes(q) ||
        t.doctor?.full_name?.toLowerCase().includes(q) ||
        t.department?.name?.toLowerCase().includes(q)
      );
    }
    // Order within each status: emergency (URG) first, then appointment patients by their
    // scheduled time, then walk-ins FIFO by creation.
    list.sort((a, b) => {
      const s = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
      if (s !== 0) return s;
      const e = (isEmergencyToken(a) ? 0 : 1) - (isEmergencyToken(b) ? 0 : 1);
      if (e !== 0) return e;
      const aAppt = a.appointment?.slot_time;
      const bAppt = b.appointment?.slot_time;
      const ag = (aAppt ? 0 : 1) - (bAppt ? 0 : 1);
      if (ag !== 0) return ag;
      if (aAppt && bAppt && aAppt !== bAppt) return aAppt < bAppt ? -1 : 1;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    return list;
  }, [tokens, activeDept, activeDoctor, searchQuery]);

  const hasActiveFilter = activeDept !== "all" || activeDoctor !== "all" || !!searchQuery.trim();

  // Date navigation helpers
  const goToPrevDay = () => {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() - 1);
    onDateChange?.(toLocalISO(d));
  };
  const goToNextDay = () => {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + 1);
    const next = toLocalISO(d);
    if (next <= today) onDateChange?.(next);
  };
  const isToday = selectedDate === today;

  // Start or join a teleconsult session for the given token.
  // Marks the token as "called" so the workspace opens, then navigates to /telemedicine.
  const handleStartTeleconsult = useCallback(async (token: OpdToken, e: React.MouseEvent) => {
    e.stopPropagation();
    if (token.status === "waiting") {
      const now = new Date().toISOString();
      await supabase
        .from("opd_tokens")
        .update({ status: "called", called_at: now } as any)
        .eq("id", token.id);
      onTokenCreated(); // refresh list
    }
    navigate("/teleconsult/doctor");
  }, [navigate, onTokenCreated]);

  const handleCallNext = useCallback(async () => {
    if (!hospitalId || callNextLoading) return;
    setCallNextLoading(true);
    try {
      // Only call in-person (non-teleconsult) waiting tokens.
      // Teleconsult tokens have their own per-card "Start Teleconsult" action.
      const waiting = filtered.filter(t => t.status === "waiting" && t.visit_mode !== "teleconsult");
      if (waiting.length === 0) return;
      const next = waiting[0];

      const now = new Date().toISOString();
      // Mark token as "called"
      await supabase
        .from("opd_tokens")
        .update({ status: "called", called_at: now } as any)
        .eq("id", next.id);

      // Upsert queue_state so TV display picks it up instantly
      const masked = (() => {
        const name  = next.patient?.full_name ?? "";
        const parts = name.trim().split(/\s+/);
        return parts.length > 1
          ? `${parts[0][0]}. ${parts.slice(1).join(" ")}`
          : parts[0] ? `${parts[0][0]}.` : "";
      })();

      const { data: { user } } = await supabase.auth.getUser();

      (supabase as any)
        .from("queue_state")
        .upsert({
          hospital_id:          hospitalId,
          doctor_id:            next.doctor_id ?? null,
          department_id:        next.department_id ?? null,
          current_token_id:     next.id,
          current_token_number: next.token_number,
          current_patient_name: masked,
          called_by:            user?.id ?? null,
          called_at:            now,
          updated_at:           now,
        }, { onConflict: "hospital_id,doctor_id" })
        .then(() => {}).catch(() => {});

      setLastCalledToken(`${next.token_prefix || "A"}${next.token_number}`);
      onTokenCreated(); // refresh parent
    } finally {
      setCallNextLoading(false);
    }
  }, [hospitalId, filtered, callNextLoading, onTokenCreated]);

  const waitingCount = tokens.filter((t) => t.status === "waiting").length;
  const inRoomCount = tokens.filter((t) => t.status === "in_consultation").length;
  const doneCount = tokens.filter((t) => t.status === "completed").length;

  // No-show analytics
  const highRiskCount = Object.values(predictions).filter(p => p.risk_score >= 70).length;
  const medRiskCount = Object.values(predictions).filter(p => p.risk_score >= 40 && p.risk_score < 70).length;

  return (
    <>
      <div data-tour="receptionist-token-queue" className="w-full bg-white border-r border-slate-200 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-100">
          {/* Title + date nav */}
          <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
            <span className="text-sm font-bold text-slate-900">OPD Queue</span>
            <div className="flex items-center gap-1">
              <button onClick={goToPrevDay} className="h-6 w-6 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500">
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => datePickerRef.current?.showPicker?.()}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer"
                title="Pick a date"
              >
                <CalendarDays size={11} className="text-slate-500" />
                <span className="text-[11px] font-semibold text-slate-700">{formatDateLabel(selectedDate)}</span>
              </button>
              <input
                ref={datePickerRef}
                type="date"
                value={selectedDate}
                max={today}
                onChange={(e) => onDateChange?.(e.target.value)}
                className="absolute opacity-0 w-0 h-0 pointer-events-none"
                tabIndex={-1}
              />
              <button
                onClick={goToNextDay}
                disabled={isToday}
                className="h-6 w-6 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 disabled:opacity-30"
              >
                <ChevronRight size={14} />
              </button>
              {!isToday && (
                <button onClick={() => onDateChange?.(today)} className="text-[10px] text-[#1A2F5A] font-semibold hover:underline ml-1">
                  Today
                </button>
              )}
            </div>
          </div>

          {/* Search box */}
          <div className="px-3 pb-1.5">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name, UHID, phone, token…"
                className="w-full h-7 pl-7 pr-7 text-[11px] border border-slate-200 rounded-md bg-slate-50 text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#1A2F5A]/40"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Filters: Department + Doctor */}
          <div className="px-3 pb-2.5 space-y-1.5">
            <Select value={activeDept} onValueChange={setActiveDept}>
              <SelectTrigger className="h-7 text-[11px] font-medium bg-slate-50 border-slate-200">
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-[11px]">All Departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id} className="text-[11px]">{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1.5">
              <Select value={activeDoctor} onValueChange={setActiveDoctor}>
                <SelectTrigger className="h-7 text-[11px] font-medium bg-slate-50 border-slate-200 flex-1">
                  <SelectValue placeholder="All Doctors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-[11px]">All Doctors</SelectItem>
                  {doctors.map((d) => (
                    <SelectItem key={d.id} value={d.id} className="text-[11px]">{d.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasActiveFilter && (
                <button
                  onClick={() => { setActiveDept("all"); setActiveDoctor("all"); setSearchQuery(""); }}
                  className="h-7 w-7 flex items-center justify-center rounded border border-slate-200 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors shrink-0"
                  title="Clear all filters"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {departments.length === 0 && (
              <p className="text-[10px] text-slate-400">Add departments in <Link to="/settings/departments" className="text-[#1A2F5A] underline">Settings</Link></p>
            )}
          </div>
        </div>

        {/* Stats bar */}
        <div className="flex-shrink-0 h-8 bg-slate-50 border-b border-slate-100 flex items-center gap-4 px-4">
          <span className="text-[11px] text-amber-500 font-medium">● {waitingCount} Waiting</span>
          <span className="text-[11px] text-blue-500 font-medium">● {inRoomCount} In Room</span>
          <span className="text-[11px] text-emerald-500 font-medium">✓ {doneCount} Done</span>
          <div className="ml-auto" />
          <NABHBadge standardCodes={["AAC.1", "AAC.2", "AAC.3"]} />
        </div>

        {/* Token list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {loading
            ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)
            : filtered.length === 0 ? (
              <EmptyState
                icon="🏥"
                title="No patients in queue"
                description="Walk-in patients and appointments will appear here"
                actionLabel={hasActionAccess("opd", "register_walkin", permissions, role) ? "Register Walk-in" : undefined}
                onAction={hasActionAccess("opd", "register_walkin", permissions, role) ? () => setShowModal(true) : undefined}
              />
            ) : filtered.map((token) => {
              const isSelected = token.id === selectedTokenId;
              const pred = predictions[token.id];
              const showRiskBadge = pred && token.status === "waiting";
              return (
                <button
                  key={token.id}
                  onClick={() => onSelectToken(token.id)}
                  className={cn(
                    "w-full text-left p-2.5 rounded-lg border transition-all duration-100",
                    statusStyles[token.status] || "bg-white border-slate-100",
                    isSelected && "!bg-blue-50 !border-[#1A2F5A] border-[1.5px]",
                    "hover:shadow-sm hover:border-slate-300"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <span className={cn("text-lg font-bold", isEmergencyToken(token) ? "text-red-600" : "text-[#1A2F5A]")}>{token.token_number}</span>
                      {token.appointment?.slot_time && (
                        <span className="text-[9px] px-1.5 py-px rounded-full font-bold bg-emerald-100 text-emerald-700">
                          Appt {token.appointment.slot_time.slice(0, 5)}
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-1">
                      {showRiskBadge && pred.risk_score >= 70 && (
                        <Badge className="text-[8px] px-1.5 py-0 bg-red-100 text-red-700 border-red-200 hover:bg-red-100">🔴 High Risk</Badge>
                      )}
                      {showRiskBadge && pred.risk_score >= 40 && pred.risk_score < 70 && (
                        <Badge className="text-[8px] px-1.5 py-0 bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100">🟡 Med Risk</Badge>
                      )}
                      {noShowHistory[token.patient_id] > 0 && (
                        <Badge className="text-[8px] px-1 py-0 bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-100">
                          Missed {noShowHistory[token.patient_id]}×
                        </Badge>
                      )}
                      {token.priority !== "normal" && priorityBadge[token.priority] && (
                        <span className={cn("text-[9px] px-1.5 py-px rounded-full font-bold", priorityBadge[token.priority].bg, priorityBadge[token.priority].text)}>
                          {priorityBadge[token.priority].label}
                        </span>
                      )}
                      {(token as any).visit_type === "revisit" && <span className="text-[9px] px-1.5 py-px rounded-full font-bold bg-amber-100 text-amber-700">[R]</span>}
                      {(token as any).visit_type === "followup" && <span className="text-[9px] px-1.5 py-px rounded-full font-bold bg-violet-100 text-violet-700">[F]</span>}
                      {(token as any).visit_type === "emergency" && <span className="text-[9px] px-1.5 py-px rounded-full font-bold bg-red-100 text-red-700">[E]</span>}
                      {(token as any).is_mlc && <span className="text-[9px] px-1.5 py-px rounded-full font-bold bg-red-600 text-white">MLC</span>}
                      <ABHABadge abhaNumber={token.patient?.abha_id} size="sm" />
                      {(token as any).payer_type && (token as any).payer_type !== "cash" && (
                        <span className={cn(
                          "text-[9px] px-1.5 py-px rounded-full font-bold",
                          (token as any).payer_type === "corporate" ? "bg-blue-600 text-white" :
                          (token as any).payer_type === "tpa" ? "bg-purple-600 text-white" :
                          (token as any).payer_type === "pmjay" ? "bg-green-600 text-white" :
                          (token as any).payer_type === "cghs" ? "bg-teal-600 text-white" :
                          (token as any).payer_type === "esi" ? "bg-orange-600 text-white" :
                          (token as any).payer_type === "state_scheme" ? "bg-indigo-600 text-white" :
                          "bg-slate-500 text-white"
                        )}>
                          {(token as any).payer_type === "corporate" ? "Corp" :
                           (token as any).payer_type === "tpa" ? "TPA" :
                           (token as any).payer_type === "pmjay" ? "PMJAY" :
                           (token as any).payer_type === "cghs" ? "CGHS" :
                           (token as any).payer_type === "esi" ? "ESI" :
                           (token as any).payer_type === "state_scheme" ? "State" :
                           (token as any).payer_type === "credit" ? "Credit" : "Other"}
                        </span>
                      )}
                      {token.visit_mode === "teleconsult" && (
                        <span className="text-[9px] px-1.5 py-px rounded-full font-bold bg-purple-600 text-white flex items-center gap-0.5">
                          <Video size={8} />Tele
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[13px] font-medium text-slate-900 truncate max-w-[140px]">{token.patient?.full_name || "—"}</span>
                    <span className="text-[11px] text-slate-400">{getWaitMinutes(token.created_at)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-[11px] text-slate-400 truncate max-w-[120px]">
                      {token.visit_mode === "teleconsult" ? "📹 Online" : (token.department?.name || "—")}
                    </span>
                    <span className="text-[11px] text-slate-500">{token.doctor?.full_name ? `Dr. ${token.doctor.full_name.split(" ")[0]}` : "—"}</span>
                  </div>
                  {token.status !== "waiting" && (
                    <div className="mt-1.5">
                      <StatusBadge status={token.status} />
                    </div>
                  )}
                  {/* Teleconsult action button */}
                  {token.visit_mode === "teleconsult" && (token.status === "waiting" || token.status === "called") && (
                    <button
                      onClick={(e) => handleStartTeleconsult(token, e)}
                      className="mt-1.5 w-full text-[10px] font-bold text-white bg-purple-600 hover:bg-purple-700 rounded py-1 transition-colors flex items-center justify-center gap-1"
                    >
                      <Video size={10} />
                      {token.status === "called" ? "Join Teleconsult" : "Start Teleconsult"}
                    </button>
                  )}
                  {/* Send Reminder button for high-risk */}
                  {showRiskBadge && pred.risk_score >= 70 && token.patient?.phone && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleSendReminder(token); }}
                      disabled={reminderSending === token.id}
                      className="mt-1.5 w-full text-[10px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded py-1 transition-colors"
                    >
                      {reminderSending === token.id ? "Sending..." : "📱 Send Reminder"}
                    </button>
                  )}
                </button>
              );
            })}
        </div>

        {/* No-Show Analytics Card */}
        {(highRiskCount > 0 || medRiskCount > 0) && (
          <div className="flex-shrink-0 border-t border-slate-100 bg-slate-50 p-2.5">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Today's No-Show Risk</p>
            <div className="flex items-center gap-3">
              {highRiskCount > 0 && <span className="text-[11px] text-red-600 font-medium">🔴 {highRiskCount} High</span>}
              {medRiskCount > 0 && <span className="text-[11px] text-amber-600 font-medium">🟡 {medRiskCount} Medium</span>}
              <span className="text-[11px] text-slate-400">~{Math.round(highRiskCount * 0.7 + medRiskCount * 0.3)} est. no-shows</span>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-slate-100 p-2 space-y-1.5">
          {/* Call Next button */}
          <button
            onClick={handleCallNext}
            disabled={callNextLoading || filtered.filter(t => t.status === "waiting").length === 0}
            className="w-full h-10 rounded-lg text-[13px] font-semibold transition-all active:scale-[0.98] disabled:opacity-40 flex items-center justify-center gap-1.5"
            style={{ background: "#059669", color: "#FFFFFF" }}
            title="Call the next waiting patient and update the TV display"
          >
            {callNextLoading
              ? <span className="animate-spin border border-white/40 border-t-white rounded-full w-3.5 h-3.5" />
              : "📢"}
            {callNextLoading ? "Calling…" : lastCalledToken ? `Called ${lastCalledToken} · Call Next` : "Call Next Patient"}
          </button>
          {hasActionAccess("opd", "register_walkin", permissions, role) && (
            <button
              onClick={() => setShowModal(true)}
              className="w-full h-10 bg-[#1A2F5A] text-white rounded-lg text-[13px] font-semibold hover:bg-[#152647] active:scale-[0.98] transition-all"
            >
              + Register Walk-in
            </button>
          )}
        </div>
      </div>

      {showModal && hospitalId && (
        <WalkInModal
          hospitalId={hospitalId}
          onClose={() => setShowModal(false)}
          onCreated={() => {
            onTokenCreated();
            setShowModal(false);
          }}
        />
      )}
    </>
  );
};

export default TokenQueue;

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { OTSchedule } from "@/pages/ot/OTPage";

interface Props {
  schedule: OTSchedule;
  onRefresh: () => void;
}

const CaseDetailsTab: React.FC<Props> = ({ schedule, onRefresh }) => {
  const [elapsed, setElapsed] = useState("00:00:00");
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (schedule.status === "in_progress" && schedule.actual_start_time) {
      const start = new Date(schedule.actual_start_time).getTime();
      const tick = () => {
        const diff = Date.now() - start;
        const h = Math.floor(diff / 3600000).toString().padStart(2, "0");
        const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, "0");
        const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, "0");
        setElapsed(`${h}:${m}:${s}`);
      };
      tick();
      intervalRef.current = setInterval(tick, 1000);
      return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }
  }, [schedule.status, schedule.actual_start_time]);

  const isOvertime = (() => {
    if (!schedule.actual_start_time || schedule.status !== "in_progress") return false;
    const start = new Date(schedule.actual_start_time).getTime();
    const diff = (Date.now() - start) / 60000;
    return diff > schedule.estimated_duration_minutes;
  })();

  const age = schedule.patient?.dob
    ? Math.floor((Date.now() - new Date(schedule.patient.dob).getTime()) / 31557600000)
    : null;

  const saveNotes = async (val: string) => {
    await supabase.from("ot_schedules").update({ booking_notes: val }).eq("id", schedule.id);
  };

  return (
    <div className="grid grid-cols-2 gap-4 p-4 h-full overflow-y-auto">
      {/* Left column */}
      <div className="space-y-3">
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-[11px] font-bold uppercase text-muted-foreground mb-2">Patient Details</p>
          <p className="text-[13px] font-bold text-foreground">{schedule.patient?.full_name}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px] bg-muted px-2 py-0.5 rounded-full">{schedule.patient?.uhid}</span>
            {age && <span className="text-[11px] text-muted-foreground">{age}y / {schedule.patient?.gender}</span>}
            {schedule.patient?.blood_group && (
              <span className="text-[11px] bg-destructive/10 text-destructive px-2 py-0.5 rounded-full font-medium">
                {schedule.patient.blood_group}
              </span>
            )}
          </div>
          {schedule.patient?.allergies && (
            <p className="text-xs text-destructive mt-1">⚠️ Allergies: {schedule.patient.allergies}</p>
          )}
          {schedule.patient?.chronic_conditions && schedule.patient.chronic_conditions.length > 0 && (
            <div className="flex gap-1 mt-1 flex-wrap">
              {schedule.patient.chronic_conditions.map((c) => (
                <span key={c} className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{c}</span>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-[11px] font-bold uppercase text-muted-foreground mb-2">Surgery Details</p>
          <div className="space-y-2 text-[13px]">
            <div className="flex justify-between"><span className="text-muted-foreground">Surgery</span><span className="font-medium">{schedule.surgery_name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Category</span><span className="capitalize">{schedule.surgery_category}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Anaesthesia</span><span className="capitalize">{schedule.anaesthesia_type}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Duration</span><span>{schedule.estimated_duration_minutes} min</span></div>
            {schedule.post_op_diagnosis && (
              <div className="flex justify-between"><span className="text-muted-foreground">Post-op Dx</span><span className="font-medium">{schedule.post_op_diagnosis}</span></div>
            )}
          </div>
        </div>
      </div>

      {/* Right column */}
      <div className="space-y-3">
        {/* Case timer */}
        <div className="bg-[hsl(var(--sidebar-accent))] rounded-xl p-5 text-center">
          <p className="text-[10px] uppercase tracking-wider text-white/60">Case Time</p>
          <p className={`text-4xl font-bold font-mono tabular-nums mt-1 ${isOvertime ? "text-amber-400" : "text-white"}`}>
            {schedule.status === "in_progress" ? elapsed : "--:--:--"}
          </p>
          {isOvertime && <p className="text-[11px] text-amber-400 mt-1">⚠️ Over estimated time</p>}
          {schedule.status === "in_progress" && schedule.actual_start_time && (
            <p className="text-[11px] text-white/50 mt-1">
              Started at {new Date(schedule.actual_start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
          {schedule.status !== "in_progress" && (
            <p className="text-[11px] text-white/50 mt-1">
              {schedule.status === "completed" ? "Case completed" : "Case not started"}
            </p>
          )}
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-[11px] font-bold uppercase text-muted-foreground mb-2">Notes / Special Instructions</p>
          <textarea
            defaultValue={schedule.booking_notes || ""}
            onBlur={(e) => saveNotes(e.target.value)}
            placeholder="Pre-op instructions, special requirements..."
            className="w-full text-[13px] border border-border rounded-md p-2 bg-background resize-none h-20 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>
    </div>
  );
};

export default CaseDetailsTab;

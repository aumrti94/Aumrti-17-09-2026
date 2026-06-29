import React, { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Pill } from "lucide-react";
import type { NursingTask } from "@/pages/nursing/NursingPage";

interface Props {
  overdueTasks: NursingTask[];
  hospitalId: string | null;
}

const MARAdherenceMonitor: React.FC<Props> = ({ overdueTasks, hospitalId }) => {
  const alertFiredRef = useRef<string>("");

  // Fire clinical_alerts once per unique set of severely overdue medications (>60 min past)
  useEffect(() => {
    if (!hospitalId || overdueTasks.length === 0) return;

    const now = new Date();
    const severelyOverdue = overdueTasks.filter((t) => {
      if (t.type !== "medication") return false;
      const [h, m] = t.scheduledTime.split(":").map(Number);
      const sched = new Date();
      sched.setHours(h, m, 0, 0);
      const diffMin = (now.getTime() - sched.getTime()) / 60000;
      return diffMin >= 60;
    });

    if (severelyOverdue.length === 0) return;

    // De-dupe: only fire if the set of severely overdue tasks changed
    const key = severelyOverdue.map((t) => `${t.medicationId}_${t.scheduledTime}`).join("|");
    if (alertFiredRef.current === key) return;
    alertFiredRef.current = key;

    const summary = severelyOverdue
      .slice(0, 5)
      .map((t) => `${t.patientName}: ${t.drugName || "Medication"} (${t.scheduledTime}) — ${t.bedLabel}`)
      .join("; ");

    supabase
      .from("clinical_alerts")
      .insert({
        hospital_id: hospitalId,
        alert_type: "mar_overdue",
        severity: "medium",
        alert_message: `${severelyOverdue.length} medication(s) overdue >60 min: ${summary}${severelyOverdue.length > 5 ? " …and more" : ""}`,
      } as any)
      .then(() => {});
  }, [overdueTasks, hospitalId]);

  if (overdueTasks.length === 0) return null;

  const medTasks = overdueTasks.filter((t) => t.type === "medication");
  if (medTasks.length === 0) return null;

  return (
    <div className="mx-4 mb-1 mt-1 rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800 px-3 py-2 flex items-start gap-2 shrink-0">
      <AlertTriangle className="h-3.5 w-3.5 text-red-600 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-bold text-red-800 dark:text-red-300">
          {medTasks.length} medication{medTasks.length > 1 ? "s" : ""} overdue
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
          {medTasks.slice(0, 6).map((t) => (
            <span key={t.id} className="text-[10px] text-red-700 dark:text-red-400 flex items-center gap-1">
              <Pill className="h-2.5 w-2.5" />
              {t.patientName} · {t.drugName || "Med"} · {t.scheduledTime} · {t.bedLabel}
            </span>
          ))}
          {medTasks.length > 6 && (
            <span className="text-[10px] text-red-600 font-semibold">+{medTasks.length - 6} more</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default MARAdherenceMonitor;

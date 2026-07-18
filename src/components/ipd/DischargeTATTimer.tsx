import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Clock, AlertTriangle } from "lucide-react";
import { initiateDischargeWorkflow, DISCHARGE_INITIATED_EVENT } from "@/lib/dischargeWorkflow";

interface Props {
  admissionId: string;
  hospitalId: string | null;
  medicalCleared: boolean;
}

const DischargeTATTimer: React.FC<Props> = ({ admissionId, hospitalId, medicalCleared }) => {
  const [startTime, setStartTime] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Pick up a workflow started elsewhere — e.g. the "Initiate Discharge" button
  // in the workspace action bar — so the clock appears without a reload.
  useEffect(() => {
    const onInitiated = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.admissionId === admissionId) setStartTime(detail.startedAt);
    };
    window.addEventListener(DISCHARGE_INITIATED_EVENT, onInitiated);
    return () => window.removeEventListener(DISCHARGE_INITIATED_EVENT, onInitiated);
  }, [admissionId]);

  // Show the clock whenever the workflow is already running, not only after
  // medical clearance — the discharge may have been ordered before it.
  useEffect(() => {
    if (!admissionId) return;
    let cancelled = false;
    (supabase as any).from("admissions")
      .select("discharge_ordered_at")
      .eq("id", admissionId)
      .maybeSingle()
      .then(({ data }: { data: any }) => {
        if (!cancelled && data?.discharge_ordered_at) setStartTime(data.discharge_ordered_at);
      });
    return () => { cancelled = true; };
  }, [admissionId]);

  // Medical clearance implies the discharge has been ordered — start the
  // workflow if the button was never pressed.
  useEffect(() => {
    if (!medicalCleared || !admissionId) return;
    let cancelled = false;
    initiateDischargeWorkflow(admissionId, hospitalId)
      .then(({ startedAt }) => { if (!cancelled) setStartTime(startedAt); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [medicalCleared, admissionId, hospitalId]);

  useEffect(() => {
    if (!startTime) return;
    const update = () => {
      const diff = Math.floor((Date.now() - new Date(startTime).getTime()) / 1000);
      setElapsed(diff);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  useEffect(() => {
    if (!startTime || !hospitalId || elapsed < 7200) return;
    if (elapsed >= 7200 && elapsed <= 7205) {
      supabase.from("clinical_alerts").insert({
        hospital_id: hospitalId,
        alert_type: "discharge_delay",
        severity: "medium",
        alert_message: `Discharge TAT: ${Math.floor(elapsed / 60)} min elapsed. Review pending clearances.`,
      } as any).then(() => {});
    }
  }, [elapsed, startTime, hospitalId]);

  if (!startTime) return null;

  const hours = Math.floor(elapsed / 3600);
  const mins = Math.floor((elapsed % 3600) / 60);
  const secs = elapsed % 60;
  const formatted = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

  const totalMins = elapsed / 60;
  const color = totalMins < 120 ? "text-green-600" : totalMins < 180 ? "text-amber-600" : "text-destructive";
  const bgColor = totalMins < 120 ? "bg-green-50 border-green-200" : totalMins < 180 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200";

  return (
    <div className={`flex items-center gap-2 rounded-md border px-3 py-1.5 mt-2 ${bgColor}`}>
      {totalMins >= 180 ? (
        <AlertTriangle className={`h-3.5 w-3.5 ${color}`} />
      ) : (
        <Clock className={`h-3.5 w-3.5 ${color}`} />
      )}
      <span className={`text-xs font-mono font-bold ${color}`}>
        ⏱️ TAT: {formatted}
      </span>
      <span className="text-[10px] text-muted-foreground ml-1">
        Target: 3:00:00
      </span>
    </div>
  );
};

export default DischargeTATTimer;

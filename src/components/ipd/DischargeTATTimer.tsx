import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Clock, AlertTriangle } from "lucide-react";
import { initiateDischargeWorkflow, DISCHARGE_INITIATED_EVENT } from "@/lib/dischargeWorkflow";

interface Props {
  admissionId: string;
  hospitalId: string | null;
  medicalCleared: boolean;
}

// Fallback matches this component's own pre-2026-09-12 hardcoded behaviour exactly (2h
// warning colour / alert fire, 3h critical colour) — a hospital that has never opened
// Settings → Alert Thresholds sees no behaviour change. See KNOWN-BUG-141.
export const DEFAULT_ALERT_HOURS = 2;
export const DEFAULT_ESCALATE_HOURS = 3;

const DischargeTATTimer: React.FC<Props> = ({ admissionId, hospitalId, medicalCleared }) => {
  const [startTime, setStartTime] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [alertHours, setAlertHours] = useState(DEFAULT_ALERT_HOURS);
  const [escalateHours, setEscalateHours] = useState(DEFAULT_ESCALATE_HOURS);

  useEffect(() => {
    if (!hospitalId) return;
    let cancelled = false;
    (supabase as any)
      .from("hospital_settings")
      .select("value")
      .eq("hospital_id", hospitalId)
      .eq("key", "clinical_thresholds")
      .maybeSingle()
      .then(({ data }: { data: any }) => {
        if (cancelled || !data?.value) return;
        if (typeof data.value.dischargeTatAlert === "number") setAlertHours(data.value.dischargeTatAlert);
        if (typeof data.value.dischargeTatEscalate === "number") setEscalateHours(data.value.dischargeTatEscalate);
      });
    return () => { cancelled = true; };
  }, [hospitalId]);

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

  const alertSecs = alertHours * 3600;

  useEffect(() => {
    if (!startTime || !hospitalId || elapsed < alertSecs) return;
    if (elapsed >= alertSecs && elapsed <= alertSecs + 5) {
      // The 1-second poll re-checks this 6-second window on every tick, so without a dedup
      // key this fired up to 6 times per continuous mount (KNOWN-BUG-002). Deduped on the
      // admission itself — this alert means "this discharge is over the configured alert
      // threshold", a fact true once per admission, not once per tick.
      supabase.from("clinical_alerts").upsert({
        hospital_id: hospitalId,
        admission_id: admissionId,
        alert_type: "discharge_delay",
        severity: "medium",
        alert_message: `Discharge TAT: ${Math.floor(elapsed / 60)} min elapsed. Review pending clearances.`,
        dedupe_key: admissionId,
      } as any, { onConflict: "hospital_id,alert_type,dedupe_key", ignoreDuplicates: true }).then(() => {});
    }
  }, [elapsed, startTime, hospitalId, admissionId, alertSecs]);

  if (!startTime) return null;

  const hours = Math.floor(elapsed / 3600);
  const mins = Math.floor((elapsed % 3600) / 60);
  const secs = elapsed % 60;
  const formatted = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

  // Configurable via Settings → Alert Thresholds (KNOWN-BUG-141) — previously hardcoded to
  // 120/180 minutes (2h/3h), which are now this component's own fallback default so a
  // hospital that never opened that screen sees identical behaviour to before.
  const alertMins = alertHours * 60;
  const escalateMins = escalateHours * 60;
  const totalMins = elapsed / 60;
  const color = totalMins < alertMins ? "text-green-600" : totalMins < escalateMins ? "text-amber-600" : "text-destructive";
  const bgColor = totalMins < alertMins ? "bg-green-50 border-green-200" : totalMins < escalateMins ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200";
  const targetFormatted = `${String(escalateHours).padStart(2, "0")}:00:00`;

  return (
    <div className={`flex items-center gap-2 rounded-md border px-3 py-1.5 mt-2 ${bgColor}`}>
      {totalMins >= escalateMins ? (
        <AlertTriangle className={`h-3.5 w-3.5 ${color}`} />
      ) : (
        <Clock className={`h-3.5 w-3.5 ${color}`} />
      )}
      <span className={`text-xs font-mono font-bold ${color}`}>
        ⏱️ TAT: {formatted}
      </span>
      <span className="text-[10px] text-muted-foreground ml-1">
        Target: {targetFormatted}
      </span>
    </div>
  );
};

export default DischargeTATTimer;

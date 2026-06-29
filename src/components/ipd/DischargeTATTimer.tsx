import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Clock, AlertTriangle } from "lucide-react";

interface Props {
  admissionId: string;
  hospitalId: string | null;
  medicalCleared: boolean;
}

const DischargeTATTimer: React.FC<Props> = ({ admissionId, hospitalId, medicalCleared }) => {
  const [startTime, setStartTime] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!medicalCleared || !admissionId) return;

    const init = async () => {
      const { data } = await supabase
        .from("admissions")
        .select("*")
        .eq("id", admissionId)
        .maybeSingle();

      const dischargeOrderedAt = (data as any)?.discharge_ordered_at;
      if (dischargeOrderedAt) {
        setStartTime(dischargeOrderedAt);
      } else {
        const now = new Date().toISOString();
        await supabase.from("admissions").update({
          discharge_ordered_at: now,
        } as any).eq("id", admissionId);
        setStartTime(now);
        // Parallel team notifications: fire once when discharge order is first created
        if (hospitalId) {
          Promise.all([
            supabase.from("clinical_alerts").insert({
              hospital_id: hospitalId,
              alert_type: "discharge_initiated",
              severity: "low",
              alert_message: "Discharge initiated — Billing: please finalise the IPD bill immediately.",
            } as any),
            supabase.from("clinical_alerts").insert({
              hospital_id: hospitalId,
              alert_type: "discharge_initiated",
              severity: "low",
              alert_message: "Discharge initiated — Pharmacy: clear all pending dispenses and check medication returns.",
            } as any),
            supabase.from("clinical_alerts").insert({
              hospital_id: hospitalId,
              alert_type: "discharge_initiated",
              severity: "low",
              alert_message: "Discharge initiated — Nursing: prepare discharge paperwork, patient education, and verify insurance documents.",
            } as any),
          ]).catch(() => {});
        }
      }
    };
    init();
  }, [medicalCleared, admissionId]);

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

  if (!medicalCleared || !startTime) return null;

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

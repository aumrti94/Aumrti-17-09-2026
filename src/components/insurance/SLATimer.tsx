import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { differenceInMinutes, addMinutes } from "date-fns";

interface SLATimerProps {
  id: string;
  slaDeadline: string | null;
  status: string;
  createdAt: string;
  patientName?: string;
  tpaName?: string;
  onSLABreach?: (id: string) => void;
}

const SLATimer: React.FC<SLATimerProps> = ({
  id,
  slaDeadline,
  status,
  createdAt,
  patientName,
  tpaName,
  onSLABreach,
}) => {
  const { hospitalId } = useHospitalId();

  const effectiveDeadline = slaDeadline
    ? new Date(slaDeadline)
    : addMinutes(new Date(createdAt), 60);

  const getMinutesLeft = () => differenceInMinutes(effectiveDeadline, new Date());

  const [minutesLeft, setMinutesLeft] = useState<number>(getMinutesLeft);

  // Refs let the interval closure always read the latest values without
  // being torn down and recreated on every render.
  const breachFiredRef = useRef(false);
  const hospitalIdRef = useRef(hospitalId);
  const onBreachRef = useRef(onSLABreach);

  useEffect(() => { hospitalIdRef.current = hospitalId; }, [hospitalId]);
  useEffect(() => { onBreachRef.current = onSLABreach; }, [onSLABreach]);

  const isTerminal = status === "approved" || status === "rejected";

  const fireBreach = async (overdueMins: number) => {
    if (breachFiredRef.current) return;
    breachFiredRef.current = true;

    const hid = hospitalIdRef.current;
    if (hid) {
      await Promise.all([
        (supabase as any)
          .from("insurance_pre_auth")
          .update({ sla_breached: true })
          .eq("id", id),
        (supabase as any)
          .from("insurance_sla_log")
          .insert({
            hospital_id: hid,
            reference_type: "pre_auth",
            reference_id: id,
            patient_name: patientName ?? null,
            tpa_name: tpaName ?? null,
            sla_deadline: effectiveDeadline.toISOString(),
            breached_at: new Date().toISOString(),
            breach_minutes: overdueMins,
          }),
      ]);
    }

    onBreachRef.current?.(id);
  };

  useEffect(() => {
    if (isTerminal) return;

    const tick = () => {
      const left = getMinutesLeft();
      setMinutesLeft(left);
      if (left <= 0) fireBreach(Math.abs(left));
    };

    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTerminal, effectiveDeadline.getTime()]);

  if (isTerminal) {
    const resolvedIn = differenceInMinutes(new Date(), new Date(createdAt));
    return (
      <div className="flex flex-col gap-0.5">
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 bg-emerald-50 text-emerald-700 border-emerald-200"
        >
          Resolved
        </Badge>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          in {resolvedIn} min
        </span>
      </div>
    );
  }

  const isBreached = minutesLeft <= 0;
  const isAtRisk   = minutesLeft > 0 && minutesLeft < 10;
  const isWarning  = minutesLeft >= 10 && minutesLeft <= 30;

  const timerLabel = isBreached
    ? `${Math.abs(minutesLeft)} min overdue`
    : `${minutesLeft} min remaining`;

  return (
    <div className="flex flex-col gap-0.5">
      <div
        className={cn(
          "flex items-center gap-1 text-xs font-medium tabular-nums",
          isBreached ? "text-red-900"  :
          isAtRisk   ? "text-red-600"  :
          isWarning  ? "text-amber-600":
                       "text-emerald-600"
        )}
      >
        <span>⏱</span>
        {timerLabel}
      </div>

      {isBreached ? (
        <Badge className="text-[10px] px-1.5 py-0 bg-red-700 text-white border-red-700">
          SLA BREACHED
        </Badge>
      ) : isAtRisk ? (
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 bg-red-50 text-red-700 border-red-200"
        >
          SLA at Risk
        </Badge>
      ) : isWarning ? (
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 bg-amber-50 text-amber-700 border-amber-200"
        >
          SLA at Risk
        </Badge>
      ) : (
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 bg-emerald-50 text-emerald-700 border-emerald-200"
        >
          Within SLA
        </Badge>
      )}
    </div>
  );
};

export default SLATimer;

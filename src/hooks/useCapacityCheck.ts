import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";

interface CapacityResult {
  allowed: boolean;
  current: number;
  max: number | null;
  plan_slug: string | null;
}

export function useCapacityCheck() {
  const { hospitalId } = useHospitalId();

  // `adding` = how many beds this operation is about to create. The check must
  // account for the batch size, otherwise creating a 15-bed ward on a 10-bed plan
  // (current 0) would pass "0 < 10" and overshoot the limit.
  const checkBedCapacity = useCallback(async (adding: number = 1): Promise<CapacityResult> => {
    if (!hospitalId) return { allowed: true, current: 0, max: null, plan_slug: null };
    const { data } = await (supabase as any).rpc("check_bed_capacity", {
      p_hospital_id: hospitalId,
      p_adding: Math.max(adding, 1),
    });
    return data ?? { allowed: true, current: 0, max: null, plan_slug: null };
  }, [hospitalId]);

  const checkStaffCapacity = useCallback(async (): Promise<CapacityResult> => {
    if (!hospitalId) return { allowed: true, current: 0, max: null, plan_slug: null };
    const { data } = await (supabase as any).rpc("check_staff_capacity", { p_hospital_id: hospitalId });
    return data ?? { allowed: true, current: 0, max: null, plan_slug: null };
  }, [hospitalId]);

  return { checkBedCapacity, checkStaffCapacity };
}

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

  const checkBedCapacity = useCallback(async (): Promise<CapacityResult> => {
    if (!hospitalId) return { allowed: true, current: 0, max: null, plan_slug: null };
    const { data } = await (supabase as any).rpc("check_bed_capacity", { p_hospital_id: hospitalId });
    return data ?? { allowed: true, current: 0, max: null, plan_slug: null };
  }, [hospitalId]);

  const checkStaffCapacity = useCallback(async (): Promise<CapacityResult> => {
    if (!hospitalId) return { allowed: true, current: 0, max: null, plan_slug: null };
    const { data } = await (supabase as any).rpc("check_staff_capacity", { p_hospital_id: hospitalId });
    return data ?? { allowed: true, current: 0, max: null, plan_slug: null };
  }, [hospitalId]);

  return { checkBedCapacity, checkStaffCapacity };
}

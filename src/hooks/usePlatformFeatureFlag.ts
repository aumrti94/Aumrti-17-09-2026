import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";

// Platform-team staged-rollout flags — distinct from Anita's entitlement
// system (plan_features/hospital_feature_overrides/product_modes, which
// gate what a hospital is PAYING for). This gates "is this in-progress
// feature visible to this hospital yet," independent of billing.
export function usePlatformFeatureFlag(key: string): { enabled: boolean; isLoading: boolean } {
  const { hospitalId } = useHospitalId();

  const { data, isLoading } = useQuery({
    queryKey: ["platform-feature-flag", key, hospitalId],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("resolve_feature_flag", {
        p_key: key,
        p_hospital_id: hospitalId,
      });
      return !!data;
    },
    enabled: !!hospitalId && !!key,
    staleTime: 5 * 60_000,
  });

  return { enabled: data ?? false, isLoading };
}

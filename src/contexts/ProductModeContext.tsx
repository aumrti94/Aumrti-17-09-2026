import React, { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalContext } from "@/hooks/useHospitalContext";
import { ProductModeContext } from "@/hooks/useProductMode";

const CACHE_PREFIX = "hms_pmode_";

/**
 * Product mode is a DESCRIPTIVE label for the deployment (hospital / clinic /
 * diagnostic / pharmacy / institute) — it does not gate anything.
 *
 * It used to: `product_modes.enabled_modules` was read as an exhaustive allowlist,
 * so every module key absent from that partial list — "settings" included, plus every
 * specialty the hospital-side editors never rendered — resolved as "disabled for your
 * deployment". That locked hospitals out of Settings, the one screen that could have
 * undone it. Module access now has exactly one source of truth: the Platform console
 * (plan features + hospital_feature_overrides), resolved by useSubscriptionConfig.
 */
export const ProductModeProvider = ({ children }: { children: React.ReactNode }) => {
  const { hospitalId, loading: ctxLoading } = useHospitalContext();
  const queryClient = useQueryClient();
  const [productMode, setProductMode] = useState("hospital");
  const [loadingMode, setLoadingMode] = useState(true);

  const fetchMode = async (hid: string) => {
    const cacheKey = CACHE_PREFIX + hid;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        const { mode } = JSON.parse(cached);
        setProductMode(mode || "hospital");
        setLoadingMode(false);
        return;
      } catch { /* ignore */ }
    }
    const { data } = await (supabase as any)
      .from("product_modes")
      .select("mode")
      .eq("hospital_id", hid)
      .maybeSingle();
    const mode = data?.mode || "hospital";
    setProductMode(mode);
    setLoadingMode(false);
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ mode })); } catch { /* ignore */ }
  };

  useEffect(() => {
    if (ctxLoading) return;
    if (!hospitalId) { setLoadingMode(false); return; }
    fetchMode(hospitalId);
  }, [hospitalId, ctxLoading]);

  // Real-time sync: propagate Platform admin changes to HMS immediately.
  // Listens for:
  //  - product_modes changes → clear cache + refetch product mode
  //  - hospital_feature_overrides / hospital_subscriptions / plan_features changes
  //    → invalidate subscription-config query (used by MG gate)
  useEffect(() => {
    if (!hospitalId) return;

    const channel = supabase
      .channel(`platform_hms_sync_${hospitalId}`)
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "product_modes", filter: `hospital_id=eq.${hospitalId}` },
        () => {
          try { sessionStorage.removeItem(CACHE_PREFIX + hospitalId); } catch { /* ignore */ }
          fetchMode(hospitalId);
        }
      )
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "hospital_feature_overrides", filter: `hospital_id=eq.${hospitalId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["subscription-config", hospitalId] });
        }
      )
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "hospital_subscriptions", filter: `hospital_id=eq.${hospitalId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["subscription-config", hospitalId] });
        }
      )
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "plan_features" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["subscription-config", hospitalId] });
        }
      )
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "subscription_plans" },
        () => {
          // Platform admin edited plan pricing / limits / badge / description → refresh live.
          queryClient.invalidateQueries({ queryKey: ["subscription-config", hospitalId] });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [hospitalId, queryClient]);

  const refreshMode = () => {
    if (!hospitalId) return;
    try { sessionStorage.removeItem(CACHE_PREFIX + hospitalId); } catch { /* ignore */ }
    fetchMode(hospitalId);
  };

  return (
    <ProductModeContext.Provider value={{ productMode, loadingMode, refreshMode }}>
      {children}
    </ProductModeContext.Provider>
  );
};


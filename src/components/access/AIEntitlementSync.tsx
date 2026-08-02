import { useEffect } from "react";
import { useHospitalContext } from "@/hooks/useHospitalContext";
import { useSubscriptionConfig, isModuleKeyAllowed } from "@/hooks/useSubscriptionConfig";
import { ENTITLEMENT_KEY } from "@/lib/tabPermissions";
import { setAIEntitlement, clearAIEntitlement } from "@/lib/aiEntitlement";

/**
 * Bridges the resolved plan→hospital AI entitlement into the non-React module-level
 * cache that callAI() reads. Mounted once inside the authenticated app shell.
 * Master = `ai_suite` enabled; disabled features = the `false` keys in the
 * __entitlement blob's ai_suite.actions (already merged by HospitalContext).
 */
export function AIEntitlementSync() {
  const { hospitalId, permissions } = useHospitalContext();
  const { enabledModules, isLoading } = useSubscriptionConfig();

  useEffect(() => {
    if (!hospitalId || isLoading) return;
    const master = isModuleKeyAllowed("ai_suite", enabledModules);
    const actions = (permissions?.[ENTITLEMENT_KEY]?.ai_suite?.actions ?? {}) as Record<string, boolean>;
    const disabled = new Set(
      Object.entries(actions).filter(([, v]) => v === false).map(([k]) => k),
    );
    setAIEntitlement(hospitalId, { master, disabled });
  }, [hospitalId, enabledModules, isLoading, permissions]);

  useEffect(() => () => clearAIEntitlement(), []);

  return null;
}

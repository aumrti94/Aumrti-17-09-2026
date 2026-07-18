import { useSubscriptionConfig, isModuleKeyAllowed } from "@/hooks/useSubscriptionConfig";
import { useModuleAccess } from "@/components/access/useModuleAccess";

/**
 * UI gate for an AI feature. True when the "AI Features" master (pseudo-module
 * `ai_suite`) is enabled for the hospital AND this specific feature isn't withheld.
 * Optimistic (true) while entitlement is still loading so AI UI doesn't flash off.
 *
 *   if (!useAIFeature("voice_scribe")) return null;   // hide the scribe button
 *
 * The callAI() choke point enforces the same rule for functionality; this hook is
 * for hiding the visible AI UI. `featureKey` must match the callAI featureKey.
 */
export function useAIFeature(featureKey: string): boolean {
  const { enabledModules, isLoading } = useSubscriptionConfig();
  const { actionAllowed } = useModuleAccess();
  if (isLoading) return true;
  return isModuleKeyAllowed("ai_suite", enabledModules) && actionAllowed("ai_suite", featureKey);
}

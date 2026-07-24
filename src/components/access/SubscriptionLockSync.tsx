import { useEffect } from "react";
import { useSubscriptionConfig } from "@/hooks/useSubscriptionConfig";
import { setSubscriptionLock } from "@/lib/subscriptionLock";

/**
 * Bridges the resolved subscription access decision into the module-level flag the
 * Supabase client's fetch wrapper reads. Mounted once inside the authenticated app shell,
 * mirroring <AIEntitlementSync/>.
 *
 * Never locks while loading — an in-flight subscription query must not make the app
 * read-only for a second on every page load.
 */
export function SubscriptionLockSync() {
  const { accessBlocked, isLoading } = useSubscriptionConfig();

  useEffect(() => {
    setSubscriptionLock(!isLoading && accessBlocked);
  }, [accessBlocked, isLoading]);

  useEffect(() => () => setSubscriptionLock(false), []);

  return null;
}

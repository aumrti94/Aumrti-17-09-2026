// Module-level cache of the current hospital's AI entitlement, so the non-React
// callAI() choke point can gate every AI call synchronously. Populated by the
// <AIEntitlementSync> component from the resolved plan→hospital entitlement.
//
// Fail-open: until the cache is loaded for a hospital, AI is allowed. This avoids
// blocking AI during the brief window before entitlement resolves, and mirrors the
// fail-open stance of useSubscriptionConfig. The authoritative deny still lands the
// moment the sync runs.

interface AIEntitlement {
  hospitalId: string;
  master: boolean;
  disabled: Set<string>; // AI featureKeys withheld individually
}

let current: AIEntitlement | null = null;

export function setAIEntitlement(hospitalId: string, value: { master: boolean; disabled: Set<string> }) {
  current = { hospitalId, master: value.master, disabled: value.disabled };
}

export function clearAIEntitlement() {
  current = null;
}

/**
 * Whether an AI feature may run for a hospital. Fail-open when the cache is not yet
 * loaded or is for a different hospital. Blocks when the master is off or the
 * specific featureKey has been withheld.
 */
export function isAIFeatureAllowed(featureKey: string | undefined, hospitalId: string | undefined): boolean {
  if (!current || !hospitalId || current.hospitalId !== hospitalId) return true; // fail-open
  if (!current.master) return false;
  if (featureKey && current.disabled.has(featureKey)) return false;
  return true;
}

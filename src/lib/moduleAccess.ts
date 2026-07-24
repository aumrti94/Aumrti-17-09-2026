/**
 * Pure resolution of which MODULES a hospital may open.
 *
 * Extracted from useSubscriptionConfig, where it had lived inline and untested,
 * because pricing v3 Phase 2 adds a third input (purchased add-ons) and a
 * three-layer precedence rule is not something to leave unverified inside a
 * data-fetching hook.
 *
 * This is the module-level twin of `entitlementResolve.ts`, which resolves the
 * finer-grained tab/action layer (including the AI feature keys). Both are pure
 * and both must stay single-sourced: a page that re-implements either one will
 * eventually disagree with billing about what a hospital bought.
 *
 *     effective = adminOverride ?? addonGrant ?? planDefault
 *
 * Add-ons only ever GRANT. An admin override still wins over a purchased
 * add-on — an override is deliberate admin action (suspending a module for
 * cause) — but that combination means the hospital is paying for something it
 * cannot open, which the `addon_entitlement_drift` view surfaces in the cockpit
 * rather than silently resolving.
 */

export interface ModuleAccessInput {
  /** Every module key the plan catalog tracks (CANONICAL_MODULE_KEYS). */
  canonicalKeys: readonly string[];
  /** Keys granted regardless of plan (settings, inbox, dashboard). */
  alwaysEnabled: ReadonlySet<string>;
  /** plan_features rows for the hospital's plan. */
  planRows: ReadonlyArray<{ module_key: string; is_enabled: boolean }>;
  /** Module keys granted by ACTIVE purchased add-ons (addon_skus.module_keys). */
  addonKeys?: readonly string[];
  /** hospital_feature_overrides rows — admin intent, highest precedence. */
  overrideRows: ReadonlyArray<{ module_key: string; is_enabled: boolean }>;
}

export function resolveEnabledModules(input: ModuleAccessInput): string[] {
  const { canonicalKeys, alwaysEnabled, planRows, overrideRows } = input;

  const planMap = new Map<string, boolean>(planRows.map((f) => [f.module_key, f.is_enabled]));
  const overrideMap = new Map<string, boolean>(overrideRows.map((o) => [o.module_key, o.is_enabled]));
  const addonSet = new Set<string>(input.addonKeys ?? []);

  const enabled: string[] = [];
  for (const key of canonicalKeys) {
    if (alwaysEnabled.has(key)) {
      enabled.push(key);
      continue;
    }
    // 1. Admin override wins outright, in both directions.
    if (overrideMap.has(key)) {
      if (overrideMap.get(key)) enabled.push(key);
      continue;
    }
    // 2. A purchased add-on grants the module even when the plan withholds it.
    //    This is the whole point of the add-on layer.
    if (addonSet.has(key)) {
      enabled.push(key);
      continue;
    }
    // 3. Plan default. No plan_features rows at all = legacy hospital predating
    //    the entitlement system; those stay fully open rather than losing access.
    if (planMap.size === 0) {
      enabled.push(key);
    } else if (planMap.get(key) === true) {
      enabled.push(key);
    } else if (key === "ai_suite" && planMap.get(key) !== false) {
      // AI master defaults ON: enabled unless the plan explicitly disables it,
      // so a plan predating the AI suite does not silently lose AI.
      enabled.push(key);
    }
  }
  return enabled;
}

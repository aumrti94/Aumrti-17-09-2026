// Pure resolution of effective tab/action entitlements by layering the
// subscription PLAN default under the per-HOSPITAL override:
//
//     effective = hospitalExplicit ?? planDefault ?? allowed
//
// Both sides store only the keys they care about; a `false` value withholds a
// tab/button, anything else allows it. The result keeps ONLY withheld (false)
// keys — absence means allowed, which is exactly what isTabEntitled/
// isActionEntitled expect from the __entitlement blob. Returns null when nothing
// is withheld anywhere (full access) so callers can skip bloating permissions.

export type KeyMap = Record<string, boolean>;
export interface EntitlementRow {
  module_key: string;
  tabs?: KeyMap | null;
  actions?: KeyMap | null;
}
export type EntitlementMap = Record<string, { tabs: KeyMap; actions: KeyMap }>;

export function resolveEntitlement(
  planRows: EntitlementRow[],
  hospRows: EntitlementRow[],
): EntitlementMap | null {
  if (planRows.length === 0 && hospRows.length === 0) return null;

  const planMap = new Map<string, { tabs: KeyMap; actions: KeyMap }>();
  for (const r of planRows) planMap.set(r.module_key, { tabs: r.tabs || {}, actions: r.actions || {} });
  const hospMap = new Map<string, { tabs: KeyMap; actions: KeyMap }>();
  for (const r of hospRows) hospMap.set(r.module_key, { tabs: r.tabs || {}, actions: r.actions || {} });

  const resolveKind = (mod: string, kind: "tabs" | "actions"): KeyMap => {
    const plan = planMap.get(mod)?.[kind] || {};
    const hosp = hospMap.get(mod)?.[kind] || {};
    const out: KeyMap = {};
    for (const k of new Set([...Object.keys(plan), ...Object.keys(hosp)])) {
      const effective = hosp[k] !== undefined ? hosp[k] : plan[k];
      if (effective === false) out[k] = false; // keep only withheld keys
    }
    return out;
  };

  const map: EntitlementMap = {};
  for (const mod of new Set([...planMap.keys(), ...hospMap.keys()])) {
    const tabs = resolveKind(mod, "tabs");
    const actions = resolveKind(mod, "actions");
    if (Object.keys(tabs).length || Object.keys(actions).length) {
      map[mod] = { tabs, actions };
    }
  }
  return Object.keys(map).length ? map : null;
}

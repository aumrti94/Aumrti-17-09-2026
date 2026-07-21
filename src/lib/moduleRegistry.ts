/**
 * Shared module registry for the permission editors (Layer 3 roles + Layer 4 per-user).
 *
 * Layers 1 & 2 (Plans, per-hospital Modules) already iterate the canonical
 * `CANONICAL_MODULE_KEYS`. Historically the role editor (Layer 3) shipped its own
 * hardcoded 18-module array, so ~40 modules could never be customised. This module is
 * the single source of truth both role- and user-level editors now consume, so the four
 * layers stay in lockstep.
 *
 * `PERMISSION_MODULES` = every canonical (sellable) module, grouped by category, PLUS a
 * few internal governance keys (`patients`, `reports`, `user_management`) that are
 * role-gated but never sold as plan add-ons. The routeless `ai_suite` pseudo-module is
 * intentionally excluded — it stays governed by the dedicated AI Features settings page.
 */
import { ALL_MODULES, type ModuleCategory } from "./modules";
import { ROUTE_TO_MODULE_KEY, CANONICAL_MODULE_KEYS } from "./moduleKeys";

export interface PermissionModule {
  key: string;
  label: string;
  category: ModuleCategory;
  icon: string;
}

/** Internal, non-sellable keys the role/user editors must still expose. */
const INTERNAL_MODULES: PermissionModule[] = [
  // The Home dashboard. Its KPI keycards are registered as `dashboard` TABS and its
  // buttons (page + Quick Access sidebar + header) as `dashboard` ACTIONS, so admins can
  // customise which cards/buttons each role and user sees — same 4-layer model as modules.
  { key: "dashboard", label: "Dashboard (Home)", category: "Analytics", icon: "🏠" },
  { key: "patients", label: "Patient Registry", category: "Patient", icon: "📋" },
  { key: "reports", label: "Reports", category: "Analytics", icon: "📈" },
  { key: "user_management", label: "User Management", category: "Settings", icon: "🔑" },
];

/** Labels/categories for canonical keys that have no clean ALL_MODULES entry. */
const LABEL_OVERRIDES: Record<string, { label: string; category: ModuleCategory }> = {
  assets: { label: "Assets", category: "Finance" },
};

// key → first ALL_MODULES entry (name + category + icon) that resolves to it
const NAME_BY_KEY: Record<string, string> = {};
const CATEGORY_BY_KEY: Record<string, ModuleCategory> = {};
const ICON_BY_KEY: Record<string, string> = {};
for (const m of ALL_MODULES) {
  const key = ROUTE_TO_MODULE_KEY[m.route] ?? ROUTE_TO_MODULE_KEY[m.route.split("?")[0]];
  if (!key) continue;
  if (NAME_BY_KEY[key] === undefined) {
    NAME_BY_KEY[key] = m.name;
    CATEGORY_BY_KEY[key] = m.category;
    ICON_BY_KEY[key] = m.icon;
  }
}

/** Ordered list of every module the permission editors render. */
export const PERMISSION_MODULES: PermissionModule[] = [
  ...CANONICAL_MODULE_KEYS.filter((k) => k !== "ai_suite").map((key): PermissionModule => {
    const override = LABEL_OVERRIDES[key];
    return {
      key,
      label: override?.label ?? NAME_BY_KEY[key] ?? key,
      category: override?.category ?? CATEGORY_BY_KEY[key] ?? "Operations",
      icon: ICON_BY_KEY[key] ?? "📦",
    };
  }),
  ...INTERNAL_MODULES,
];

/** Fast lookup of the module list keys. */
export const PERMISSION_MODULE_KEYS: string[] = PERMISSION_MODULES.map((m) => m.key);

/**
 * Legacy inheritance map: child module key → the bucket its route used to resolve to
 * under the OLD prefix-matched `ROUTE_TO_MODULE`. Used two ways so the enforcement
 * rewire (route→own-key) never regresses access that previously flowed through a bucket:
 *   1. runtime fallback in routeRoles.ts (`hasAccess`/`hasPermission`) when a role blob
 *      has no entry for the specific key;
 *   2. the one-time backfill migration that copies each parent's perms into the child key.
 * Every OTHER specialty key was already deny-for-configured-roles (admin-only via bypass),
 * so it stays default-deny after the rewire — no regression, and now grantable in the UI.
 */
export const LEGACY_MODULE_PARENT: Record<string, string> = {
  day_care: "ipd",
  telemedicine: "opd",
  pharmacy_retail: "pharmacy",
  day_closure: "billing",
  payments: "billing",
  accounts: "billing",
  pmjay: "insurance",
  blood_bank: "ipd",
  cssd: "ipd",
  dialysis: "ipd",
  oncology: "ipd",
  mrd: "patients",
  lms: "hr",
  crm: "analytics",
  ipc: "quality",
  fms: "quality",
};

const CRUD_ACTIONS = ["view", "create", "edit", "delete", "approve", "export"] as const;

/** Per-user withhold blob: same shape as a role blob but only carries `false` entries. */
export type UserOverrideBlob = Record<
  string,
  {
    view?: boolean;
    create?: boolean;
    edit?: boolean;
    delete?: boolean;
    approve?: boolean;
    export?: boolean;
    tabs?: Record<string, boolean>;
    actions?: Record<string, boolean>;
  }
>;

/** Expand a legacy `"r"`/`"rw"` module value into the granular boolean shape. */
function expandLegacyString(val: string): Record<string, boolean> {
  const read = val === "r" || val === "rw";
  const write = val === "rw";
  return { view: read, create: write, edit: write, delete: write, approve: false, export: read };
}

/**
 * Apply a per-user override (Layer 4) onto the resolved role blob (Layer 3).
 *
 * RESTRICT-ONLY: it can only flip a role's granted permission `true → false`; it never
 * grants anything the role lacks (the UI only offers to withhold what the role already
 * gives, and this merge only writes `false`). Operates on a deep clone — the shared DB
 * role blob is never mutated. Returns `rolePerms` untouched when there is nothing to
 * withhold, preserving the "null = fully permissive" convention downstream.
 *
 * Withholds are only applied to modules the role actually grants (present in the blob).
 * A module the role never granted is already denied, so writing to it would be noise.
 */
export function applyUserOverrides(
  rolePerms: Record<string, any> | null,
  withholds: UserOverrideBlob | null | undefined,
): Record<string, any> | null {
  if (!withholds || Object.keys(withholds).length === 0) return rolePerms;

  // Clone so we never touch the cached/shared role blob.
  const base: Record<string, any> =
    typeof structuredClone === "function"
      ? structuredClone(rolePerms ?? {})
      : JSON.parse(JSON.stringify(rolePerms ?? {}));

  for (const [moduleKey, w] of Object.entries(withholds)) {
    let mod = base[moduleKey];
    if (mod === undefined || mod === null) continue; // role never granted → nothing to restrict
    if (typeof mod === "string") mod = expandLegacyString(mod); // normalize before withholding
    else mod = { ...mod, tabs: { ...(mod.tabs ?? {}) }, actions: { ...(mod.actions ?? {}) } };

    for (const a of CRUD_ACTIONS) {
      if (w[a] === false) mod[a] = false;
    }
    if (w.tabs) {
      mod.tabs = mod.tabs ?? {};
      for (const [t, v] of Object.entries(w.tabs)) if (v === false) mod.tabs[t] = false;
    }
    if (w.actions) {
      mod.actions = mod.actions ?? {};
      for (const [ac, v] of Object.entries(w.actions)) if (v === false) mod.actions[ac] = false;
    }
    base[moduleKey] = mod;
  }

  return base;
}

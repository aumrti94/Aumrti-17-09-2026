// ─────────────────────────────────────────────────────────────
// Module ▸ Department resolution
// Ties the specialized/clinical modules a hospital runs to the departments
// they imply, so Settings ▸ Departments can suggest exactly the departments
// that match the hospital's enabled modules (and nothing more).
//
// NOTE: This never auto-creates departments. A trial / no-subscription
// hospital has ALL modules enabled, so silent provisioning would spawn every
// specialized department — the opposite of a lean default. Callers surface
// these as opt-in suggestions and let the admin add what they actually have.
// ─────────────────────────────────────────────────────────────

import { ALL_MODULES, MODULE_DEPARTMENT } from "@/lib/modules";
import { getModuleKeyFromRoute } from "@/hooks/useSubscriptionConfig";

export interface ModuleDepartmentLink {
  moduleKey: string;
  moduleName: string;
  department: string;
}

/** Every (module → department) link, resolved to canonical module keys. */
export function moduleDepartmentLinks(): ModuleDepartmentLink[] {
  const links: ModuleDepartmentLink[] = [];
  for (const m of ALL_MODULES) {
    const department = MODULE_DEPARTMENT[m.route.split("?")[0]];
    if (!department) continue;
    const moduleKey = getModuleKeyFromRoute(m.route);
    if (!moduleKey) continue;
    links.push({ moduleKey, moduleName: m.name, department });
  }
  return links;
}

/**
 * Unique department names implied by a set of enabled module keys.
 * Passing the hospital's accessible modules yields exactly the departments
 * those modules require.
 */
export function departmentsForModules(enabledModuleKeys: Iterable<string>): string[] {
  const enabled = new Set(enabledModuleKeys);
  const departments = new Set<string>();
  for (const link of moduleDepartmentLinks()) {
    if (enabled.has(link.moduleKey)) departments.add(link.department);
  }
  return [...departments];
}

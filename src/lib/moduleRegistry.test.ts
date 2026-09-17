import { describe, it, expect } from "vitest";
import {
  applyUserOverrides,
  PERMISSION_MODULES,
  PERMISSION_MODULE_KEYS,
  LEGACY_MODULE_PARENT,
  type UserOverrideBlob,
} from "@/lib/moduleRegistry";

describe("applyUserOverrides — Layer 4 per-user withholds", () => {
  it("returns rolePerms untouched when there is nothing to withhold", () => {
    const rolePerms = { ipd: { view: true } };
    expect(applyUserOverrides(rolePerms, null)).toBe(rolePerms);
    expect(applyUserOverrides(rolePerms, {})).toBe(rolePerms);
  });

  it("flips a granted CRUD action to false for the named module", () => {
    const rolePerms = { ipd: { view: true, edit: true, delete: true } };
    const withholds: UserOverrideBlob = { ipd: { delete: false } };
    const result = applyUserOverrides(rolePerms, withholds);
    expect((result as any).ipd.view).toBe(true);
    expect((result as any).ipd.edit).toBe(true);
    expect((result as any).ipd.delete).toBe(false);
  });

  it("is restrict-only: withholding an action the role never granted (module absent) is a no-op", () => {
    const rolePerms = { ipd: { view: true } };
    const withholds: UserOverrideBlob = { pharmacy: { view: false } };
    const result = applyUserOverrides(rolePerms, withholds);
    expect(result).toEqual({ ipd: { view: true } });
    expect((result as any).pharmacy).toBeUndefined();
  });

  it("two users with different withholds on the same role get different effective permissions", () => {
    const rolePerms = { billing: { view: true, edit: true, export: true } };
    const userA = applyUserOverrides(rolePerms, { billing: { export: false } });
    const userB = applyUserOverrides(rolePerms, { billing: { edit: false } });
    expect((userA as any).billing.export).toBe(false);
    expect((userA as any).billing.edit).toBe(true);
    expect((userB as any).billing.edit).toBe(false);
    expect((userB as any).billing.export).toBe(true);
  });

  it("withholds a tab without touching sibling tabs", () => {
    const rolePerms = { dashboard: { view: true, tabs: { kpi_revenue: true, kpi_census: true } } };
    const result = applyUserOverrides(rolePerms, { dashboard: { tabs: { kpi_revenue: false } } });
    expect((result as any).dashboard.tabs).toEqual({ kpi_revenue: false, kpi_census: true });
  });

  it("withholds a granular action without touching siblings", () => {
    const rolePerms = { lab: { view: true, actions: { print_report: true, cancel_order: true } } };
    const result = applyUserOverrides(rolePerms, { lab: { actions: { cancel_order: false } } });
    expect((result as any).lab.actions).toEqual({ print_report: true, cancel_order: false });
  });

  it("normalizes a legacy 'rw' string module before withholding", () => {
    const rolePerms = { radiology: "rw" };
    const result = applyUserOverrides(rolePerms, { radiology: { delete: false } });
    expect(result).toEqual({
      radiology: { view: true, create: true, edit: true, delete: false, approve: false, export: true },
    });
  });

  it("never mutates the original role permissions object (deep clone)", () => {
    const rolePerms = { ipd: { view: true, delete: true } };
    const frozenCopy = JSON.parse(JSON.stringify(rolePerms));
    applyUserOverrides(rolePerms, { ipd: { delete: false } });
    expect(rolePerms).toEqual(frozenCopy);
  });

  it("handles a null rolePerms base without throwing", () => {
    expect(() => applyUserOverrides(null, { ipd: { view: false } })).not.toThrow();
    expect(applyUserOverrides(null, { ipd: { view: false } })).toEqual({});
  });
});

describe("PERMISSION_MODULES / LEGACY_MODULE_PARENT — structural invariants", () => {
  it("every module key appears exactly once in PERMISSION_MODULE_KEYS", () => {
    const seen = new Set<string>();
    for (const k of PERMISSION_MODULE_KEYS) {
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  it("PERMISSION_MODULE_KEYS is derived from PERMISSION_MODULES in the same order", () => {
    expect(PERMISSION_MODULE_KEYS).toEqual(PERMISSION_MODULES.map((m) => m.key));
  });

  it("ai_suite is deliberately excluded from the permission editors", () => {
    expect(PERMISSION_MODULE_KEYS).not.toContain("ai_suite");
  });

  it("'accounts' deliberately has no legacy-parent fallback", () => {
    expect(LEGACY_MODULE_PARENT.accounts).toBeUndefined();
  });

  it("every LEGACY_MODULE_PARENT target is itself a real, grantable permission module", () => {
    for (const parent of Object.values(LEGACY_MODULE_PARENT)) {
      expect(PERMISSION_MODULE_KEYS).toContain(parent);
    }
  });
});

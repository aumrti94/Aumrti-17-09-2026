import { describe, it, expect } from "vitest";
import { hasAccess, hasPermission, ROUTE_TO_MODULE } from "./routeRoles";

describe("route→module rewire", () => {
  it("resolves specialty routes to their OWN module key, not a bucket", () => {
    expect(ROUTE_TO_MODULE["/dialysis"]).toBe("dialysis");
    expect(ROUTE_TO_MODULE["/payments"]).toBe("payments");
    expect(ROUTE_TO_MODULE["/accounts"]).toBe("accounts");
    expect(ROUTE_TO_MODULE["/billing/closure"]).toBe("day_closure");
  });
});

describe("LEGACY_MODULE_PARENT enforcement fallback (no-regression for pre-rewire blobs)", () => {
  const doctor = "doctor";

  it("grants a specialty route when the legacy bucket is granted and the child key is absent", () => {
    const perms = { ipd: { view: true, create: true, edit: true, delete: false, approve: false, export: true } };
    // /dialysis now maps to `dialysis`; the blob only has `ipd` → falls back to the parent
    expect(hasAccess("/dialysis", doctor, perms)).toBe(true);
    expect(hasPermission("dialysis", "view", perms, doctor)).toBe(true);
  });

  it("an explicit child entry wins over the parent fallback", () => {
    const perms = {
      ipd: { view: true, create: true, edit: true, delete: false, approve: false, export: true },
      dialysis: { view: false, create: false, edit: false, delete: false, approve: false, export: false },
    };
    expect(hasAccess("/dialysis", doctor, perms)).toBe(false);
    expect(hasPermission("dialysis", "view", perms, doctor)).toBe(false);
  });

  it("denies a specialty with no bucket grant and no child entry", () => {
    const perms = { opd: { view: true, create: false, edit: false, delete: false, approve: false, export: false } };
    expect(hasAccess("/dialysis", doctor, perms)).toBe(false);
  });

  it("still bypasses for admins", () => {
    expect(hasAccess("/dialysis", "hospital_admin", {})).toBe(true);
  });
});

describe("the settings surface is gated by role, not by module entitlement", () => {
  // A full-access view grant on the module each settings page USED to resolve to. Before the
  // fix these blobs were the whole exploit: /settings/discharge-workflow resolved to `ipd`, so
  // any nurse who could chart on the ward could also rewrite the discharge checklist.
  const view = { view: true, create: true, edit: true, delete: true, approve: true, export: true };

  it("denies a nurse the discharge workflow config even with ipd view", () => {
    expect(hasAccess("/settings/discharge-workflow", "nurse", { ipd: view })).toBe(false);
  });

  it("denies a receptionist the OPD queue config even with opd view", () => {
    expect(hasAccess("/settings/opd-workflow", "receptionist", { opd: view })).toBe(false);
  });

  it("denies the module-keyed settings pages to the roles that use those modules", () => {
    expect(hasAccess("/settings/services", "billing_staff", { billing: view })).toBe(false);
    expect(hasAccess("/settings/gst", "accountant", { billing: view })).toBe(false);
    expect(hasAccess("/settings/lab-tests", "lab_technician", { lab: view })).toBe(false);
    expect(hasAccess("/settings/drugs", "pharmacist", { pharmacy: view })).toBe(false);
    expect(hasAccess("/settings/radiology", "radiologist", { radiology: view })).toBe(false);
    expect(hasAccess("/settings/bank-accounts", "cfo", { accounts: view })).toBe(false);
  });

  it("denies the unmapped settings pages that used to fall through to the `settings` key", () => {
    // `settings` is ALWAYS_ENABLED, so this blob is what an ordinary staff role really carries.
    const perms = { settings: view };
    for (const route of ["/settings", "/settings/wards", "/settings/staff", "/settings/roles", "/settings/branding"]) {
      expect(hasAccess(route, "nurse", perms), route).toBe(false);
      expect(hasAccess(route, "doctor", perms), route).toBe(false);
    }
  });

  it("a doctor typing the URL directly is still refused", () => {
    expect(hasAccess("/settings/wards", "doctor", { ipd: view, opd: view })).toBe(false);
  });

  it("keeps the two deliberate exceptions open", () => {
    // Every authenticated user edits their own profile; reception drives the waiting-room TV.
    expect(hasAccess("/settings/profile", "nurse", {})).toBe(true);
    expect(hasAccess("/settings/profile", "pharmacist", null)).toBe(true);
    expect(hasAccess("/settings/tv-display", "receptionist", {})).toBe(true);
    expect(hasAccess("/settings/tv-display", "nurse", {})).toBe(false);
  });

  it("admins still reach the whole settings surface — the control that proves the gate is not a blanket deny", () => {
    for (const route of ["/settings", "/settings/wards", "/settings/discharge-workflow", "/settings/hl7", "/settings/plan"]) {
      expect(hasAccess(route, "hospital_admin", {}), route).toBe(true);
      expect(hasAccess(route, "super_admin", null), route).toBe(true);
    }
  });

  it("does not change gating for non-settings routes", () => {
    expect(hasAccess("/ipd", "nurse", { ipd: view })).toBe(true);
    expect(hasAccess("/opd", "receptionist", { opd: view })).toBe(true);
  });
});

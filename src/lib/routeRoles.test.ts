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

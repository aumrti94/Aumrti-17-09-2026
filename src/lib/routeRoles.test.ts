import { describe, it, expect } from "vitest";
import { hasAccess, hasPermission, ROUTE_ROLES, BYPASS_ROLES } from "@/lib/routeRoles";

describe("hasAccess", () => {
  it("denies access with no role", () => {
    expect(hasAccess("/patients", null, null)).toBe(false);
  });

  it("grants bypass roles every route regardless of permissions", () => {
    for (const role of BYPASS_ROLES) {
      expect(hasAccess("/settings/discharge-workflow", role, {})).toBe(true);
      expect(hasAccess("/anything/not/registered", role, { all: false })).toBe(true);
    }
  });

  it("grants every authenticated role the core routes with no permissions row", () => {
    expect(hasAccess("/dashboard", "nurse", null)).toBe(true);
    expect(hasAccess("/inbox", "receptionist", null)).toBe(true);
    expect(hasAccess("/settings/profile", "pharmacist", null)).toBe(true);
  });

  describe("the /settings/* gate — must never fall through to the permissions blob", () => {
    // This is the exact regression documented in routeRoles.ts: a nurse with `ipd: {view:true}`
    // must not reach /settings/discharge-workflow just because `ipd` maps there under
    // ROUTE_TO_MODULE. The settings surface is role-gated only, via ROUTE_ROLES.
    it("denies a non-admin role even when its permissions blob grants the underlying module", () => {
      const nurseWithFullIpdAccess = { ipd: { view: true, edit: true }, all: false };
      expect(hasAccess("/settings/discharge-workflow", "nurse", nurseWithFullIpdAccess)).toBe(false);
    });

    it("denies even when permissions.all === true — settings ignores the blob entirely", () => {
      expect(hasAccess("/settings/discharge-workflow", "nurse", { all: true })).toBe(false);
    });

    it("grants hospital_admin/super_admin the settings surface", () => {
      expect(hasAccess("/settings/discharge-workflow", "hospital_admin", {})).toBe(true);
      expect(hasAccess("/settings", "super_admin", null)).toBe(true);
    });

    it("carves out /settings/profile for every role and /settings/tv-display for reception", () => {
      expect(hasAccess("/settings/profile", "nurse", {})).toBe(true);
      expect(hasAccess("/settings/tv-display", "receptionist", {})).toBe(true);
      expect(hasAccess("/settings/tv-display", "nurse", {})).toBe(false);
    });

    it("denies an unregistered settings sub-path for a non-admin role", () => {
      expect(hasAccess("/settings/some-future-screen", "nurse", null)).toBe(false);
    });
  });

  describe("dynamic permissions blob (non-settings routes) — different config, different decision", () => {
    it("grants when the module's permission string is r or rw", () => {
      expect(hasAccess("/patients", "doctor", { patients: "r" })).toBe(true);
      expect(hasAccess("/patients", "doctor", { patients: "rw" })).toBe(true);
    });

    it("denies when the module key is present but view is not granted", () => {
      expect(hasAccess("/patients", "doctor", { patients: { view: false } })).toBe(false);
      expect(hasAccess("/patients", "doctor", { patients: {} })).toBe(false);
    });

    it("grants when the module's object permission has view: true", () => {
      expect(hasAccess("/patients", "doctor", { patients: { view: true } })).toBe(true);
    });

    it("denies by default when permissions are explicitly configured but empty", () => {
      // Explicit {} means "no permissions granted", not "fall back to static defaults" —
      // this is the deliberate fail-closed behaviour the module comment calls out.
      expect(hasAccess("/patients", "doctor", {})).toBe(false);
    });

    it("denies a route with no module mapping when permissions are configured", () => {
      expect(hasAccess("/some/unmapped/route", "doctor", { patients: "rw" })).toBe(false);
    });

    it("permissions.all === true grants any non-settings route", () => {
      expect(hasAccess("/some/unmapped/route", "doctor", { all: true })).toBe(true);
    });
  });

  describe("static fallback (permissions row absent entirely)", () => {
    it("uses ROUTE_ROLES when permissions is null/undefined", () => {
      const allowed = ROUTE_ROLES["/lab"];
      expect(allowed).toContain("lab_technician");
      expect(hasAccess("/lab", "lab_technician", undefined)).toBe(true);
      expect(hasAccess("/lab", "receptionist", undefined)).toBe(false);
    });

    it("falls back to the nearest parent prefix for an unregistered sub-route", () => {
      expect(hasAccess("/lab/some-new-subpage", "lab_technician", undefined)).toBe(true);
      expect(hasAccess("/lab/some-new-subpage", "receptionist", undefined)).toBe(false);
    });

    it("denies a role with no static entry for an unmapped route", () => {
      expect(hasAccess("/totally/unknown", "doctor", undefined)).toBe(false);
    });
  });
});

describe("hasPermission", () => {
  it("denies with no role or no permissions", () => {
    expect(hasPermission("ipd", "view", { ipd: "rw" }, null)).toBe(false);
    expect(hasPermission("ipd", "view", null, "doctor")).toBe(false);
  });

  it("grants bypass roles regardless of the permissions blob", () => {
    expect(hasPermission("ipd", "delete", {}, "super_admin")).toBe(true);
  });

  it("legacy string format: rw grants create/edit/delete, r denies them", () => {
    expect(hasPermission("ipd", "view", { ipd: "r" }, "nurse")).toBe(true);
    expect(hasPermission("ipd", "edit", { ipd: "r" }, "nurse")).toBe(false);
    expect(hasPermission("ipd", "edit", { ipd: "rw" }, "nurse")).toBe(true);
    expect(hasPermission("ipd", "delete", { ipd: "rw" }, "nurse")).toBe(true);
  });

  it("granular object format checks the exact action key", () => {
    const perms = { ipd: { view: true, edit: true, delete: false, approve: false } };
    expect(hasPermission("ipd", "view", perms, "nurse")).toBe(true);
    expect(hasPermission("ipd", "edit", perms, "nurse")).toBe(true);
    expect(hasPermission("ipd", "delete", perms, "nurse")).toBe(false);
    expect(hasPermission("ipd", "approve", perms, "nurse")).toBe(false);
  });

  it("permissions.all === true grants every action", () => {
    expect(hasPermission("ipd", "delete", { all: true }, "nurse")).toBe(true);
  });

  it("denies an action for a module key entirely absent from the blob", () => {
    expect(hasPermission("radiology", "view", { ipd: "rw" }, "nurse")).toBe(false);
  });
});

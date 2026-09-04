import { describe, it, expect } from "vitest";
import { APP_ROLES, DISCOUNT_OVERRIDE_ROLES, roleLabel, roleLabels, canApproveTier } from "./appRoles";

describe("APP_ROLES — canonical app_role enum mirror", () => {
  it("has a unique value for every role", () => {
    const values = APP_ROLES.map((r) => r.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("includes the non-existent role this file's own comment warns against re-introducing", () => {
    // The comment documents a real incident: "billing_supervisor" was offered as an
    // approver but isn't a role a user can hold, so authorization silently never matched.
    expect(APP_ROLES.map((r) => r.value)).not.toContain("billing_supervisor");
  });
});

describe("roleLabel", () => {
  it("returns the human label for a known role", () => {
    expect(roleLabel("hospital_admin")).toBe("Admin");
    expect(roleLabel("cfo")).toBe("CFO");
  });

  it("falls back to the raw value for an unknown role", () => {
    expect(roleLabel("some_future_role")).toBe("some_future_role");
  });

  it("shows an em dash for a missing role", () => {
    expect(roleLabel(null)).toBe("—");
    expect(roleLabel(undefined)).toBe("—");
    expect(roleLabel("")).toBe("—");
  });
});

describe("roleLabels", () => {
  it("comma-joins labels for multiple roles", () => {
    expect(roleLabels(["cfo", "hospital_admin"])).toBe("CFO, Admin");
  });

  it("shows an em dash for an empty or missing list", () => {
    expect(roleLabels([])).toBe("—");
    expect(roleLabels(null)).toBe("—");
    expect(roleLabels(undefined)).toBe("—");
  });
});

describe("canApproveTier — discount-approval authorization", () => {
  it("authorizes a role explicitly listed as a required approver", () => {
    expect(canApproveTier("cfo", ["cfo", "hospital_admin"])).toBe(true);
  });

  it("rejects a role not in the required list", () => {
    expect(canApproveTier("receptionist", ["cfo", "hospital_admin"])).toBe(false);
  });

  it("override roles (hospital_admin, super_admin) always qualify, regardless of the configured tier", () => {
    for (const role of DISCOUNT_OVERRIDE_ROLES) {
      expect(canApproveTier(role, ["cfo"])).toBe(true);
      expect(canApproveTier(role, [])).toBe(true);
      expect(canApproveTier(role, null)).toBe(true);
    }
  });

  it("rejects a missing role outright, even against an empty required list", () => {
    expect(canApproveTier(null, [])).toBe(false);
    expect(canApproveTier(undefined, ["cfo"])).toBe(false);
  });

  it("rejects when no required roles are configured and the role isn't an override", () => {
    expect(canApproveTier("cfo", null)).toBe(false);
    expect(canApproveTier("cfo", [])).toBe(false);
  });
});

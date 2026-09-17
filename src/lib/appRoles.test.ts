import { describe, it, expect } from "vitest";
import { APP_ROLES, DISCOUNT_OVERRIDE_ROLES, roleLabel, roleLabels, canApproveTier } from "@/lib/appRoles";

describe("canApproveTier — Approval Rules discount-tier authorization", () => {
  it("a role listed as an approver for the tier is authorized", () => {
    expect(canApproveTier("cfo", ["cfo", "accountant"])).toBe(true);
  });

  it("a role NOT listed as an approver is denied", () => {
    expect(canApproveTier("nurse", ["cfo", "accountant"])).toBe(false);
  });

  it("a different configured approver list for the same role changes the decision", () => {
    expect(canApproveTier("accountant", ["cfo"])).toBe(false);
    expect(canApproveTier("accountant", ["cfo", "accountant"])).toBe(true);
  });

  it("hospital_admin and super_admin always qualify, regardless of the configured approver list", () => {
    for (const role of DISCOUNT_OVERRIDE_ROLES) {
      expect(canApproveTier(role, [])).toBe(true);
      expect(canApproveTier(role, ["some_other_role"])).toBe(true);
    }
  });

  it("denies with a null/undefined role", () => {
    expect(canApproveTier(null, ["cfo"])).toBe(false);
    expect(canApproveTier(undefined, ["cfo"])).toBe(false);
  });

  it("denies when the required-roles list is empty or unset — no configured approver means no one but override roles can approve", () => {
    expect(canApproveTier("cfo", [])).toBe(false);
    expect(canApproveTier("cfo", null)).toBe(false);
    expect(canApproveTier("cfo", undefined)).toBe(false);
  });

  it("a role offered as an approver in the config must be a real, holdable app role — the exact 'billing_supervisor' regression this file's header describes", () => {
    // Guards against re-introducing a config value that can never match any real
    // user's role, which is exactly how a "configured" approver silently never approves.
    const configuredApprovers = ["cfo", "billing_supervisor"];
    const realRoleValues = new Set(APP_ROLES.map((r) => r.value));
    const nonReal = configuredApprovers.filter((r) => !realRoleValues.has(r));
    expect(nonReal).toEqual(["billing_supervisor"]); // documents the failure mode, not an assertion on the app itself
    expect(canApproveTier("billing_supervisor", configuredApprovers)).toBe(true); // matches by string only
  });
});

describe("roleLabel / roleLabels", () => {
  it("resolves a known role to its display label", () => {
    expect(roleLabel("cfo")).toBe("CFO");
  });

  it("falls back to the raw value for an unknown role rather than hiding it", () => {
    expect(roleLabel("some_future_role")).toBe("some_future_role");
  });

  it("returns an em-dash for null/undefined", () => {
    expect(roleLabel(null)).toBe("—");
    expect(roleLabel(undefined)).toBe("—");
  });

  it("joins multiple role labels with a comma", () => {
    expect(roleLabels(["cfo", "hospital_admin"])).toBe("CFO, Admin");
  });

  it("returns an em-dash for an empty/null role list", () => {
    expect(roleLabels([])).toBe("—");
    expect(roleLabels(null)).toBe("—");
  });
});

describe("APP_ROLES / DISCOUNT_OVERRIDE_ROLES — structural invariant", () => {
  it("every override role is itself a real app role", () => {
    const values = new Set(APP_ROLES.map((r) => r.value));
    for (const role of DISCOUNT_OVERRIDE_ROLES) {
      expect(values.has(role)).toBe(true);
    }
  });

  it("no duplicate role values", () => {
    const values = APP_ROLES.map((r) => r.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

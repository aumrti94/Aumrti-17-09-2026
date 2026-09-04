import { describe, it, expect } from "vitest";
import { DIGEST_ALLOWED_ROLES } from "./digestRoles";

describe("DIGEST_ALLOWED_ROLES — who can generate the NABH weekly digest", () => {
  it("includes the quality-chain roles the digest is built for", () => {
    expect(DIGEST_ALLOWED_ROLES).toEqual(
      expect.arrayContaining([
        "quality_head",
        "quality_manager",
        "quality_officer",
        "medical_superintendent",
      ]),
    );
  });

  it("includes both admin roles as an override, matching the wider app_role convention", () => {
    expect(DIGEST_ALLOWED_ROLES).toEqual(
      expect.arrayContaining(["super_admin", "hospital_admin"]),
    );
  });

  it("has no duplicate entries", () => {
    expect(new Set(DIGEST_ALLOWED_ROLES).size).toBe(DIGEST_ALLOWED_ROLES.length);
  });

  it("does not grant digest access to clinical/billing-floor roles", () => {
    expect(DIGEST_ALLOWED_ROLES).not.toContain("doctor");
    expect(DIGEST_ALLOWED_ROLES).not.toContain("nurse");
    expect(DIGEST_ALLOWED_ROLES).not.toContain("receptionist");
  });
});

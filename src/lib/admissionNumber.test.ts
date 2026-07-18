import { describe, it, expect } from "vitest";
import { admissionNumberPrefix } from "./admissionNumber";

describe("admissionNumberPrefix", () => {
  it("puts day care admissions on the DC series", () => {
    expect(admissionNumberPrefix("daycare")).toBe("DC");
  });

  it("puts every inpatient admission type on the IPD series", () => {
    expect(admissionNumberPrefix("elective")).toBe("IPD");
    expect(admissionNumberPrefix("emergency")).toBe("IPD");
    expect(admissionNumberPrefix("planned")).toBe("IPD");
  });

  it("defaults null/undefined/unknown to IPD", () => {
    expect(admissionNumberPrefix(null)).toBe("IPD");
    expect(admissionNumberPrefix(undefined)).toBe("IPD");
    expect(admissionNumberPrefix("")).toBe("IPD");
    expect(admissionNumberPrefix("some_future_type")).toBe("IPD");
  });

  it("matches daycare case-insensitively", () => {
    expect(admissionNumberPrefix("DAYCARE")).toBe("DC");
  });

  it("stays in lockstep with the bill-type rule", () => {
    // Both derive from admissionBillType, so an admission can never be numbered DC- while
    // its charges route to an ipd bill (or vice versa).
    expect(admissionNumberPrefix("day_care")).toBe("IPD"); // underscored form is not an admission_type
  });
});

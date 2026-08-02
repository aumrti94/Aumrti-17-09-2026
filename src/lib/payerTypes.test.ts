import { describe, it, expect } from "vitest";
import { bundlesNursingIntoRoom, INSURANCE_PAYER_TYPES } from "./payerTypes";

/**
 * This predicate decides whether a separate nursing line appears on an admission's bill.
 * A false negative bills nursing to a scheme patient — CGHS 2025 Annexure-III forbids it
 * ("bundled in the ward charges and therefore not payable separately or billable to the
 * patient") and the TPA deducts it, so the hospital books revenue it will never collect.
 * A false positive silently drops legitimate cash revenue. Hence the exhaustive table.
 */
describe("bundlesNursingIntoRoom", () => {
  it("bundles nursing for every government scheme", () => {
    expect(bundlesNursingIntoRoom("cghs")).toBe(true);
    expect(bundlesNursingIntoRoom("echs")).toBe(true);
    expect(bundlesNursingIntoRoom("esi")).toBe(true);
    expect(bundlesNursingIntoRoom("esic")).toBe(true);
    expect(bundlesNursingIntoRoom("pmjay")).toBe(true);
    expect(bundlesNursingIntoRoom("state_scheme")).toBe(true);
  });

  it("bundles nursing for TPA, insurer and corporate payers", () => {
    expect(bundlesNursingIntoRoom("tpa")).toBe(true);
    expect(bundlesNursingIntoRoom("insurance")).toBe(true);
    expect(bundlesNursingIntoRoom("corporate")).toBe(true);
  });

  it("bills nursing separately for cash and self-pay patients", () => {
    expect(bundlesNursingIntoRoom("cash")).toBe(false);
    expect(bundlesNursingIntoRoom("self_pay")).toBe(false);
  });

  it("treats an unset payer as cash — a patient with no payer recorded is self-paying", () => {
    expect(bundlesNursingIntoRoom(null)).toBe(false);
    expect(bundlesNursingIntoRoom(undefined)).toBe(false);
    expect(bundlesNursingIntoRoom("")).toBe(false);
  });

  it("normalises case and stray whitespace rather than silently billing a scheme patient", () => {
    expect(bundlesNursingIntoRoom("CGHS")).toBe(true);
    expect(bundlesNursingIntoRoom(" tpa ")).toBe(true);
    expect(bundlesNursingIntoRoom("Insurance")).toBe(true);
  });

  it("does not bundle for an unrecognised payer — new payer types default to billable", () => {
    expect(bundlesNursingIntoRoom("some_new_scheme")).toBe(false);
  });
});

/**
 * Hoisted verbatim out of IPDWorkspace. Pinned so the pre-auth prompt keeps firing for
 * exactly the payers it fired for before, independent of the nursing list beside it.
 */
describe("INSURANCE_PAYER_TYPES", () => {
  it("keeps the pre-auth payer list unchanged", () => {
    expect(INSURANCE_PAYER_TYPES).toEqual([
      "tpa", "pmjay", "cghs", "esi", "state_scheme", "corporate",
    ]);
  });
});

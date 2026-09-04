import { describe, it, expect } from "vitest";

// PATIENT SAFETY / NABH COP.6 — nurse:patient ratio is a compliance-mandated minimum, not
// a suggestion, so every rounding boundary is pinned explicitly (Math.ceil per acuity tier
// means a single high-acuity patient alone still requires a full nurse, never a fraction).
//
// computeWardAcuity (the Supabase-backed wrapper around this) is deliberately not covered
// here — same policy as billTotals.ts: the pure calculation is fully tested, the async I/O
// wrapper around it is not.

import { calculateRequiredNurses } from "./acuityStaffing";

describe("calculateRequiredNurses — NABH COP.6 nurse:patient ratios (1:3 high / 1:4 medium / 1:6 low)", () => {
  it("requires 1 nurse for a single high-acuity patient, not a rounded-down fraction", () => {
    expect(calculateRequiredNurses(1, 1, 0)).toBe(1);
  });

  it("requires 2 nurses for 4 high-acuity patients (ceil(4/3))", () => {
    expect(calculateRequiredNurses(4, 4, 0)).toBe(2);
  });

  it("sums nurses required across all three acuity tiers independently", () => {
    // 6 high (ceil 6/3=2) + 4 medium (ceil 4/4=1) + 6 low (ceil 6/6=1) = 4
    expect(calculateRequiredNurses(16, 6, 4)).toBe(4);
  });

  it("requires exactly 1 nurse for a single low-acuity patient — never zero", () => {
    expect(calculateRequiredNurses(1, 0, 0)).toBe(1);
  });

  it("never returns zero even for an empty ward — floors at 1", () => {
    expect(calculateRequiredNurses(0, 0, 0)).toBe(1);
  });

  it("rounds each tier up independently rather than rounding the blended total", () => {
    // 1 high (ceil 1/3=1) + 1 medium (ceil 1/4=1) + 1 low (ceil 1/6=1) = 3,
    // not ceil(3 patients / blended ratio) which would understate the need.
    expect(calculateRequiredNurses(3, 1, 1)).toBe(3);
  });
});

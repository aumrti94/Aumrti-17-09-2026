import { describe, it, expect } from "vitest";
import { reassessmentTargetMinutes, isReassessmentOverdue } from "./edSla";

describe("reassessmentTargetMinutes — ED triage reassessment SLA targets", () => {
  it("returns the documented target for each triage level", () => {
    expect(reassessmentTargetMinutes("P1")).toBe(0);
    expect(reassessmentTargetMinutes("P2")).toBe(10);
    expect(reassessmentTargetMinutes("P3")).toBe(30);
    expect(reassessmentTargetMinutes("P4")).toBe(60);
  });

  it("returns null for an unrecognised triage level", () => {
    expect(reassessmentTargetMinutes("P5")).toBeNull();
    expect(reassessmentTargetMinutes("")).toBeNull();
  });
});

describe("isReassessmentOverdue — flags patients waiting past their SLA window", () => {
  it("flags a P2 patient waiting 15 minutes as overdue (target 10)", () => {
    expect(isReassessmentOverdue("P2", 15, "awaiting")).toBe(true);
  });

  it("does not flag a P2 patient waiting 5 minutes", () => {
    expect(isReassessmentOverdue("P2", 5, "awaiting")).toBe(false);
  });

  it("P1 is continuous monitoring — any wait at all is overdue", () => {
    expect(isReassessmentOverdue("P1", 1, "awaiting")).toBe(true);
  });

  it("never flags an unrecognised triage level", () => {
    expect(isReassessmentOverdue("P5", 999, "awaiting")).toBe(false);
  });

  it("does not flag a patient once disposed (no longer awaiting)", () => {
    expect(isReassessmentOverdue("P2", 999, "admitted")).toBe(false);
    expect(isReassessmentOverdue("P2", 999, "discharged")).toBe(false);
  });

  it("treats a missing disposition as still awaiting", () => {
    expect(isReassessmentOverdue("P2", 15, null)).toBe(true);
    expect(isReassessmentOverdue("P2", 15, undefined)).toBe(true);
  });
});

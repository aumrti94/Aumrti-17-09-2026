import { describe, it, expect } from "vitest";
import { isDaycare, pickDefaultAdmission, ActiveAdmission } from "./pickDefaultAdmission";

const ipd: ActiveAdmission = { id: "a1", admission_number: "ADM-1", admission_type: "inpatient" };
const daycare: ActiveAdmission = { id: "a2", admission_number: "ADM-2", admission_type: "daycare" };

describe("isDaycare", () => {
  it("identifies a daycare admission case-insensitively", () => {
    expect(isDaycare(daycare)).toBe(true);
    expect(isDaycare({ ...daycare, admission_type: "DayCare" })).toBe(true);
  });

  it("does not flag an inpatient admission", () => {
    expect(isDaycare(ipd)).toBe(false);
  });

  it("does not flag an admission with no type set", () => {
    expect(isDaycare({ ...ipd, admission_type: null })).toBe(false);
  });
});

describe("pickDefaultAdmission", () => {
  it("returns null when there are no admissions", () => {
    expect(pickDefaultAdmission([])).toBeNull();
  });

  it("prefers an explicitly requested admission over any default rule", () => {
    expect(pickDefaultAdmission([ipd, daycare], "a2")).toBe(daycare);
  });

  it("falls back to the default rule when the preferred id doesn't match any admission", () => {
    expect(pickDefaultAdmission([ipd, daycare], "nonexistent")).toBe(ipd);
  });

  it("prefers inpatient over day care when nothing is explicitly requested", () => {
    expect(pickDefaultAdmission([daycare, ipd])).toBe(ipd);
  });

  it("falls back to the most recent (first) admission when all are day care", () => {
    const daycare2: ActiveAdmission = { id: "a3", admission_number: "ADM-3", admission_type: "daycare" };
    expect(pickDefaultAdmission([daycare, daycare2])).toBe(daycare);
  });
});

import { describe, it, expect } from "vitest";
import { getScheduledTimes, computePendingDoses, ActiveMedication } from "./marPending";

describe("getScheduledTimes — dosing-frequency shorthand → clock times", () => {
  it("resolves once-daily variants to a single morning dose", () => {
    expect(getScheduledTimes("OD")).toEqual(["08:00"]);
    expect(getScheduledTimes("QD")).toEqual(["08:00"]);
    expect(getScheduledTimes("Once daily")).toEqual(["08:00"]);
  });

  it("resolves twice-daily variants to two doses", () => {
    expect(getScheduledTimes("BD")).toEqual(["08:00", "20:00"]);
    expect(getScheduledTimes("BID")).toEqual(["08:00", "20:00"]);
  });

  it("resolves thrice-daily variants to three doses", () => {
    expect(getScheduledTimes("TDS")).toEqual(["08:00", "14:00", "20:00"]);
    expect(getScheduledTimes("TID")).toEqual(["08:00", "14:00", "20:00"]);
  });

  it("resolves four-times-daily to four doses", () => {
    expect(getScheduledTimes("QID")).toEqual(["06:00", "12:00", "18:00", "22:00"]);
  });

  it("resolves Q6H/Q8H/Q12H interval dosing", () => {
    expect(getScheduledTimes("Q6H")).toEqual(["06:00", "12:00", "18:00", "00:00"]);
    expect(getScheduledTimes("Q8H")).toEqual(["06:00", "14:00", "22:00"]);
    expect(getScheduledTimes("Q12H")).toEqual(["08:00", "20:00"]);
  });

  it("returns no scheduled times for PRN/SOS (as-needed) medication", () => {
    expect(getScheduledTimes("SOS")).toEqual([]);
    expect(getScheduledTimes("PRN")).toEqual([]);
  });

  it("is case-insensitive and tolerates whitespace", () => {
    expect(getScheduledTimes(" bd ")).toEqual(["08:00", "20:00"]);
  });

  it("defaults an unrecognised frequency to once daily rather than dropping the dose silently", () => {
    expect(getScheduledTimes("some odd frequency")).toEqual(["08:00"]);
  });
});

describe("computePendingDoses — expected-but-not-yet-recorded medication doses", () => {
  const meds: ActiveMedication[] = [
    { id: "m1", admission_id: "a1", drug_name: "Paracetamol", dose: "500mg", route: "PO", frequency: "BD" },
  ];

  it("lists every scheduled dose as pending when nothing has been recorded", () => {
    const pending = computePendingDoses(meds, new Set(), "2026-08-24");
    expect(pending).toHaveLength(2);
    expect(pending.map((p) => p.scheduledTime)).toEqual(["08:00", "20:00"]);
    expect(pending[0]).toMatchObject({
      medicationId: "m1",
      admissionId: "a1",
      drugName: "Paracetamol",
      scheduledDate: "2026-08-24",
    });
  });

  it("excludes a dose that already has a recorded outcome, whatever it was", () => {
    const recorded = new Set(["m1_2026-08-24_08:00:00"]);
    const pending = computePendingDoses(meds, recorded, "2026-08-24");
    expect(pending).toHaveLength(1);
    expect(pending[0].scheduledTime).toBe("20:00");
  });

  it("produces no pending doses for a PRN medication", () => {
    const prnMeds: ActiveMedication[] = [
      { id: "m2", admission_id: "a1", drug_name: "Ondansetron", dose: "4mg", route: "IV", frequency: "PRN" },
    ];
    expect(computePendingDoses(prnMeds, new Set(), "2026-08-24")).toEqual([]);
  });

  it("computes independently across multiple medications", () => {
    const twoMeds: ActiveMedication[] = [
      { id: "m1", admission_id: "a1", drug_name: "Paracetamol", dose: "500mg", route: "PO", frequency: "OD" },
      { id: "m2", admission_id: "a1", drug_name: "Amoxicillin", dose: "500mg", route: "PO", frequency: "TDS" },
    ];
    const pending = computePendingDoses(twoMeds, new Set(), "2026-08-24");
    expect(pending).toHaveLength(4); // 1 (OD) + 3 (TDS)
  });
});

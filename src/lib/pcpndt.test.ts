import { describe, it, expect } from "vitest";
import {
  isUltrasoundModality,
  hasObstetricName,
  requiresPcpndtFormF,
  buildFormFRow,
  ageFromDob,
} from "./pcpndt";

// This module exists because a missing PCPNDT Form F is a criminal exposure, not a
// data-quality bug (see the file's own BUG-P4-002/003 note). Locked by
// TC-P4G-016/017/018/019 in the Playwright suite; this is the unit-level backstop.

describe("isUltrasoundModality", () => {
  it("recognises the modality spellings actually seeded in Indian radiology catalogues", () => {
    expect(isUltrasoundModality("USG")).toBe(true);
    expect(isUltrasoundModality("Ultrasound")).toBe(true);
    expect(isUltrasoundModality("Sonography")).toBe(true);
    expect(isUltrasoundModality("Doppler")).toBe(true);
  });

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    expect(isUltrasoundModality("  usg  ")).toBe(true);
  });

  it("rejects a non-ultrasound modality", () => {
    expect(isUltrasoundModality("X-Ray")).toBe(false);
    expect(isUltrasoundModality("CT")).toBe(false);
  });

  it("rejects a missing modality", () => {
    expect(isUltrasoundModality(null)).toBe(false);
    expect(isUltrasoundModality(undefined)).toBe(false);
    expect(isUltrasoundModality("")).toBe(false);
  });
});

describe("hasObstetricName — the exact bug this module fixes (BUG-P4-003)", () => {
  it("recognises house naming conventions the old substring check missed", () => {
    expect(hasObstetricName("USG Pregnancy Profile")).toBe(true);
    expect(hasObstetricName("Anomaly Scan")).toBe(true);
    expect(hasObstetricName("TIFFA")).toBe(true);
    expect(hasObstetricName("NT/NB Scan")).toBe(true);
    expect(hasObstetricName("Fetal Growth Scan")).toBe(true);
    expect(hasObstetricName("Level II Scan")).toBe(true);
  });

  it("still recognises the literal word obstetric", () => {
    expect(hasObstetricName("USG Obstetric (Level II)")).toBe(true);
  });

  it("does not false-positive on an unrelated study name", () => {
    expect(hasObstetricName("USG Abdomen")).toBe(false);
    expect(hasObstetricName("CT Chest")).toBe(false);
  });

  it("handles a missing study name", () => {
    expect(hasObstetricName(null)).toBe(false);
    expect(hasObstetricName(undefined)).toBe(false);
  });
});

describe("requiresPcpndtFormF — the one determination every order path must call", () => {
  it("triggers on an ultrasound with an obstetric-reading name", () => {
    expect(requiresPcpndtFormF({ studyName: "TIFFA", modalityType: "USG" })).toBe(true);
  });

  it("does not trigger on a non-ultrasound modality even with an obstetric-sounding name (TC-P4G-019)", () => {
    // The file's own example: an "Obstetric History" X-ray should not enter the register.
    expect(
      requiresPcpndtFormF({ studyName: "Obstetric History", modalityType: "X-Ray" }),
    ).toBe(false);
  });

  it("does not trigger on an ultrasound with a non-obstetric name", () => {
    expect(requiresPcpndtFormF({ studyName: "USG Abdomen", modalityType: "USG" })).toBe(false);
  });

  it("an explicit requires_form_f=true always wins, even over a non-ultrasound modality", () => {
    expect(
      requiresPcpndtFormF({ studyName: "Custom Study", modalityType: "CT", requiresFormF: true }),
    ).toBe(true);
  });

  it("an explicit requires_form_f=false does not suppress the keyword fallback (over-inclusive by design)", () => {
    expect(
      requiresPcpndtFormF({ studyName: "TIFFA", modalityType: "USG", requiresFormF: false }),
    ).toBe(true);
  });
});

describe("buildFormFRow — consistent row shape across both call sites", () => {
  it("maps every input field to its DB column", () => {
    const row = buildFormFRow({
      hospitalId: "h1",
      orderId: "o1",
      patientName: "Jane Doe",
      patientAge: 29,
      patientAddress: "12 MG Road",
      indication: "Routine antenatal scan",
      signedBy: "u1",
      referredBy: "u2",
    });
    expect(row).toEqual({
      hospital_id: "h1",
      order_id: "o1",
      patient_name: "Jane Doe",
      patient_age: 29,
      patient_address: "12 MG Road",
      indication: "Routine antenatal scan",
      signed_by: "u1",
      referred_by: "u2",
    });
  });

  it("defaults an unnamed patient to 'Unknown' rather than an empty string", () => {
    const row = buildFormFRow({ hospitalId: "h1", orderId: "o1", patientName: "", signedBy: "u1" });
    expect(row.patient_name).toBe("Unknown");
  });

  it("nulls out optional fields that weren't supplied, rather than leaving them undefined", () => {
    const row = buildFormFRow({ hospitalId: "h1", orderId: "o1", patientName: "Jane", signedBy: "u1" });
    expect(row.patient_age).toBeNull();
    expect(row.patient_address).toBeNull();
    expect(row.indication).toBeNull();
    expect(row.referred_by).toBeNull();
  });
});

describe("ageFromDob", () => {
  it("computes whole years from a date of birth", () => {
    // Built from the same 365.25-day-year approximation the source uses, rather than
    // calendar setFullYear() — a calendar decade can contain fewer/more than 2.5 leap
    // days depending on which decade it is, which floors to 9 or 10 unpredictably.
    const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
    const tenYearsAgo = new Date(Date.now() - 10 * msPerYear);
    expect(ageFromDob(tenYearsAgo.toISOString())).toBe(10);
  });

  it("returns null for a missing date of birth", () => {
    expect(ageFromDob(null)).toBeNull();
    expect(ageFromDob(undefined)).toBeNull();
  });

  it("returns null for an unparseable date", () => {
    expect(ageFromDob("not-a-date")).toBeNull();
  });
});

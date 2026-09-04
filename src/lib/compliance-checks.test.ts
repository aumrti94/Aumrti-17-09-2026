import { describe, it, expect } from "vitest";
import { validateNDPSDispense, validateGSTLineItems, getDPDPConsentText } from "./compliance-checks";

describe("validateNDPSDispense — Schedule X dual sign-off before dispensing", () => {
  it("rejects dispensing with no second-pharmacist verification", () => {
    const result = validateNDPSDispense({ currentUserId: "u1", patientAddress: "12 MG Road" });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/second pharmacist/i);
  });

  it("rejects the same person verifying their own dispense", () => {
    const result = validateNDPSDispense({
      secondPharmacistId: "u1",
      currentUserId: "u1",
      patientAddress: "12 MG Road",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/different person/i);
  });

  it("rejects a missing or blank patient address", () => {
    expect(
      validateNDPSDispense({ secondPharmacistId: "u2", currentUserId: "u1" }).ok,
    ).toBe(false);
    expect(
      validateNDPSDispense({ secondPharmacistId: "u2", currentUserId: "u1", patientAddress: "   " })
        .ok,
    ).toBe(false);
  });

  it("passes when a different second pharmacist and a real address are both present", () => {
    const result = validateNDPSDispense({
      secondPharmacistId: "u2",
      currentUserId: "u1",
      patientAddress: "12 MG Road",
    });
    expect(result).toEqual({ ok: true });
  });
});

describe("validateGSTLineItems — flags taxable lines missing an HSN code", () => {
  it("flags a taxed line item with no HSN code", () => {
    const missing = validateGSTLineItems([
      { description: "Consultation", gst_percent: 18, hsn_code: null },
    ]);
    expect(missing).toEqual(["Consultation"]);
  });

  it("does not flag a zero-rated (exempt) line item even without an HSN code", () => {
    const missing = validateGSTLineItems([
      { description: "IPD Room Rent", gst_percent: 0, hsn_code: null },
    ]);
    expect(missing).toEqual([]);
  });

  it("does not flag a taxed line item that already carries an HSN code", () => {
    const missing = validateGSTLineItems([
      { description: "Medicine", gst_percent: 12, hsn_code: "3004" },
    ]);
    expect(missing).toEqual([]);
  });

  it("returns every offending description, in order, across a mixed bill", () => {
    const missing = validateGSTLineItems([
      { description: "Consultation", gst_percent: 18, hsn_code: null },
      { description: "IPD Room Rent", gst_percent: 0, hsn_code: null },
      { description: "Pharmacy Item", gst_percent: 12, hsn_code: null },
    ]);
    expect(missing).toEqual(["Consultation", "Pharmacy Item"]);
  });
});

describe("getDPDPConsentText — patient registration consent copy", () => {
  it("names the hospital and cites the DPDP Act", () => {
    const text = getDPDPConsentText("Aumrti General Hospital");
    expect(text).toContain("Aumrti General Hospital");
    expect(text).toContain("Digital Personal Data Protection Act, 2023");
  });
});

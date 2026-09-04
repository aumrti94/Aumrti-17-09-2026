import { describe, it, expect } from "vitest";
import { isHighAlert, isAntibioticByName, HIGH_ALERT_KEYWORDS, ANTIBIOTIC_KEYWORDS } from "./high-alert-meds";

describe("isHighAlert — NABH MOM.8.a high-alert medication detection", () => {
  it("flags a known high-alert drug by name (insulin)", () => {
    expect(isHighAlert("Insulin Glargine")).toBe(true);
  });

  it("flags high-alert drugs across every risk category — anticoagulants, opioids, electrolytes, chemo, vasoactives", () => {
    expect(isHighAlert("Heparin Sodium")).toBe(true);
    expect(isHighAlert("Morphine Sulphate")).toBe(true);
    expect(isHighAlert("Potassium Chloride 15%")).toBe(true);
    expect(isHighAlert("Inj. Methotrexate")).toBe(true);
    expect(isHighAlert("Adrenaline 1:1000")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isHighAlert("INSULIN GLARGINE")).toBe(true);
  });

  it("does not flag an ordinary drug", () => {
    expect(isHighAlert("Paracetamol 500mg")).toBe(false);
  });

  it("trusts an explicit drug-master flag even when the name doesn't match a keyword", () => {
    expect(isHighAlert("Some Proprietary Drug XYZ", true)).toBe(true);
  });

  it("an explicit false flag does not suppress a keyword match — keyword detection still catches it", () => {
    expect(isHighAlert("Insulin Glargine", false)).toBe(true);
  });

  it("every declared keyword actually triggers isHighAlert on its own", () => {
    for (const kw of HIGH_ALERT_KEYWORDS) {
      expect(isHighAlert(`Test Drug Containing ${kw}`)).toBe(true);
    }
  });
});

describe("isAntibioticByName", () => {
  it("flags a known antibiotic by name", () => {
    expect(isAntibioticByName("Amoxicillin 500mg")).toBe(true);
    expect(isAntibioticByName("Inj. Ceftriaxone")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isAntibioticByName("VANCOMYCIN")).toBe(true);
  });

  it("does not flag a non-antibiotic", () => {
    expect(isAntibioticByName("Paracetamol 500mg")).toBe(false);
  });

  it("every declared keyword actually triggers isAntibioticByName on its own", () => {
    for (const kw of ANTIBIOTIC_KEYWORDS) {
      expect(isAntibioticByName(`Test Drug ${kw}`)).toBe(true);
    }
  });
});

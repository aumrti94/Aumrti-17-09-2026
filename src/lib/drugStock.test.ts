import { describe, it, expect } from "vitest";
import { matchDrugName, stripStrength, calcDrugQuantity, FREQ_PER_DAY } from "./drugStock";

const catalogue = [
  { drug_name: "Pantacid", generic_name: "Pantoprazole" },
  { drug_name: "Amoxicillin", generic_name: "Amoxicillin" },
  { drug_name: "Metformin", generic_name: "Metformin HCl" },
  { drug_name: "Atorvastatin", generic_name: "Atorvastatin Calcium" },
  { drug_name: "Paracetamol", generic_name: "Acetaminophen" },
];

describe("stripStrength", () => {
  it("removes strengths so a dictated dose still matches the catalogue name", () => {
    expect(stripStrength("Pantacid 40 mg")).toBe("Pantacid");
    expect(stripStrength("Amoxicillin 500mg")).toBe("Amoxicillin");
    expect(stripStrength("Metformin 1000")).toBe("Metformin");
  });

  it("leaves a plain name untouched", () => {
    expect(stripStrength("Metformin")).toBe("Metformin");
  });

  it("handles empty input", () => {
    expect(stripStrength("")).toBe("");
  });
});

describe("matchDrugName", () => {
  it("matches exactly, ignoring case and punctuation", () => {
    expect(matchDrugName("pantacid", catalogue)?.drug_name).toBe("Pantacid");
    expect(matchDrugName("  Metformin  ", catalogue)?.drug_name).toBe("Metformin");
  });

  it("matches when the dictation carries a strength the catalogue omits", () => {
    // The exact live case: the doctor says "Pantacid 40", the catalogue row is "Pantacid".
    expect(matchDrugName("Pantacid 40", catalogue)?.drug_name).toBe("Pantacid");
    expect(matchDrugName("Amoxicillin 500 mg", catalogue)?.drug_name).toBe("Amoxicillin");
  });

  it("absorbs Indian-English spelling variants", () => {
    expect(matchDrugName("Amoxycillin", catalogue)?.drug_name).toBe("Amoxicillin");
  });

  it("matches on the generic name too", () => {
    expect(matchDrugName("Pantoprazole", catalogue)?.drug_name).toBe("Pantacid");
  });

  it("REFUSES to guess when nothing is close enough", () => {
    // A wrong drug match is far worse than an unmatched one.
    expect(matchDrugName("Rifaximin", catalogue)).toBeNull();
    expect(matchDrugName("Ondansetron", catalogue)).toBeNull();
  });

  it("REFUSES when two catalogue entries are equally plausible", () => {
    // "Metfornin" sits exactly one edit from BOTH entries, so there is no way to tell which
    // drug the doctor meant. Dispensing the wrong one is the failure this guard prevents.
    const ambiguous = [
      { drug_name: "Metformin", generic_name: null },
      { drug_name: "Metfornil", generic_name: null },
    ];
    expect(matchDrugName("Metfornin", ambiguous)).toBeNull();
    // An exact match is never ambiguous, even against a near neighbour.
    expect(matchDrugName("Metformin", ambiguous)?.drug_name).toBe("Metformin");
  });

  it("handles empty input and an empty catalogue", () => {
    expect(matchDrugName("", catalogue)).toBeNull();
    expect(matchDrugName("Pantacid", [])).toBeNull();
  });
});

describe("calcDrugQuantity", () => {
  it("computes dose x frequency/day x days", () => {
    // 1 tablet OD for 30 days = 30, matching the "Qty: 30" the manual picker produces.
    expect(calcDrugQuantity("1", "OD", "30")).toBe("30");
    expect(calcDrugQuantity("1", "BD", "5")).toBe("10");
    expect(calcDrugQuantity("2", "TDS", "3")).toBe("18");
  });

  it("reads the number out of a dose string with units", () => {
    expect(calcDrugQuantity("500 mg", "BD", "1")).toBe("1000");
  });

  it("rounds up, since half a tablet cannot be dispensed", () => {
    expect(calcDrugQuantity("0.5", "OD", "3")).toBe("2");
  });

  it("returns empty when duration is missing or nonsensical", () => {
    // Better no quantity than a fabricated one that gets billed.
    expect(calcDrugQuantity("1", "OD", "")).toBe("");
    expect(calcDrugQuantity("1", "OD", "0")).toBe("");
    expect(calcDrugQuantity("1", "OD", "abc")).toBe("");
  });

  it("defaults an unknown frequency to once daily rather than throwing", () => {
    expect(calcDrugQuantity("1", "WEIRD", "4")).toBe("4");
  });

  it("covers the frequencies the Rx tab offers", () => {
    for (const f of ["OD", "BD", "TDS", "QID", "HS", "SOS", "STAT"]) {
      expect(FREQ_PER_DAY[f]).toBeGreaterThan(0);
    }
  });
});

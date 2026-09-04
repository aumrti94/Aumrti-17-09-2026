import { describe, it, expect } from "vitest";
import {
  isABOCompatible,
  isRhCompatible,
  isFullyCompatible,
  formatBloodGroup,
  componentLabel,
} from "./bloodCompatibility";

// PATIENT SAFETY CRITICAL — this suite exists to make an incompatible transfusion
// impossible to ship silently. Every ABO x Rh combination that matters is covered
// explicitly rather than sampled, given the cost of a false "compatible".

describe("isABOCompatible — RBC ABO compatibility matrix", () => {
  it("O is the universal RBC donor — every recipient group accepts O", () => {
    expect(isABOCompatible("O", "O")).toBe(true);
    expect(isABOCompatible("A", "O")).toBe(true);
    expect(isABOCompatible("B", "O")).toBe(true);
    expect(isABOCompatible("AB", "O")).toBe(true);
  });

  it("AB is the universal RBC recipient — accepts every group", () => {
    expect(isABOCompatible("AB", "A")).toBe(true);
    expect(isABOCompatible("AB", "B")).toBe(true);
    expect(isABOCompatible("AB", "AB")).toBe(true);
    expect(isABOCompatible("AB", "O")).toBe(true);
  });

  it("O can only receive O — the narrowest recipient group", () => {
    expect(isABOCompatible("O", "A")).toBe(false);
    expect(isABOCompatible("O", "B")).toBe(false);
    expect(isABOCompatible("O", "AB")).toBe(false);
  });

  it("rejects A receiving B and B receiving A — the classic fatal mismatch", () => {
    expect(isABOCompatible("A", "B")).toBe(false);
    expect(isABOCompatible("B", "A")).toBe(false);
  });

  it("A and B each accept their own group plus O, nothing else", () => {
    expect(isABOCompatible("A", "A")).toBe(true);
    expect(isABOCompatible("A", "AB")).toBe(false);
    expect(isABOCompatible("B", "B")).toBe(true);
    expect(isABOCompatible("B", "AB")).toBe(false);
  });
});

describe("isRhCompatible — Rh factor compatibility", () => {
  it("Rh-positive patients can receive either Rh factor", () => {
    expect(isRhCompatible("positive", "positive")).toBe(true);
    expect(isRhCompatible("positive", "negative")).toBe(true);
  });

  it("Rh-negative patients can only receive Rh-negative units", () => {
    expect(isRhCompatible("negative", "negative")).toBe(true);
    expect(isRhCompatible("negative", "positive")).toBe(false);
  });
});

describe("isFullyCompatible — combined ABO + Rh gate", () => {
  it("requires both ABO and Rh to pass, not just one", () => {
    // ABO-compatible (O donor) but Rh-incompatible (Rh- patient, Rh+ unit)
    const mismatch = isFullyCompatible("A", "negative", "O", "positive");
    expect(mismatch).toEqual({ compatible: false, aboOk: true, rhOk: false });
  });

  it("passes only when both checks pass", () => {
    const ok = isFullyCompatible("A", "negative", "O", "negative");
    expect(ok).toEqual({ compatible: true, aboOk: true, rhOk: true });
  });

  it("reports both sub-results even when both fail, for a precise reason on screen", () => {
    const bothFail = isFullyCompatible("A", "negative", "B", "positive");
    expect(bothFail).toEqual({ compatible: false, aboOk: false, rhOk: false });
  });
});

describe("formatBloodGroup", () => {
  it("renders positive and negative as + and -", () => {
    expect(formatBloodGroup("A", "positive")).toBe("A+");
    expect(formatBloodGroup("O", "negative")).toBe("O-");
  });
});

describe("componentLabel — blood component display names", () => {
  it("maps known component codes to their display label", () => {
    expect(componentLabel("whole_blood")).toBe("Whole Blood");
    expect(componentLabel("rbc")).toBe("RBC");
    expect(componentLabel("ffp")).toBe("FFP");
    expect(componentLabel("platelets")).toBe("Platelets");
    expect(componentLabel("cryoprecipitate")).toBe("Cryoprecipitate");
  });

  it("falls back to the raw code for an unrecognised component", () => {
    expect(componentLabel("granulocytes")).toBe("granulocytes");
  });
});

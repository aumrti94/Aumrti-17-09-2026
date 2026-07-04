// Lab AI features, Phase 15 — unit tests for the deterministic intrinsic-resistance
// checker. detectResistancePhenotype (AI, advisory-only) is exercised via smoke test.
import { describe, it, expect } from "vitest";
import { checkIntrinsicResistanceConflicts } from "./labAST";

describe("checkIntrinsicResistanceConflicts", () => {
  it("returns nothing for a clean, consistent E. coli panel", () => {
    const result = checkIntrinsicResistanceConflicts("E. coli", {
      Ampicillin: "R",
      Ceftriaxone: "S",
      Meropenem: "S",
    });
    expect(result).toEqual([]);
  });

  it("returns nothing when the organism field is empty", () => {
    const result = checkIntrinsicResistanceConflicts("", { Vancomycin: "S" });
    expect(result).toEqual([]);
  });

  it("flags Enterococcus marked Sensitive to a cephalosporin", () => {
    const result = checkIntrinsicResistanceConflicts("Enterococcus faecalis", { Ceftriaxone: "S" });
    expect(result).toHaveLength(1);
    expect(result[0].drug).toBe("Ceftriaxone");
  });

  it("does not flag Enterococcus marked Resistant to a cephalosporin (expected)", () => {
    const result = checkIntrinsicResistanceConflicts("Enterococcus faecalis", { Ceftriaxone: "R" });
    expect(result).toEqual([]);
  });

  it("flags Klebsiella marked Intermediate to ampicillin", () => {
    const result = checkIntrinsicResistanceConflicts("Klebsiella pneumoniae", { Ampicillin: "I" });
    expect(result).toHaveLength(1);
  });

  it("flags Proteus marked Sensitive to nitrofurantoin", () => {
    const result = checkIntrinsicResistanceConflicts("Proteus mirabilis", { Nitrofurantoin: "S" });
    expect(result).toHaveLength(1);
  });

  it("flags Pseudomonas marked Sensitive to ampicillin", () => {
    const result = checkIntrinsicResistanceConflicts("Pseudomonas aeruginosa", { Ampicillin: "S" });
    expect(result).toHaveLength(1);
  });

  it("flags a Gram-negative rod marked Sensitive to vancomycin", () => {
    const result = checkIntrinsicResistanceConflicts("Escherichia coli", { Vancomycin: "S" });
    expect(result).toHaveLength(1);
    expect(result[0].drug).toBe("Vancomycin");
  });

  it("does not flag Staph aureus (Gram-positive, not in the GNR list) against vancomycin", () => {
    const result = checkIntrinsicResistanceConflicts("Staphylococcus aureus", { Vancomycin: "S" });
    expect(result).toEqual([]);
  });

  it("can return multiple conflicts for one organism", () => {
    const result = checkIntrinsicResistanceConflicts("Pseudomonas aeruginosa", {
      Ampicillin: "S",
      Ceftriaxone: "I",
      Meropenem: "S",
    });
    expect(result).toHaveLength(2);
  });

  it("ignores untested drugs (undefined) and Resistant results", () => {
    const result = checkIntrinsicResistanceConflicts("Klebsiella pneumoniae", {
      Ampicillin: "R",
      Meropenem: undefined,
    });
    expect(result).toEqual([]);
  });
});

/**
 * Phase 1 — patient-safety tier (PHASED_TEST_PLAN.md D10).
 *
 * The plan is explicit: "assert every one of the 64 group×group pairs explicitly, not a
 * sampled subset". An ABO-incompatible transfusion kills faster than any drug interaction
 * in drugSafetyCheck, and this file is 1.5 KB of pure logic — there is no excuse for a
 * sampled matrix here.
 *
 * COMPATIBLE_UNITS below is written out by hand from the transfusion-medicine matrix, NOT
 * derived from the module's own ABO table. Re-deriving RBC_COMPATIBILITY and comparing it to
 * itself would pass against any permutation of that table, including an inverted one.
 */
import { describe, it, expect } from "vitest";
import {
  isABOCompatible,
  isRhCompatible,
  isFullyCompatible,
  formatBloodGroup,
  componentLabel,
} from "@/lib/bloodCompatibility";

type Group = "A" | "B" | "AB" | "O";
type Rh = "positive" | "negative";

const ALL: { label: string; group: Group; rh: Rh }[] = [
  { label: "A+", group: "A", rh: "positive" },
  { label: "A-", group: "A", rh: "negative" },
  { label: "B+", group: "B", rh: "positive" },
  { label: "B-", group: "B", rh: "negative" },
  { label: "AB+", group: "AB", rh: "positive" },
  { label: "AB-", group: "AB", rh: "negative" },
  { label: "O+", group: "O", rh: "positive" },
  { label: "O-", group: "O", rh: "negative" },
];

/** Hand-written from the RBC transfusion matrix. Patient label → every unit they may receive. */
const COMPATIBLE_UNITS: Record<string, string[]> = {
  "A+": ["A+", "A-", "O+", "O-"],
  "A-": ["A-", "O-"],
  "B+": ["B+", "B-", "O+", "O-"],
  "B-": ["B-", "O-"],
  "AB+": ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
  "AB-": ["A-", "B-", "AB-", "O-"],
  "O+": ["O+", "O-"],
  "O-": ["O-"],
};

describe("isFullyCompatible — all 64 patient × unit pairs", () => {
  for (const patient of ALL) {
    for (const unit of ALL) {
      const expected = COMPATIBLE_UNITS[patient.label].includes(unit.label);
      const verb = expected ? "accepts" : "REJECTS";
      it(`patient ${patient.label} ${verb} a ${unit.label} unit`, () => {
        const r = isFullyCompatible(patient.group, patient.rh, unit.group, unit.rh);
        expect(r.compatible).toBe(expected);
      });
    }
  }

  it("counts exactly 27 compatible pairs out of 64", () => {
    // A whole-matrix invariant: an off-by-one in any single row changes this number, so it
    // catches a partial edit that the per-pair cases above would only fail one of.
    const compatible = ALL.flatMap((p) =>
      ALL.filter((u) => isFullyCompatible(p.group, p.rh, u.group, u.rh).compatible),
    );
    expect(compatible).toHaveLength(27);
  });
});

describe("universal donor and recipient", () => {
  it("O- is accepted by every one of the eight patient types", () => {
    const accepted = ALL.filter((p) => isFullyCompatible(p.group, p.rh, "O", "negative").compatible);
    expect(accepted).toHaveLength(8);
  });

  it("AB+ accepts every one of the eight unit types", () => {
    const accepted = ALL.filter((u) => isFullyCompatible("AB", "positive", u.group, u.rh).compatible);
    expect(accepted).toHaveLength(8);
  });

  it("O- patients accept nothing but O-", () => {
    const accepted = ALL.filter((u) => isFullyCompatible("O", "negative", u.group, u.rh).compatible);
    expect(accepted.map((u) => u.label)).toEqual(["O-"]);
  });
});

describe("isABOCompatible", () => {
  const aboMatrix: Record<Group, Group[]> = {
    O: ["O"],
    A: ["A", "O"],
    B: ["B", "O"],
    AB: ["A", "B", "AB", "O"],
  };

  for (const patient of ["A", "B", "AB", "O"] as Group[]) {
    for (const unit of ["A", "B", "AB", "O"] as Group[]) {
      const expected = aboMatrix[patient].includes(unit);
      it(`${patient} patient ${expected ? "accepts" : "REJECTS"} ${unit} unit`, () => {
        expect(isABOCompatible(patient, unit)).toBe(expected);
      });
    }
  }

  it("rejects an unrecognised patient group rather than defaulting to compatible", () => {
    // The `?? false` fork. A group that is not in the table — a typo, a new field value, a
    // null that slipped through typing — must fail closed. Defaulting to true here is the
    // shape of defect that ends a hospital.
    expect(isABOCompatible("Z" as Group, "O")).toBe(false);
    expect(isABOCompatible(null as unknown as Group, "O")).toBe(false);
    expect(isABOCompatible(undefined as unknown as Group, "O")).toBe(false);
  });

  it("rejects an unrecognised unit group", () => {
    expect(isABOCompatible("AB", "Z" as Group)).toBe(false);
  });
});

describe("isRhCompatible", () => {
  it("Rh-positive patients accept both Rh-positive and Rh-negative units", () => {
    expect(isRhCompatible("positive", "positive")).toBe(true);
    expect(isRhCompatible("positive", "negative")).toBe(true);
  });

  it("Rh-negative patients accept ONLY Rh-negative units", () => {
    expect(isRhCompatible("negative", "negative")).toBe(true);
    expect(isRhCompatible("negative", "positive")).toBe(false);
  });

  it("treats an unrecognised patient Rh as negative — the safe direction", () => {
    // Not 'positive', so it falls to the strict branch: only a negative unit passes.
    expect(isRhCompatible("unknown" as Rh, "positive")).toBe(false);
    expect(isRhCompatible("unknown" as Rh, "negative")).toBe(true);
  });
});

describe("isFullyCompatible reports WHICH check failed", () => {
  // The cross-match screen shows the operator why a unit was refused. A collapsed boolean
  // would tell a technician "incompatible" without saying whether it is the ABO group
  // (never overridable) or the Rh (overridable by a haematologist in an emergency).
  it("ABO failure alone", () => {
    expect(isFullyCompatible("O", "positive", "A", "positive")).toEqual({
      compatible: false,
      aboOk: false,
      rhOk: true,
    });
  });

  it("Rh failure alone", () => {
    expect(isFullyCompatible("A", "negative", "O", "positive")).toEqual({
      compatible: false,
      aboOk: true,
      rhOk: false,
    });
  });

  it("both checks failing", () => {
    expect(isFullyCompatible("O", "negative", "AB", "positive")).toEqual({
      compatible: false,
      aboOk: false,
      rhOk: false,
    });
  });

  it("both checks passing", () => {
    expect(isFullyCompatible("AB", "positive", "O", "negative")).toEqual({
      compatible: true,
      aboOk: true,
      rhOk: true,
    });
  });
});

describe("formatBloodGroup", () => {
  it("renders positive as + and negative as -", () => {
    expect(formatBloodGroup("A", "positive")).toBe("A+");
    expect(formatBloodGroup("O", "negative")).toBe("O-");
    expect(formatBloodGroup("AB", "positive")).toBe("AB+");
  });

  it("renders anything that is not exactly 'positive' as negative", () => {
    // This is the label printed on the bag (bloodBagLabel.ts) and shown at the bedside.
    // A missing rh must never render as '+': labelling an Rh-negative unit positive is how
    // it reaches an Rh-negative patient.
    expect(formatBloodGroup("A", "")).toBe("A-");
    expect(formatBloodGroup("A", "Positive")).toBe("A-");
    expect(formatBloodGroup("A", null as unknown as string)).toBe("A-");
  });
});

describe("componentLabel", () => {
  it("maps every known component to its display name", () => {
    expect(componentLabel("whole_blood")).toBe("Whole Blood");
    expect(componentLabel("rbc")).toBe("RBC");
    expect(componentLabel("ffp")).toBe("FFP");
    expect(componentLabel("platelets")).toBe("Platelets");
    expect(componentLabel("cryoprecipitate")).toBe("Cryoprecipitate");
  });

  it("passes an unknown component through unchanged rather than blanking it", () => {
    expect(componentLabel("granulocytes")).toBe("granulocytes");
    expect(componentLabel("")).toBe("");
  });
});

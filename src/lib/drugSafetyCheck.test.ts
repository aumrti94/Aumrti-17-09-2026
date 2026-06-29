import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression suite for the drug-safety guardrail (checkDrugSafety).
 *
 * This is the layer between a duplicated/contraindicated prescription and a
 * patient, so the LOCAL decision logic — dosage-suffix normalisation, duplicate
 * detection, direct allergy contraindication, interaction matching, and worst-
 * severity ranking/sorting — is pinned here with explicit positive, negative and
 * edge cases. The DrugBank API and Supabase reads are mocked so the test proves
 * the logic deterministically and never touches a network or real PHI.
 *
 * Authored by @naveen (SDET) per the Firm's Day-1 de-risking recommendation.
 * Clinical-correctness gate: @priya. PHI/mock-data gate: @ananya (synthetic only).
 */

// ── Supabase mock (vi.hoisted so the factory runs before module resolution) ────
const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mockFrom },
}));

// ── DrugBank DDI mock — off by default (only called when a hospitalId is given) ─
const { mockDDI } = vi.hoisted(() => ({ mockDDI: vi.fn() }));
vi.mock("@/lib/drugbankAPI", () => ({ checkDrugBankDDI: mockDDI }));

import { checkDrugSafety } from "./drugSafetyCheck";

// Test-controlled DB rows (reset per test)
let interactionsData: unknown[] = [];
let crossReactData: unknown[] = [];

beforeEach(() => {
  interactionsData = [];
  crossReactData = [];
  mockDDI.mockResolvedValue([]);
  mockFrom.mockImplementation((table: string) => ({
    select: () => {
      if (table === "drug_interactions") {
        // SUT does .select("*").or(...) then awaits
        return { or: () => Promise.resolve({ data: interactionsData }) };
      }
      // drug_allergy_cross_reactivity: SUT awaits .select("*") directly
      return Promise.resolve({ data: crossReactData });
    },
  }));
});

describe("checkDrugSafety — clean / negative cases", () => {
  it("empty new drug returns no issues without querying", async () => {
    const r = await checkDrugSafety("", ["Aspirin"], ["Penicillin"]);
    expect(r.hasIssues).toBe(false);
    expect(r.worstSeverity).toBe("none");
  });

  it("novel drug, no current meds, no allergies → no issues", async () => {
    const r = await checkDrugSafety("Amoxicillin 500mg", [], []);
    expect(r.hasIssues).toBe(false);
    expect(r.duplicates).toEqual([]);
    expect(r.interactions).toEqual([]);
    expect(r.allergyConflicts).toEqual([]);
    expect(r.worstSeverity).toBe("none");
  });
});

describe("checkDrugSafety — duplicate detection (dosage-suffix aware)", () => {
  it("flags an exact duplicate of a current medication", async () => {
    const r = await checkDrugSafety("Paracetamol", ["Paracetamol"], []);
    expect(r.duplicates).toContain("Paracetamol");
    expect(r.hasIssues).toBe(true);
  });

  it("strips dosage so 'Paracetamol 500mg' duplicates 'Paracetamol 650 mg'", async () => {
    const r = await checkDrugSafety("Paracetamol 500mg", ["Paracetamol 650 mg"], []);
    expect(r.duplicates).toContain("Paracetamol 650 mg");
    expect(r.hasIssues).toBe(true);
  });

  it("does NOT flag two unrelated drugs as duplicates", async () => {
    const r = await checkDrugSafety("Metformin", ["Amlodipine"], []);
    expect(r.duplicates).toEqual([]);
  });
});

describe("checkDrugSafety — direct allergy contraindication", () => {
  it("contraindicates a drug the patient is directly allergic to", async () => {
    const r = await checkDrugSafety("Penicillin 500mg", [], ["Penicillin"]);
    expect(r.allergyConflicts).toHaveLength(1);
    expect(r.allergyConflicts[0]).toMatchObject({ type: "direct", severity: "contraindicated" });
    expect(r.hasIssues).toBe(true);
    expect(r.worstSeverity).toBe("contraindicated");
  });

  it("does not contraindicate an unrelated allergy", async () => {
    const r = await checkDrugSafety("Paracetamol", [], ["Sulfa"]);
    expect(r.allergyConflicts).toEqual([]);
    expect(r.worstSeverity).toBe("none");
  });
});

describe("checkDrugSafety — interaction matching & severity ranking", () => {
  it("detects a major interaction from the local DB (Aspirin + Warfarin)", async () => {
    interactionsData = [
      { id: "1", drug_a: "warfarin", drug_b: "aspirin", severity: "major", mechanism: null, clinical_effect: null, recommendation: null },
    ];
    const r = await checkDrugSafety("Aspirin", ["Warfarin"], []);
    expect(r.interactions).toHaveLength(1);
    expect(r.hasIssues).toBe(true);
    expect(r.worstSeverity).toBe("major");
  });

  it("sorts contraindicated interactions ahead of minor ones", async () => {
    interactionsData = [
      { id: "1", drug_a: "drugx", drug_b: "minordrug", severity: "minor", mechanism: null, clinical_effect: null, recommendation: null },
      { id: "2", drug_a: "drugx", drug_b: "baddrug", severity: "contraindicated", mechanism: null, clinical_effect: null, recommendation: null },
    ];
    // newDrug 'drugx' interacts with both current meds
    const r = await checkDrugSafety("DrugX", ["MinorDrug", "BadDrug"], []);
    expect(r.interactions.length).toBeGreaterThanOrEqual(2);
    expect(r.interactions[0].severity).toBe("contraindicated");
    expect(r.worstSeverity).toBe("contraindicated");
  });

  it("no interactions found when current meds do not match the DB pairs", async () => {
    interactionsData = [
      { id: "1", drug_a: "warfarin", drug_b: "aspirin", severity: "major", mechanism: null, clinical_effect: null, recommendation: null },
    ];
    const r = await checkDrugSafety("Paracetamol", ["Metformin"], []);
    expect(r.interactions).toEqual([]);
    expect(r.hasIssues).toBe(false);
  });
});

describe("checkDrugSafety — cross-reactivity allergy", () => {
  it("flags a cross-reactive drug (cephalosporin in a penicillin-allergic patient)", async () => {
    crossReactData = [
      { allergen: "penicillin", cross_reacts: ["cephalexin", "cefazolin"], risk_level: "major" },
    ];
    const r = await checkDrugSafety("Cephalexin", [], ["Penicillin"]);
    const cross = r.allergyConflicts.find((c) => c.type === "cross_reactivity");
    expect(cross).toBeDefined();
    expect(cross?.severity).toBe("major");
    expect(r.hasIssues).toBe(true);
  });
});

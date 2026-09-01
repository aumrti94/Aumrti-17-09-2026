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
/** The hospital formulary: brand → generic. Drives the brand-resolution tests below. */
let drugMasterData: { drug_name: string; generic_name: string | null }[] = [];

beforeEach(() => {
  interactionsData = [];
  crossReactData = [];
  drugMasterData = [];
  mockDDI.mockResolvedValue([]);
  mockFrom.mockImplementation((table: string) => ({
    select: () => {
      if (table === "drug_interactions") {
        // SUT does .select("*").or(...) then awaits
        return { or: () => Promise.resolve({ data: interactionsData }) };
      }
      if (table === "drug_master") {
        // SUT does .select(...)[.eq(...)].in("drug_name", names).limit(n)
        //     and .select(...)[.eq(...)].ilike("drug_name", name).limit(1)
        const builder = {
          eq: () => builder,
          in: (_col: string, names: string[]) => ({
            limit: () =>
              Promise.resolve({
                data: drugMasterData.filter((d) => names.includes(d.drug_name)),
              }),
          }),
          ilike: (_col: string, name: string) => ({
            limit: () =>
              Promise.resolve({
                data: drugMasterData.filter(
                  (d) => d.drug_name.toLowerCase() === String(name).toLowerCase()
                ),
              }),
          }),
        };
        return builder;
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

/**
 * BUG-P4-001 regression suite — brand names must not defeat the allergy check.
 *
 * The reference tables are keyed on GENERICS; Indian doctors prescribe by BRAND. Before the
 * fix, "Amoxicillin" was correctly contraindicated for a penicillin-allergic patient while
 * "Mox 500" — the same molecule under its Indian brand name — was added silently, because
 * normalize() strips only the strength and leaves "mox".
 *
 * Locked by TC-P4F-022 / TC-P4F-023 in the Phase 4 catalogue. Do not weaken these.
 */
describe("checkDrugSafety — brand → generic resolution (BUG-P4-001)", () => {
  const PENICILLIN_CROSS = [
    {
      allergen: "penicillin",
      cross_reacts: ["amoxicillin", "ampicillin", "co-amoxiclav", "clavulanate"],
      risk_level: "contraindicated",
    },
  ];

  it("blocks the GENERIC name in a penicillin-allergic patient (unchanged behaviour)", async () => {
    crossReactData = PENICILLIN_CROSS;
    const r = await checkDrugSafety("Amoxicillin", [], ["Penicillin"]);
    expect(r.allergyConflicts.some((c) => c.type === "cross_reactivity")).toBe(true);
    expect(r.worstSeverity).toBe("contraindicated");
  });

  it("blocks the BRAND name once it resolves to the same generic", async () => {
    crossReactData = PENICILLIN_CROSS;
    drugMasterData = [{ drug_name: "Mox 500", generic_name: "Amoxicillin" }];
    const r = await checkDrugSafety("Mox 500", [], ["Penicillin"]);
    expect(
      r.allergyConflicts.some((c) => c.type === "cross_reactivity"),
      "Mox 500 IS amoxicillin — a penicillin-allergic patient must not receive it"
    ).toBe(true);
    expect(r.hasIssues).toBe(true);
  });

  it("blocks a COMBINATION brand when only one constituent is cross-reactive", async () => {
    crossReactData = PENICILLIN_CROSS;
    drugMasterData = [
      { drug_name: "Augmentin 625", generic_name: "Amoxicillin + Clavulanate" },
    ];
    const r = await checkDrugSafety("Augmentin 625", [], ["Penicillin"]);
    expect(r.allergyConflicts.some((c) => c.type === "cross_reactivity")).toBe(true);
  });

  it("blocks a brand whose generic IS the allergen, as a direct conflict", async () => {
    drugMasterData = [{ drug_name: "Mox 500", generic_name: "Amoxicillin" }];
    const r = await checkDrugSafety("Mox 500", [], ["Amoxicillin"]);
    expect(r.allergyConflicts.some((c) => c.type === "direct")).toBe(true);
    expect(r.worstSeverity).toBe("contraindicated");
  });

  it("still does NOT flag an unrelated brand — the fix must not create false positives", async () => {
    crossReactData = PENICILLIN_CROSS;
    drugMasterData = [
      { drug_name: "Zifi 200", generic_name: "Cefixime" },
      { drug_name: "Mox 500", generic_name: "Amoxicillin" },
    ];
    const r = await checkDrugSafety("Zifi 200", [], ["Penicillin"]);
    expect(r.allergyConflicts).toEqual([]);
    expect(r.hasIssues).toBe(false);
  });

  it("resolves a brand typed in a different case", async () => {
    crossReactData = PENICILLIN_CROSS;
    drugMasterData = [{ drug_name: "Mox 500", generic_name: "Amoxicillin" }];
    const r = await checkDrugSafety("mox 500", [], ["Penicillin"]);
    expect(r.allergyConflicts.some((c) => c.type === "cross_reactivity")).toBe(true);
  });

  it("falls back to the typed name when the drug is not in the formulary", async () => {
    crossReactData = PENICILLIN_CROSS;
    drugMasterData = [];
    const r = await checkDrugSafety("Amoxicillin", [], ["Penicillin"]);
    expect(
      r.allergyConflicts.some((c) => c.type === "cross_reactivity"),
      "an unlisted drug must still be matched on what the prescriber actually typed"
    ).toBe(true);
  });

  it("catches two brands of the same molecule as a duplicate", async () => {
    drugMasterData = [
      { drug_name: "Dolo 650", generic_name: "Paracetamol" },
      { drug_name: "Crocin Syrup", generic_name: "Paracetamol" },
    ];
    const r = await checkDrugSafety("Dolo 650", ["Crocin Syrup"], []);
    expect(
      r.duplicates,
      "both are paracetamol — prescribing them together is a silent overdose"
    ).toContain("Crocin Syrup");
  });

  it("matches an interaction recorded against generics when both drugs are brands", async () => {
    drugMasterData = [
      { drug_name: "Telma 40", generic_name: "Telmisartan" },
      { drug_name: "Lasix 40", generic_name: "Furosemide" },
    ];
    interactionsData = [
      {
        id: "1", drug_a: "telmisartan", drug_b: "furosemide", severity: "moderate",
        mechanism: null, clinical_effect: "Additive hypotension", recommendation: null,
      },
    ];
    const r = await checkDrugSafety("Lasix 40", ["Telma 40"], []);
    expect(r.interactions).toHaveLength(1);
    expect(r.worstSeverity).toBe("moderate");
  });

  it("survives a formulary lookup failure without blocking prescribing", async () => {
    crossReactData = PENICILLIN_CROSS;
    mockFrom.mockImplementation((table: string) => ({
      select: () => {
        if (table === "drug_master") throw new Error("formulary unavailable");
        if (table === "drug_interactions") return { or: () => Promise.resolve({ data: [] }) };
        return Promise.resolve({ data: crossReactData });
      },
    }));
    const r = await checkDrugSafety("Amoxicillin", [], ["Penicillin"]);
    expect(r.allergyConflicts.some((c) => c.type === "cross_reactivity")).toBe(true);
  });
});

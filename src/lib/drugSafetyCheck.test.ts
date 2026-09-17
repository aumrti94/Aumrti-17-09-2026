/**
 * Phase 1 — patient-safety tier (PHASED_TEST_PLAN.md §8, Phase 1).
 *
 * `checkDrugSafety` is NOT a pure function — vitest-testing warns about exactly this. It
 * queries `drug_master`, `drug_interactions` and `drug_allergy_cross_reactivity`, and calls
 * DrugBank. So the transport is mocked and the DECISION is never mocked: every assertion below
 * runs the real matching, aliasing and severity logic against seeded rows.
 *
 * Per clinical-compliance: the check itself is never mocked or skipped. A mocked
 * `checkDrugSafety` returning `hasIssues: true` proves a modal renders and nothing about
 * whether the drug is safe.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface QueryCall {
  method: string;
  args: unknown[];
}
interface QueryResult {
  data: unknown[] | null;
  error: unknown;
}

const mocks = vi.hoisted(() => {
  const resolvers: Record<string, (calls: { method: string; args: unknown[] }[]) => unknown> = {};
  const tablesQueried: string[] = [];

  const makeBuilder = (table: string) => {
    const calls: { method: string; args: unknown[] }[] = [];
    const b: Record<string, unknown> = {};
    // Every builder method the module chains. All return `this`; the object is thenable, so
    // `await supabase.from(t).select("*")` resolves without an explicit terminal call —
    // which is how drug_allergy_cross_reactivity is read.
    for (const m of ["select", "eq", "in", "limit", "ilike", "or"]) {
      b[m] = (...args: unknown[]) => {
        calls.push({ method: m, args });
        return b;
      };
    }
    b.then = (ok: unknown, err: unknown) =>
      Promise.resolve()
        .then(() => (resolvers[table] ? resolvers[table](calls) : { data: [], error: null }))
        .then(ok as never, err as never);
    return b;
  };

  return {
    resolvers,
    tablesQueried,
    supabase: {
      from: (table: string) => {
        tablesQueried.push(table);
        return makeBuilder(table);
      },
    },
    checkDrugBankDDI: vi.fn(),
  };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: mocks.supabase }));
vi.mock("@/lib/drugbankAPI", () => ({ checkDrugBankDDI: mocks.checkDrugBankDDI }));

import { checkDrugSafety, type DrugInteraction } from "@/lib/drugSafetyCheck";

const HOSPITAL_A = "11111111-1111-4111-8111-111111111111";

interface FormularyRow {
  drug_name: string;
  generic_name: string | null;
}

let ilikeLookups = 0;

/** Seed the hospital formulary. Serves both the exact `.in()` pass and the `.ilike()` pass. */
function seedFormulary(rows: FormularyRow[]) {
  mocks.resolvers.drug_master = (calls: QueryCall[]): QueryResult => {
    const exact = calls.find((c) => c.method === "in");
    if (exact) {
      const names = exact.args[1] as string[];
      return { data: rows.filter((r) => names.includes(r.drug_name)), error: null };
    }
    const fuzzy = calls.find((c) => c.method === "ilike");
    if (fuzzy) {
      ilikeLookups += 1;
      const term = String(fuzzy.args[1]).toLowerCase();
      return { data: rows.filter((r) => r.drug_name.toLowerCase() === term), error: null };
    }
    return { data: [], error: null };
  };
}

function seedInteractions(rows: Partial<DrugInteraction>[]) {
  mocks.resolvers.drug_interactions = (): QueryResult => ({ data: rows, error: null });
}

function seedCrossReactivity(
  rows: { allergen: string; cross_reacts: string[]; risk_level?: string }[],
) {
  mocks.resolvers.drug_allergy_cross_reactivity = (): QueryResult => ({ data: rows, error: null });
}

beforeEach(() => {
  for (const key of Object.keys(mocks.resolvers)) delete mocks.resolvers[key];
  mocks.tablesQueried.length = 0;
  mocks.checkDrugBankDDI.mockReset();
  mocks.checkDrugBankDDI.mockResolvedValue(null);
  ilikeLookups = 0;
  seedFormulary([]);
  seedInteractions([]);
  seedCrossReactivity([]);
});

// ── The clean case ────────────────────────────────────────────────────────────

describe("a drug with nothing against it", () => {
  it("reports no issues and severity 'none'", async () => {
    const r = await checkDrugSafety("Aspirin", [], [], HOSPITAL_A);
    expect(r.hasIssues).toBe(false);
    expect(r.worstSeverity).toBe("none");
    expect(r.interactions).toEqual([]);
    expect(r.allergyConflicts).toEqual([]);
    expect(r.duplicates).toEqual([]);
  });

  it("does not query interactions when there is nothing to interact with", async () => {
    await checkDrugSafety("Aspirin", [], [], HOSPITAL_A);
    expect(mocks.tablesQueried).not.toContain("drug_interactions");
  });

  it("does not query cross-reactivity when the patient has no recorded allergies", async () => {
    await checkDrugSafety("Aspirin", ["Warfarin"], [], HOSPITAL_A);
    expect(mocks.tablesQueried).not.toContain("drug_allergy_cross_reactivity");
  });
});

describe("input the check refuses to act on", () => {
  it("returns clean and queries nothing for an empty drug name", async () => {
    const r = await checkDrugSafety("", ["Warfarin"], ["Penicillin"], HOSPITAL_A);
    expect(r.hasIssues).toBe(false);
    expect(mocks.tablesQueried).toEqual([]);
  });

  it("returns clean for a name that normalises away to nothing", async () => {
    // normalize() strips a strength suffix. "500mg" is a dose, not a drug — after stripping
    // there is no substance left to check, and matching on "" would match everything.
    const r = await checkDrugSafety("500mg", ["Warfarin"], [], HOSPITAL_A);
    expect(r.hasIssues).toBe(false);
    expect(mocks.tablesQueried).toEqual([]);
  });

  it("strips the strength from a name before matching", async () => {
    seedInteractions([{ id: "x1", drug_a: "warfarin", drug_b: "aspirin", severity: "major" }]);
    const r = await checkDrugSafety("Aspirin 75 mg", ["Warfarin 5 mg"], [], HOSPITAL_A);
    expect(r.hasIssues).toBe(true);
    expect(r.interactions).toHaveLength(1);
  });
});

// ── CHECK 1: duplicate therapy ────────────────────────────────────────────────

describe("duplicate therapy", () => {
  it("flags the same drug prescribed twice", async () => {
    const r = await checkDrugSafety("Paracetamol", ["Paracetamol"], [], HOSPITAL_A);
    expect(r.duplicates).toEqual(["Paracetamol"]);
    expect(r.hasIssues).toBe(true);
  });

  it("flags the same molecule under two different brands", async () => {
    // The stated reason this resolution exists: "Dolo 650" and "Crocin" are both
    // paracetamol, and prescribing both is a real overdose — of a drug whose ceiling is
    // hepatotoxicity, not a warning label.
    seedFormulary([
      { drug_name: "Dolo 650", generic_name: "Paracetamol" },
      { drug_name: "Crocin", generic_name: "Paracetamol" },
    ]);
    const r = await checkDrugSafety("Dolo 650", ["Crocin"], [], HOSPITAL_A);
    expect(r.duplicates).toEqual(["Crocin"]);
    expect(r.hasIssues).toBe(true);
  });

  it("flags a combination brand against one of its own constituents", async () => {
    // Indian formularies write combinations as "Amoxicillin + Clavulanate". Each constituent
    // is split out, or a combination slips past a duplicate of just one component.
    seedFormulary([
      { drug_name: "Augmentin 625", generic_name: "Amoxicillin + Clavulanate" },
      { drug_name: "Mox 500", generic_name: "Amoxicillin" },
    ]);
    const r = await checkDrugSafety("Augmentin 625", ["Mox 500"], [], HOSPITAL_A);
    expect(r.duplicates).toEqual(["Mox 500"]);
  });

  it("splits combinations on +, /, comma, ampersand, 'and' and 'with'", async () => {
    seedFormulary([
      { drug_name: "Combo", generic_name: "Paracetamol / Caffeine" },
      { drug_name: "Plain", generic_name: "Caffeine" },
    ]);
    const r = await checkDrugSafety("Combo", ["Plain"], [], HOSPITAL_A);
    expect(r.duplicates).toEqual(["Plain"]);
  });

  it("does not substring-match names shorter than 4 characters", async () => {
    // The guard against "k" matching "aspirin". Asserted so nobody lowers MIN_SUBSTRING_LEN
    // to catch one more case and floods every prescription with nonsense duplicates.
    const r = await checkDrugSafety("Mox", ["Amoxicillin"], [], HOSPITAL_A);
    expect(r.duplicates).toEqual([]);
    expect(r.hasIssues).toBe(false);
  });

  it("still matches a short name exactly", async () => {
    const r = await checkDrugSafety("Mox", ["Mox"], [], HOSPITAL_A);
    expect(r.duplicates).toEqual(["Mox"]);
  });

  it("lists every duplicate, not just the first", async () => {
    seedFormulary([
      { drug_name: "Dolo 650", generic_name: "Paracetamol" },
      { drug_name: "Crocin", generic_name: "Paracetamol" },
      { drug_name: "Calpol", generic_name: "Paracetamol" },
    ]);
    const r = await checkDrugSafety("Dolo 650", ["Crocin", "Calpol"], [], HOSPITAL_A);
    expect(r.duplicates).toEqual(["Crocin", "Calpol"]);
  });
});

// ── CHECK 2: drug-drug interactions ───────────────────────────────────────────

describe("drug-drug interactions", () => {
  it("flags a known interacting pair", async () => {
    seedInteractions([
      { id: "i1", drug_a: "warfarin", drug_b: "aspirin", severity: "major", mechanism: null },
    ]);
    const r = await checkDrugSafety("Aspirin", ["Warfarin"], [], HOSPITAL_A);
    expect(r.hasIssues).toBe(true);
    expect(r.interactions).toHaveLength(1);
    expect(r.worstSeverity).toBe("major");
  });

  it("matches the pair in either column order", async () => {
    seedInteractions([{ id: "i1", drug_a: "aspirin", drug_b: "warfarin", severity: "major" }]);
    const r = await checkDrugSafety("Aspirin", ["Warfarin"], [], HOSPITAL_A);
    expect(r.interactions).toHaveLength(1);
  });

  it("does not flag a row whose other half is not on the patient's list", async () => {
    seedInteractions([{ id: "i1", drug_a: "warfarin", drug_b: "aspirin", severity: "major" }]);
    const r = await checkDrugSafety("Aspirin", ["Metformin"], [], HOSPITAL_A);
    expect(r.interactions).toEqual([]);
    expect(r.hasIssues).toBe(false);
  });

  it("resolves a brand to its generic before matching the interaction table", async () => {
    // The interaction tables are keyed on GENERICS; Indian doctors prescribe by BRAND. This
    // is the fork that used to let every brand-name prescription through.
    seedFormulary([
      { drug_name: "Ecosprin 75", generic_name: "Aspirin" },
      { drug_name: "Warf 5", generic_name: "Warfarin" },
    ]);
    seedInteractions([{ id: "i1", drug_a: "warfarin", drug_b: "aspirin", severity: "major" }]);
    const r = await checkDrugSafety("Ecosprin 75", ["Warf 5"], [], HOSPITAL_A);
    expect(r.hasIssues).toBe(true);
    expect(r.interactions).toHaveLength(1);
  });

  it("sorts contraindicated interactions ahead of lesser ones", async () => {
    // The first row is what the prescriber sees before scrolling.
    seedInteractions([
      { id: "minor", drug_a: "aspirin", drug_b: "metformin", severity: "minor" },
      { id: "kill", drug_a: "aspirin", drug_b: "warfarin", severity: "contraindicated" },
      { id: "mod", drug_a: "aspirin", drug_b: "ibuprofen", severity: "moderate" },
    ]);
    const r = await checkDrugSafety("Aspirin", ["Warfarin", "Metformin", "Ibuprofen"], [], HOSPITAL_A);
    expect(r.interactions.map((i) => i.id)).toEqual(["kill", "mod", "minor"]);
    expect(r.worstSeverity).toBe("contraindicated");
  });

  it.each([
    ["contraindicated", "contraindicated"],
    ["major", "major"],
    ["moderate", "moderate"],
    ["minor", "minor"],
  ])("ranks severity '%s' as worstSeverity '%s'", async (severity, expected) => {
    seedInteractions([{ id: "i1", drug_a: "aspirin", drug_b: "warfarin", severity }]);
    const r = await checkDrugSafety("Aspirin", ["Warfarin"], [], HOSPITAL_A);
    expect(r.worstSeverity).toBe(expected);
  });

  it("reports the worst severity across several interactions, not the last one", async () => {
    seedInteractions([
      { id: "a", drug_a: "aspirin", drug_b: "warfarin", severity: "contraindicated" },
      { id: "b", drug_a: "aspirin", drug_b: "metformin", severity: "minor" },
    ]);
    const r = await checkDrugSafety("Aspirin", ["Warfarin", "Metformin"], [], HOSPITAL_A);
    expect(r.worstSeverity).toBe("contraindicated");
  });
});

describe("DrugBank as the first-choice interaction source", () => {
  const dbRow = {
    id: "db-1",
    drug_a: "Aspirin",
    drug_b: "Warfarin",
    severity: "contraindicated",
    mechanism: "Additive anticoagulation",
    clinical_effect: "Major haemorrhage",
    recommendation: "Avoid",
  };

  it("includes a DrugBank hit", async () => {
    mocks.checkDrugBankDDI.mockResolvedValue([dbRow]);
    const r = await checkDrugSafety("Aspirin", ["Warfarin"], [], HOSPITAL_A);
    expect(r.hasIssues).toBe(true);
    expect(r.interactions).toHaveLength(1);
    expect(r.worstSeverity).toBe("contraindicated");
  });

  it("is not consulted without a hospital id", async () => {
    // DrugBank access is per-tenant (licence keys live on the hospital).
    await checkDrugSafety("Aspirin", ["Warfarin"], [], "");
    expect(mocks.checkDrugBankDDI).not.toHaveBeenCalled();
  });

  it("is consulted for at most the first three current drugs", async () => {
    await checkDrugSafety("Aspirin", ["A", "B", "C", "D", "E"], [], HOSPITAL_A);
    expect(mocks.checkDrugBankDDI).toHaveBeenCalledTimes(3);
  });

  it("still consults the local table when DrugBank returns nothing", async () => {
    mocks.checkDrugBankDDI.mockResolvedValue(null);
    seedInteractions([{ id: "i1", drug_a: "warfarin", drug_b: "aspirin", severity: "major" }]);
    const r = await checkDrugSafety("Aspirin", ["Warfarin"], [], HOSPITAL_A);
    expect(r.interactions).toHaveLength(1);
  });

  it("does not report the same pair twice when both sources agree exactly", async () => {
    mocks.checkDrugBankDDI.mockResolvedValue([{ ...dbRow, drug_a: "aspirin", drug_b: "warfarin" }]);
    seedInteractions([{ id: "i1", drug_a: "aspirin", drug_b: "warfarin", severity: "major" }]);
    const r = await checkDrugSafety("Aspirin", ["Warfarin"], [], HOSPITAL_A);
    expect(r.interactions).toHaveLength(1);
  });

  // KNOWN-BUG-107, fixed: the de-duplication compared drug_a/drug_b with `===`, so DrugBank's
  // "Aspirin" and the local table's "aspirin" were treated as different pairs and the same
  // interaction was shown twice — alert fatigue on the prescribing screen. Both sides are now
  // run through the same `normalize()` used elsewhere in this file before comparing.
  it("de-duplicates across sources regardless of case (KNOWN-BUG-107, fixed)", async () => {
    mocks.checkDrugBankDDI.mockResolvedValue([dbRow]); // "Aspirin" / "Warfarin"
    seedInteractions([{ id: "i1", drug_a: "aspirin", drug_b: "warfarin", severity: "major" }]);
    const r = await checkDrugSafety("Aspirin", ["Warfarin"], [], HOSPITAL_A);
    expect(r.interactions).toHaveLength(1);
  });

  it("keeps a local-DB pair distinct from a genuinely different DrugBank pair — the dedup must say no as readily as it says yes", async () => {
    // DrugBank is asked about each current drug in turn; only Warfarin gets a hit, so the
    // Metformin pair below can only come from the local table, exercising the real "these two
    // sources found genuinely different pairs, keep both" path rather than a vacuous one.
    mocks.checkDrugBankDDI.mockImplementation((_new: string, existing: string) =>
      Promise.resolve(existing === "Warfarin" ? [{ ...dbRow, drug_a: "Aspirin", drug_b: "Warfarin" }] : null)
    );
    seedInteractions([{ id: "local", drug_a: "aspirin", drug_b: "metformin", severity: "moderate" }]);
    const r = await checkDrugSafety("Aspirin", ["Warfarin", "Metformin"], [], HOSPITAL_A);
    expect(r.interactions.map((i) => i.id)).toEqual(expect.arrayContaining(["db-1", "local"]));
    expect(r.interactions).toHaveLength(2);
  });
});

// ── CHECK 3: allergies ────────────────────────────────────────────────────────

describe("documented allergy — direct match", () => {
  it("flags the allergen itself as contraindicated", async () => {
    const r = await checkDrugSafety("Amoxicillin", [], ["Amoxicillin"], HOSPITAL_A);
    expect(r.hasIssues).toBe(true);
    expect(r.worstSeverity).toBe("contraindicated");
    expect(r.allergyConflicts).toEqual([
      { allergy: "amoxicillin", drug: "Amoxicillin", type: "direct", severity: "contraindicated" },
    ]);
  });

  it("treats a brand of the allergen identically to the generic", async () => {
    // clinical-safety-testing names this fork explicitly: "Mox 500" must behave exactly as
    // "Amoxicillin" does. Before brand→generic resolution it passed silently.
    seedFormulary([{ drug_name: "Mox 500", generic_name: "Amoxicillin" }]);
    const brand = await checkDrugSafety("Mox 500", [], ["Amoxicillin"], HOSPITAL_A);
    const generic = await checkDrugSafety("Amoxicillin", [], ["Amoxicillin"], HOSPITAL_A);
    expect(brand.hasIssues).toBe(generic.hasIssues);
    expect(brand.worstSeverity).toBe(generic.worstSeverity);
    expect(brand.allergyConflicts[0].type).toBe("direct");
  });

  it("matches the allergen case-insensitively and after trimming", async () => {
    const r = await checkDrugSafety("Amoxicillin", [], ["  AMOXICILLIN  "], HOSPITAL_A);
    expect(r.hasIssues).toBe(true);
  });

  it("flags a combination brand when the patient is allergic to one constituent", async () => {
    seedFormulary([{ drug_name: "Augmentin 625", generic_name: "Amoxicillin + Clavulanate" }]);
    const r = await checkDrugSafety("Augmentin 625", [], ["Clavulanate"], HOSPITAL_A);
    expect(r.hasIssues).toBe(true);
    expect(r.worstSeverity).toBe("contraindicated");
  });

  it("does not flag an unrelated allergy", async () => {
    const r = await checkDrugSafety("Paracetamol", [], ["Sulphonamides"], HOSPITAL_A);
    expect(r.hasIssues).toBe(false);
    expect(r.allergyConflicts).toEqual([]);
  });
});

describe("documented allergy — cross-reactivity", () => {
  it("flags a penicillin-class drug for a penicillin-allergic patient", async () => {
    seedFormulary([{ drug_name: "Mox 500", generic_name: "Amoxicillin" }]);
    seedCrossReactivity([
      { allergen: "penicillin", cross_reacts: ["Amoxicillin", "Ampicillin"], risk_level: "high" },
    ]);
    const r = await checkDrugSafety("Mox 500", [], ["Penicillin"], HOSPITAL_A);
    expect(r.hasIssues).toBe(true);
    expect(r.allergyConflicts).toHaveLength(1);
    expect(r.allergyConflicts[0].type).toBe("cross_reactivity");
  });

  it("does not flag a drug outside the cross-reacting list", async () => {
    seedCrossReactivity([
      { allergen: "penicillin", cross_reacts: ["Amoxicillin", "Ampicillin"], risk_level: "high" },
    ]);
    const r = await checkDrugSafety("Azithromycin", [], ["Penicillin"], HOSPITAL_A);
    expect(r.hasIssues).toBe(false);
  });

  it("matches the allergen by substring in either direction", async () => {
    // Recorded allergies are free text: "penicillin allergy", "Penicillins", "pencillin V".
    seedCrossReactivity([
      { allergen: "penicillin", cross_reacts: ["Cefalexin"], risk_level: "moderate" },
    ]);
    const r = await checkDrugSafety("Cefalexin", [], ["Penicillin allergy"], HOSPITAL_A);
    expect(r.hasIssues).toBe(true);
  });

  // KNOWN-BUG-106 — FIXED in Phase 1 remediation. `risk_level` uses high/moderate/low while
  // SEVERITY_RANK used contraindicated/major/moderate/minor, so 'high' — which is also the
  // code's own default — scored 0 and reported worstSeverity 'none', ranking BELOW moderate.
  it("ranks a high-risk cross-reaction above a moderate one", async () => {
    seedFormulary([{ drug_name: "Mox 500", generic_name: "Amoxicillin" }]);
    seedCrossReactivity([
      { allergen: "penicillin", cross_reacts: ["Amoxicillin"], risk_level: "high" },
    ]);
    const high = await checkDrugSafety("Mox 500", [], ["Penicillin"], HOSPITAL_A);

    seedCrossReactivity([
      { allergen: "penicillin", cross_reacts: ["Amoxicillin"], risk_level: "moderate" },
    ]);
    const moderate = await checkDrugSafety("Mox 500", [], ["Penicillin"], HOSPITAL_A);

    expect(high.worstSeverity).toBe("major");
    expect(moderate.worstSeverity).toBe("moderate");
  });

  it("ranks the default risk_level — 'high' — as major, not as nothing", async () => {
    // `cr.risk_level || "high"` means a row with no risk level lands on the value that used
    // to score zero. The default must be the safest branch, not the quietest one.
    seedFormulary([{ drug_name: "Mox 500", generic_name: "Amoxicillin" }]);
    seedCrossReactivity([{ allergen: "penicillin", cross_reacts: ["Amoxicillin"] }]);
    const r = await checkDrugSafety("Mox 500", [], ["Penicillin"], HOSPITAL_A);
    expect(r.allergyConflicts[0].severity).toBe("high");
    expect(r.worstSeverity).toBe("major");
  });

  it("ranks 'low' risk as minor", async () => {
    seedFormulary([{ drug_name: "Mox 500", generic_name: "Amoxicillin" }]);
    seedCrossReactivity([
      { allergen: "penicillin", cross_reacts: ["Amoxicillin"], risk_level: "low" },
    ]);
    const r = await checkDrugSafety("Mox 500", [], ["Penicillin"], HOSPITAL_A);
    expect(r.worstSeverity).toBe("minor");
  });

  it("ranks a 'moderate' risk_level correctly, showing the gap is the vocabulary not the logic", async () => {
    seedFormulary([{ drug_name: "Mox 500", generic_name: "Amoxicillin" }]);
    seedCrossReactivity([
      { allergen: "penicillin", cross_reacts: ["Amoxicillin"], risk_level: "moderate" },
    ]);
    const r = await checkDrugSafety("Mox 500", [], ["Penicillin"], HOSPITAL_A);
    expect(r.worstSeverity).toBe("moderate");
  });
});

describe("worstSeverity reflects every class of issue", () => {
  // KNOWN-BUG-106, second facet — FIXED. Duplicates never fed getWorstSeverity, so a
  // paracetamol double-dose reported hasIssues true and worstSeverity 'none'. A gate reading
  // worstSeverity saw nothing wrong.
  it("reflects duplicate therapy", async () => {
    const r = await checkDrugSafety("Paracetamol", ["Paracetamol"], [], HOSPITAL_A);
    expect(r.hasIssues).toBe(true);
    expect(r.duplicates).toHaveLength(1);
    expect(r.worstSeverity).toBe("moderate");
  });

  it("never reports 'none' while also reporting an issue", async () => {
    // The invariant that makes worstSeverity safe to gate on. Both facets of KNOWN-BUG-106
    // were instances of breaking it, so it is asserted directly rather than only through
    // the specific cases that broke it.
    seedFormulary([{ drug_name: "Mox 500", generic_name: "Amoxicillin" }]);
    seedCrossReactivity([{ allergen: "penicillin", cross_reacts: ["Amoxicillin"], risk_level: "high" }]);
    seedInteractions([{ id: "i1", drug_a: "aspirin", drug_b: "warfarin", severity: "weird-value" }]);

    const cases = await Promise.all([
      checkDrugSafety("Paracetamol", ["Paracetamol"], [], HOSPITAL_A),
      checkDrugSafety("Mox 500", [], ["Penicillin"], HOSPITAL_A),
      checkDrugSafety("Aspirin", ["Warfarin"], [], HOSPITAL_A),
    ]);

    for (const r of cases) {
      expect(r.hasIssues).toBe(true);
      expect(r.worstSeverity).not.toBe("none");
    }
  });

  it("still reports 'none' when there is genuinely nothing wrong", async () => {
    const r = await checkDrugSafety("Paracetamol", [], [], HOSPITAL_A);
    expect(r.hasIssues).toBe(false);
    expect(r.worstSeverity).toBe("none");
  });
});

// ── The negative fork that no happy path sees ─────────────────────────────────

describe("lookup failure must not read as 'safe'", () => {
  // clinical-safety-testing calls this the test no happy path sees, and KNOWN-BUG-108 was
  // exactly it: both reference lookups destructured only `data`, so a timed-out query left
  // data:null → zero findings → hasIssues:false. A transport failure was indistinguishable
  // from a clean bill of health on a patient-safety surface.
  //
  // FIXED in Phase 1 remediation — the check now fails LOUD rather than open.

  it("does not report safe when the interaction lookup fails", async () => {
    mocks.resolvers.drug_interactions = () => ({ data: null, error: { message: "timeout" } });
    const r = await checkDrugSafety("Aspirin", ["Warfarin"], [], HOSPITAL_A);
    expect(r.hasIssues).toBe(true);
    expect(r.checkUnavailable).toBe(true);
  });

  it("does not report safe when the cross-reactivity lookup fails", async () => {
    mocks.resolvers.drug_allergy_cross_reactivity = () => ({ data: null, error: { message: "timeout" } });
    const r = await checkDrugSafety("Mox 500", [], ["Penicillin"], HOSPITAL_A);
    expect(r.hasIssues).toBe(true);
    expect(r.checkUnavailable).toBe(true);
  });

  it("raises worstSeverity so a gate reading it stops", async () => {
    // hasIssues alone is not enough: a caller that blocks on worstSeverity would otherwise
    // still have waved an unchecked prescription through.
    mocks.resolvers.drug_interactions = () => ({ data: null, error: { message: "timeout" } });
    const r = await checkDrugSafety("Aspirin", ["Warfarin"], [], HOSPITAL_A);
    expect(r.worstSeverity).toBe("major");
  });

  it("says WHY the check is incomplete", async () => {
    // "Something is wrong" with no reason is what makes a warning dismissible on reflex.
    mocks.resolvers.drug_interactions = () => ({ data: null, error: { message: "statement timeout" } });
    const r = await checkDrugSafety("Aspirin", ["Warfarin"], [], HOSPITAL_A);
    expect(r.unavailableReasons).toHaveLength(1);
    expect(r.unavailableReasons[0]).toContain("statement timeout");
  });

  it("reports both failures when both lookups are down", async () => {
    mocks.resolvers.drug_interactions = () => ({ data: null, error: { message: "boom-a" } });
    mocks.resolvers.drug_allergy_cross_reactivity = () => ({ data: null, error: { message: "boom-b" } });
    const r = await checkDrugSafety("Aspirin", ["Warfarin"], ["Penicillin"], HOSPITAL_A);
    expect(r.unavailableReasons).toHaveLength(2);
  });

  it("leaves checkUnavailable false on a healthy run", async () => {
    const r = await checkDrugSafety("Aspirin", ["Warfarin"], ["Penicillin"], HOSPITAL_A);
    expect(r.checkUnavailable).toBe(false);
    expect(r.unavailableReasons).toEqual([]);
    expect(r.hasIssues).toBe(false);
  });

  it("still catches a DIRECT allergy when cross-reactivity is unavailable", async () => {
    // The direct match is computed client-side and survives a dead reference table, so a
    // degraded check is still worth running — it just must not claim to be complete.
    mocks.resolvers.drug_allergy_cross_reactivity = () => ({ data: null, error: { message: "timeout" } });
    const r = await checkDrugSafety("Amoxicillin", [], ["Amoxicillin"], HOSPITAL_A);
    expect(r.worstSeverity).toBe("contraindicated");
    expect(r.checkUnavailable).toBe(true);
  });
});

describe("formulary resolution failure", () => {
  it("falls back to the typed name rather than throwing", async () => {
    // A formulary lookup failure must never BLOCK prescribing — but it must also not swallow
    // the direct allergy check, which needs no formulary at all.
    mocks.resolvers.drug_master = () => {
      throw new Error("connection reset");
    };
    const r = await checkDrugSafety("Amoxicillin", [], ["Amoxicillin"], HOSPITAL_A);
    expect(r.hasIssues).toBe(true);
    expect(r.worstSeverity).toBe("contraindicated");
  });

  it("reports the check as incomplete when the formulary is unreachable", async () => {
    // The cost of failing open, now made visible: with drug_master down, "Mox 500" is no
    // longer known to be amoxicillin and the allergy is genuinely missed. The result says so
    // instead of reading clean. Phase 6/7.5 covers the block at the dispensing step.
    mocks.resolvers.drug_master = () => {
      throw new Error("connection reset");
    };
    const r = await checkDrugSafety("Mox 500", [], ["Amoxicillin"], HOSPITAL_A);
    expect(r.allergyConflicts).toEqual([]); // the brand fork is still lost …
    expect(r.checkUnavailable).toBe(true); // … but the caller is told
    expect(r.hasIssues).toBe(true);
    expect(r.unavailableReasons[0]).toContain("connection reset");
  });

  it("reports a formulary query that errors rather than throws", async () => {
    mocks.resolvers.drug_master = () => ({ data: null, error: { message: "permission denied" } });
    const r = await checkDrugSafety("Mox 500", [], ["Amoxicillin"], HOSPITAL_A);
    expect(r.checkUnavailable).toBe(true);
    expect(r.unavailableReasons[0]).toContain("permission denied");
  });

  it("keeps the FIRST formulary failure reason when both passes fail", async () => {
    // Both the exact and the fuzzy pass can error. Overwriting would report the later,
    // less informative failure; the first one is the root cause.
    mocks.resolvers.drug_master = () => ({ data: null, error: { message: "exact-pass-failed" } });
    const r = await checkDrugSafety("Mox 500", ["Crocin"], ["Amoxicillin"], HOSPITAL_A);
    expect(r.unavailableReasons.filter((x) => x.startsWith("Formulary"))).toHaveLength(1);
    expect(r.unavailableReasons[0]).toContain("exact-pass-failed");
  });

  it("reports a failure in the fuzzy second pass even when the exact pass succeeded", async () => {
    // The exact pass resolves nothing and returns cleanly; the case-insensitive fallback is
    // the one that dies. Without this the brand→generic fork is silently lost for exactly
    // the hand-typed names the fuzzy pass exists to cover.
    mocks.resolvers.drug_master = (calls: QueryCall[]) =>
      calls.some((c) => c.method === "in")
        ? { data: [], error: null }
        : { data: null, error: { message: "fuzzy-pass-failed" } };
    const r = await checkDrugSafety("mox 500", [], ["Amoxicillin"], HOSPITAL_A);
    expect(r.checkUnavailable).toBe(true);
    expect(r.unavailableReasons[0]).toContain("fuzzy-pass-failed");
  });

  it("reports a non-Error thrown from the formulary lookup", async () => {
    // A rejected promise carrying a string is common at the fetch boundary; `undefined` in
    // the reason would render an empty bullet in the prescriber's warning.
    mocks.resolvers.drug_master = () => {
      throw "socket hang up";
    };
    const r = await checkDrugSafety("Mox 500", [], ["Amoxicillin"], HOSPITAL_A);
    expect(r.checkUnavailable).toBe(true);
    expect(r.unavailableReasons[0]).toContain("socket hang up");
  });
});

// ── Query budget ──────────────────────────────────────────────────────────────

describe("formulary lookup budget", () => {
  it("caps the fuzzy second pass at 8 lookups however long the medication list is", async () => {
    // Without the cap one safety check on a 20-drug ward list becomes 20 round trips, and
    // the check gets skipped for being slow — which is how a safety check stops running.
    const currents = Array.from({ length: 15 }, (_, idx) => `Unknown Drug ${idx}`);
    await checkDrugSafety("Aspirin", currents, [], HOSPITAL_A);
    expect(ilikeLookups).toBe(8);
  });

  it("does not spend the budget on names already resolved by the exact pass", async () => {
    seedFormulary([
      { drug_name: "Aspirin", generic_name: "Aspirin" },
      { drug_name: "Warfarin", generic_name: "Warfarin" },
    ]);
    await checkDrugSafety("Aspirin", ["Warfarin"], [], HOSPITAL_A);
    expect(ilikeLookups).toBe(0);
  });

  it("de-duplicates the name list before querying", async () => {
    await checkDrugSafety("Aspirin", ["Aspirin", "Aspirin"], [], HOSPITAL_A);
    expect(ilikeLookups).toBe(1);
  });

  it("resolves a hand-typed name through the case-insensitive second pass", async () => {
    // The exact-match pass misses "mox 500" because the catalogue stores "Mox 500"; the
    // fuzzy pass is what covers a drug typed by hand rather than picked from the list, and
    // it must still reach the allergy check.
    seedFormulary([{ drug_name: "Mox 500", generic_name: "Amoxicillin" }]);
    const r = await checkDrugSafety("mox 500", [], ["Amoxicillin"], HOSPITAL_A);
    expect(ilikeLookups).toBe(1);
    expect(r.hasIssues).toBe(true);
    expect(r.worstSeverity).toBe("contraindicated");
  });
});

// ── Malformed reference data must not corrupt the result ──────────────────────

describe("malformed reference rows", () => {
  it("ranks an unrecognised interaction severity as MAJOR, not as nothing", () => {
    // Failing upward is the whole point. A severity this module has not seen means a
    // reference table says the pair is dangerous and we cannot tell how dangerous — which
    // is not the same as safe. Failing upward shows a warning a clinician can dismiss;
    // failing downward hides one they never see.
    seedInteractions([{ id: "i1", drug_a: "aspirin", drug_b: "warfarin", severity: "catastrophic" }]);
    return checkDrugSafety("Aspirin", ["Warfarin"], [], HOSPITAL_A).then((r) => {
      expect(r.hasIssues).toBe(true);
      expect(r.worstSeverity).toBe("major");
    });
  });

  it("ranks a blank interaction severity as MAJOR too", () => {
    seedInteractions([{ id: "i1", drug_a: "aspirin", drug_b: "warfarin", severity: "" }]);
    return checkDrugSafety("Aspirin", ["Warfarin"], [], HOSPITAL_A).then((r) => {
      expect(r.worstSeverity).toBe("major");
    });
  });

  it("ranks a null interaction severity as MAJOR too", () => {
    // A reference row with no severity column value at all — the NULL that a CHECK
    // constraint does not forbid.
    seedInteractions([{ id: "i1", drug_a: "aspirin", drug_b: "warfarin", severity: null as unknown as string }]);
    return checkDrugSafety("Aspirin", ["Warfarin"], [], HOSPITAL_A).then((r) => {
      expect(r.worstSeverity).toBe("major");
    });
  });

  it("still honours an explicit 'none' severity", () => {
    // 'none' is a real value in the vocabulary and means the reference table has assessed
    // the pair as benign — distinct from a value it does not recognise.
    seedInteractions([{ id: "i1", drug_a: "aspirin", drug_b: "warfarin", severity: "none" }]);
    return checkDrugSafety("Aspirin", ["Warfarin"], [], HOSPITAL_A).then((r) => {
      expect(r.interactions).toHaveLength(1);
      expect(r.worstSeverity).toBe("none");
    });
  });

  it("sorts a contraindication above an unranked severity", () => {
    // An unranked value now ties with `major`, so the assertion that still means something
    // is that a genuine contraindication outranks it — not the ordering within the tie.
    seedInteractions([
      { id: "unknown", drug_a: "aspirin", drug_b: "metformin", severity: "catastrophic" },
      { id: "contra", drug_a: "aspirin", drug_b: "warfarin", severity: "contraindicated" },
    ]);
    return checkDrugSafety("Aspirin", ["Warfarin", "Metformin"], [], HOSPITAL_A).then((r) => {
      expect(r.interactions).toHaveLength(2);
      expect(r.interactions[0].id).toBe("contra");
      expect(r.worstSeverity).toBe("contraindicated");
    });
  });

  it("sorts a minor interaction below an unranked one", () => {
    seedInteractions([
      { id: "minor", drug_a: "aspirin", drug_b: "metformin", severity: "minor" },
      { id: "unknown", drug_a: "aspirin", drug_b: "warfarin", severity: "catastrophic" },
    ]);
    return checkDrugSafety("Aspirin", ["Warfarin", "Metformin"], [], HOSPITAL_A).then((r) => {
      expect(r.interactions.map((i) => i.id)).toEqual(["unknown", "minor"]);
    });
  });

  it("keeps unranked severities in list order rather than dropping them to the end twice", () => {
    // Exercises the comparator with an unranked value on BOTH sides — an unstable or
    // throwing comparator here silently reorders the whole warning list.
    seedInteractions([
      { id: "unknown-a", drug_a: "aspirin", drug_b: "metformin", severity: "catastrophic" },
      { id: "unknown-b", drug_a: "aspirin", drug_b: "ibuprofen", severity: "unheard-of" },
    ]);
    return checkDrugSafety("Aspirin", ["Metformin", "Ibuprofen"], [], HOSPITAL_A).then((r) => {
      expect(r.interactions.map((i) => i.id)).toEqual(["unknown-a", "unknown-b"]);
    });
  });

  it("de-duplicates a pair the two sources report in opposite column order", () => {
    mocks.checkDrugBankDDI.mockResolvedValue([
      { id: "db", drug_a: "aspirin", drug_b: "warfarin", severity: "major", mechanism: null, clinical_effect: null, recommendation: null },
    ]);
    seedInteractions([{ id: "local", drug_a: "warfarin", drug_b: "aspirin", severity: "major" }]);
    return checkDrugSafety("Aspirin", ["Warfarin"], [], HOSPITAL_A).then((r) => {
      expect(r.interactions).toHaveLength(1);
      expect(r.interactions[0].id).toBe("db");
    });
  });

  it("tolerates a formulary row with no generic name", () => {
    seedFormulary([{ drug_name: "Mystery Tonic", generic_name: null }]);
    return checkDrugSafety("Mystery Tonic", [], ["Amoxicillin"], HOSPITAL_A).then((r) => {
      expect(r.hasIssues).toBe(false);
    });
  });

  it("tolerates a formulary row the query should not have returned", () => {
    // Defensive: the exact-match pass keys returned rows back to the requested names. A row
    // outside that set is skipped rather than mis-attributed to whichever name came first.
    mocks.resolvers.drug_master = (calls: QueryCall[]) => {
      const isExactPass = calls.some((c) => c.method === "in");
      return {
        data: isExactPass ? [{ drug_name: "Something Else", generic_name: "Amoxicillin" }] : [],
        error: null,
      };
    };
    return checkDrugSafety("Mox 500", [], ["Amoxicillin"], HOSPITAL_A).then((r) => {
      expect(r.hasIssues).toBe(false);
    });
  });

  it("tolerates a null data body from either formulary pass", () => {
    mocks.resolvers.drug_master = () => ({ data: null, error: null });
    return checkDrugSafety("Amoxicillin", [], ["Amoxicillin"], HOSPITAL_A).then((r) => {
      expect(r.hasIssues).toBe(true);
    });
  });

  it("ignores blank entries in the current medication list", () => {
    return checkDrugSafety("Aspirin", ["", "   ", "Aspirin"], [], HOSPITAL_A).then((r) => {
      expect(r.duplicates).toEqual(["Aspirin"]);
    });
  });

  // KNOWN-BUG-111 — FIXED. `resolveAliases` guarded its name list with `(n ?? "")`, but
  // `aliasesOf` fell through to `normalize(name)` for any name the map did not hold, and
  // `normalize(null)` threw. checkDrugSafety then REJECTED rather than returning, handing
  // the decision to whatever the caller's catch block does.
  it("skips a null medication name instead of throwing", async () => {
    const r = await checkDrugSafety("Aspirin", [null as unknown as string, "Aspirin"], [], HOSPITAL_A);
    expect(r.duplicates).toEqual(["Aspirin"]);
  });

  it("resolves rather than rejects on a list of nothing but nulls", async () => {
    const r = await checkDrugSafety("Aspirin", [null as unknown as string, undefined as unknown as string], [], HOSPITAL_A);
    expect(r.hasIssues).toBe(false);
    expect(r.duplicates).toEqual([]);
  });

  it("tolerates a null drug name without throwing", async () => {
    const r = await checkDrugSafety(null as unknown as string, ["Aspirin"], [], HOSPITAL_A);
    expect(r.hasIssues).toBe(false);
  });

  it("tolerates a cross-reactivity row with a null allergen", () => {
    seedCrossReactivity([{ allergen: null as unknown as string, cross_reacts: ["Amoxicillin"], risk_level: "moderate" }]);
    return checkDrugSafety("Amoxicillin", [], ["Penicillin"], HOSPITAL_A).then((r) => {
      // A null allergen normalises to "", which every allergy string "contains" — so the row
      // matches, and only the drug list stops it. Pinned because a reference table with a
      // null allergen therefore behaves as a wildcard, not as an inert row.
      expect(r.allergyConflicts).toHaveLength(1);
      expect(r.allergyConflicts[0].allergy).toBe("");
    });
  });

  it("tolerates a cross-reactivity row with a null cross_reacts list", () => {
    seedCrossReactivity([{ allergen: "penicillin", cross_reacts: null as unknown as string[] }]);
    return checkDrugSafety("Amoxicillin", [], ["Penicillin"], HOSPITAL_A).then((r) => {
      expect(r.allergyConflicts).toEqual([]);
    });
  });

  it("defaults a missing risk_level to 'high'", () => {
    seedFormulary([{ drug_name: "Mox 500", generic_name: "Amoxicillin" }]);
    seedCrossReactivity([{ allergen: "penicillin", cross_reacts: ["Amoxicillin"] }]);
    return checkDrugSafety("Mox 500", [], ["Penicillin"], HOSPITAL_A).then((r) => {
      expect(r.allergyConflicts[0].severity).toBe("high");
    });
  });

  it("skips a cross-reactivity row whose allergen the patient does not have", () => {
    seedCrossReactivity([
      { allergen: "sulphonamides", cross_reacts: ["Amoxicillin"], risk_level: "moderate" },
      { allergen: "penicillin", cross_reacts: ["Cefalexin"], risk_level: "moderate" },
    ]);
    return checkDrugSafety("Amoxicillin", [], ["Penicillin"], HOSPITAL_A).then((r) => {
      expect(r.allergyConflicts).toEqual([]);
    });
  });

  it("matches when the recorded allergy is shorter than the allergen", () => {
    // Allergies are free text: "pen" is recorded against a "penicillin" reference row.
    seedCrossReactivity([{ allergen: "penicillin", cross_reacts: ["Cefalexin"], risk_level: "moderate" }]);
    return checkDrugSafety("Cefalexin", [], ["pen"], HOSPITAL_A).then((r) => {
      expect(r.hasIssues).toBe(true);
    });
  });

  it("does not let a blank cross_reacts entry match every drug", () => {
    seedCrossReactivity([{ allergen: "penicillin", cross_reacts: [""], risk_level: "moderate" }]);
    return checkDrugSafety("Paracetamol", [], ["Penicillin"], HOSPITAL_A).then((r) => {
      expect(r.allergyConflicts).toEqual([]);
    });
  });
});

describe("tenant scoping", () => {
  it("narrows the formulary read by hospital when an id is supplied", async () => {
    let sawHospitalFilter = false;
    mocks.resolvers.drug_master = (calls: QueryCall[]) => {
      sawHospitalFilter = calls.some((c) => c.method === "eq" && c.args[0] === "hospital_id" && c.args[1] === HOSPITAL_A);
      return { data: [], error: null };
    };
    await checkDrugSafety("Aspirin", [], [], HOSPITAL_A);
    expect(sawHospitalFilter).toBe(true);
  });

  it("relies on RLS alone when no hospital id is supplied", async () => {
    let sawHospitalFilter = false;
    mocks.resolvers.drug_master = (calls: QueryCall[]) => {
      sawHospitalFilter = calls.some((c) => c.method === "eq" && c.args[0] === "hospital_id");
      return { data: [], error: null };
    };
    await checkDrugSafety("Aspirin", [], [], "");
    expect(sawHospitalFilter).toBe(false);
  });
});

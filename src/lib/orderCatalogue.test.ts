import { describe, it, expect } from "vitest";
import {
  matchOrderName,
  matchOrderNameDetailed,
  resolveOrders,
  type OrderCatalogue,
  type CatalogueEntry,
} from "./orderCatalogue";
import { normalizeTerm } from "./medicalLexicon";

function build(entries: CatalogueEntry[]): OrderCatalogue {
  const byExact = new Map<string, CatalogueEntry>();
  for (const e of entries) {
    const k = normalizeTerm(e.name);
    if (k && !byExact.has(k)) byExact.set(k, e);
  }
  return { byExact, all: entries };
}

const catalogue = build([
  { id: "l1", name: "CBC", kind: "lab" },
  { id: "l2", name: "Serum Creatinine", kind: "lab" },
  { id: "l3", name: "Urine R/M", kind: "lab" },
  { id: "l4", name: "Urine Culture", kind: "lab" },
  { id: "l5", name: "HbA1c", kind: "lab" },
  { id: "g1", name: "Lipid Profile", kind: "lab_group" },
  { id: "r1", name: "Chest X-Ray PA", kind: "radiology" },
  { id: "r2", name: "USG Abdomen & Pelvis", kind: "radiology" },
  { id: "r3", name: "2D Echo with Doppler", kind: "radiology" },
]);

// Stand-in for isRadiologyKeyword, used only when nothing resolves.
const fallbackIsRadiology = (n: string) => /x-ray|usg|ct|mri|echo|ultrasound/i.test(n);

describe("matchOrderName", () => {
  it("matches exactly, ignoring case and punctuation", () => {
    expect(matchOrderName("cbc", catalogue)?.id).toBe("l1");
    expect(matchOrderName("Urine R M", catalogue)?.id).toBe("l3");
    expect(matchOrderName("usg abdomen and pelvis", catalogue)?.id).toBe("r2");
  });

  it("REFUSES to confuse tests that share a prefix", () => {
    // "Urine R/M" and "Urine Culture" are different tests; a wrong match orders the wrong one.
    expect(matchOrderName("Urine", catalogue)).toBeNull();
  });

  it("REFUSES a test the hospital does not offer", () => {
    expect(matchOrderName("Dengue NS1 Antigen", catalogue)).toBeNull();
    expect(matchOrderName("PET CT Whole Body", catalogue)).toBeNull();
  });

  it("handles empty input", () => {
    expect(matchOrderName("", catalogue)).toBeNull();
    expect(matchOrderName("CBC", { byExact: new Map(), all: [] })).toBeNull();
  });
});

// The reported defect: "Fever panel test" rendered "Not offered here — Prescribed test not
// found in the lab catalogue — not ordered or billed" while Fever Panel was on screen as a
// chip. Whole-string Levenshtein scores the pair 0.714, under the 0.88 gate, because the
// redundant word "test" is 4 of the 14 characters.
describe("matchOrderName — redundant words", () => {
  const panels = build([
    { id: "g1", name: "Fever Panel", kind: "lab_group" },
    { id: "g2", name: "Lipid Profile", kind: "lab_group" },
    { id: "l1", name: "Serum Creatinine", kind: "lab" },
    { id: "l2", name: "Widal Test", kind: "lab" },
    { id: "l3", name: "Malaria Antigen (Rapid)", kind: "lab" },
    { id: "r1", name: "USG Abdomen + Pelvis", kind: "radiology" },
  ]);

  it("ignores a trailing 'test' / 'scan' / 'study' the doctor appended", () => {
    expect(matchOrderName("Fever panel test", panels)?.id).toBe("g1");
    expect(matchOrderName("fever panel testing", panels)?.id).toBe("g1");
    expect(matchOrderName("please do lipid profile", panels)?.id).toBe("g2");
  });

  it("ignores word ORDER and the &/+ spelling of a joined study", () => {
    expect(matchOrderName("USG abdomen and pelvis", panels)?.id).toBe("r1");
    expect(matchOrderName("pelvis and abdomen USG", panels)?.id).toBe("r1");
  });

  it("still forgives spelling drift on a single token", () => {
    expect(matchOrderName("serum creatinin", panels)?.id).toBe("l1");
  });

  it("does not strip a word the catalogue name needs to be itself", () => {
    // "Lipid" is not "Lipid Profile" — the panel is a different, more expensive order.
    expect(matchOrderName("Lipid", panels)).toBeNull();
    expect(matchOrderName("lipid test", panels)).toBeNull();
  });

  it("REFUSES a request that carries a token the catalogue row does not", () => {
    // A malaria-specific fever workup is not the Fever Panel.
    expect(matchOrderName("malaria fever panel", panels)).toBeNull();
  });

  it("keeps a catalogue name that is ITSELF mostly noise words matchable", () => {
    expect(matchOrderName("widal", panels)?.id).toBe("l2");
    expect(matchOrderName("Widal test", panels)?.id).toBe("l2");
  });

  it("REFUSES to rewrite plain English into a test name", () => {
    expect(matchOrderName("check the pain", panels)).toBeNull();
    expect(matchOrderName("fever", panels)).toBeNull();
  });

  it("does not swap one immunoglobulin class for the other", () => {
    // IgM is a current infection, IgG is a past one. Dropping "test" must not also drop the
    // single letter that carries the whole clinical meaning.
    const twins = build([
      { id: "a", name: "Dengue IgM", kind: "lab" },
      { id: "b", name: "Dengue IgG", kind: "lab" },
    ]);
    expect(matchOrderName("dengue igm", twins)?.id).toBe("a");
    expect(matchOrderName("Dengue IgM test", twins)?.id).toBe("a");
    expect(matchOrderName("Dengue IgG test", twins)?.id).toBe("b");
  });
});

describe("matchOrderNameDetailed — aliases", () => {
  const withAlias: OrderCatalogue = (() => {
    const c = build([
      { id: "g1", name: "Kidney Function Test", kind: "lab_group" },
      { id: "l1", name: "Blood Sugar Random", kind: "lab" },
    ]);
    const byAlias = new Map<string, CatalogueEntry>([
      ["kft", c.all[0]],
      ["rbs", c.all[1]],
    ]);
    return { ...c, byAlias };
  })();

  it("resolves shorthand no scorer could reach, and says it was an alias", () => {
    expect(matchOrderNameDetailed("KFT", withAlias)).toMatchObject({
      entry: { id: "g1" }, source: "alias",
    });
    expect(matchOrderNameDetailed("rbs", withAlias)?.entry.id).toBe("l1");
  });

  it("reports the tier that actually resolved the name", () => {
    expect(matchOrderNameDetailed("Blood Sugar Random", withAlias)?.source).toBe("exact");
    expect(matchOrderNameDetailed("blood sugar random test", withAlias)?.source).toBe("fuzzy");
  });
});

describe("resolveOrders", () => {
  it("routes by CATALOGUE MEMBERSHIP, not by keyword guessing", () => {
    // The whole point: "2D Echo with Doppler" is a radiology study because it IS one in this
    // hospital's catalogue — not because a regex happened to spot "echo".
    const r = resolveOrders(["CBC", "2D Echo with Doppler"], catalogue, () => false);
    expect(r[0]).toMatchObject({ kind: "lab", catalogueId: "l1", offered: true });
    expect(r[1]).toMatchObject({ kind: "radiology", catalogueId: "r3", offered: true });
  });

  it("canonicalises the name so the exact-match order sync stops dropping it", () => {
    // syncLabOrders requires an exact lab_test_master.test_name match and silently drops
    // anything else — the leak pendingInvestigations.ts measures.
    const r = resolveOrders(["urine r m"], catalogue, fallbackIsRadiology);
    expect(r[0].name).toBe("Urine R/M");
    expect(r[0].offered).toBe(true);
  });

  it("resolves a panel to its lab_test_groups row", () => {
    const r = resolveOrders(["lipid profile"], catalogue, fallbackIsRadiology);
    expect(r[0]).toMatchObject({ kind: "lab_group", catalogueId: "g1", offered: true });
  });

  it("keeps an unoffered test, marked not offered, rather than dropping it", () => {
    const r = resolveOrders(["Dengue NS1 Antigen"], catalogue, fallbackIsRadiology);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: "Dengue NS1 Antigen", offered: false, catalogueId: null });
  });

  it("falls back to the keyword router only for unresolved names", () => {
    const r = resolveOrders(["MRI Brain Screening"], catalogue, fallbackIsRadiology);
    expect(r[0]).toMatchObject({ kind: "radiology", offered: false });
  });

  it("preserves the dictated text alongside the canonical name", () => {
    const r = resolveOrders(["urine r m"], catalogue, fallbackIsRadiology);
    expect(r[0].dictated).toBe("urine r m");
    expect(r[0].name).toBe("Urine R/M");
  });

  it("skips blanks and handles an empty list", () => {
    expect(resolveOrders([], catalogue, fallbackIsRadiology)).toEqual([]);
    expect(resolveOrders(["", "  "], catalogue, fallbackIsRadiology)).toEqual([]);
  });
});

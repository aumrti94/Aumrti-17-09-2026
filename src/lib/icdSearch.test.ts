import { describe, it, expect } from "vitest";
import {
  buildTsQuery,
  fallbackTerm,
  fallbackTerms,
  expandTokens,
  scoreMatch,
  localSearch,
  pickAutoFill,
  systemsFor,
  MIN_SEARCH_LENGTH,
  type IcdResult,
} from "./icdSearch";

/**
 * These cover the pure half of icdSearch — the query construction that carried the
 * websearch/`|` bug. The Supabase-touching half is exercised end-to-end by the Phase 4
 * OPD spec instead of being mocked here.
 */

describe("buildTsQuery", () => {
  it("ORs the terms rather than ANDing them", () => {
    // The whole point: `|` is what makes this an OR once it reaches to_tsquery.
    // The old code produced the same string but handed it to websearch_to_tsquery,
    // which drops the pipes and ANDs the lexemes.
    expect(buildTsQuery("acute upper respiratory infection")).toBe("acute | upper | respiratory | infection");
  });

  it("drops words of two characters or fewer, as both call sites always did", () => {
    expect(buildTsQuery("ca of lung")).toBe("lung");
  });

  it("strips punctuation so no tsquery operator can be injected", () => {
    // A user typing these into the diagnosis box must not be able to build a tsquery.
    expect(buildTsQuery("fever & !cough | (rash)")).toBe("fever | cough | rash");
    expect(buildTsQuery("diabetes<->mellitus")).toBe("diabetes | mellitus");
  });

  it("caps the term count", () => {
    expect(buildTsQuery("alpha beta gamma delta epsilon zeta")).toBe("alpha | beta | gamma | delta");
    expect(buildTsQuery("alpha beta gamma delta epsilon", 2)).toBe("alpha | beta");
  });

  it("returns empty when nothing usable survives, so FTS is skipped entirely", () => {
    expect(buildTsQuery("")).toBe("");
    expect(buildTsQuery("a to be")).toBe("");
    expect(buildTsQuery("!!! ??")).toBe("");
  });

  it("handles a single word", () => {
    expect(buildTsQuery("fever")).toBe("fever");
  });
});

describe("fallbackTerm", () => {
  it("returns the first usable word for the ilike fallback", () => {
    expect(fallbackTerm("acute upper respiratory infection")).toBe("acute");
  });

  it("skips short leading words", () => {
    expect(fallbackTerm("ca of lung")).toBe("lung");
  });

  it("falls back to the raw first token when every word is short", () => {
    expect(fallbackTerm("ca")).toBe("ca");
  });

  it("returns empty for empty input", () => {
    expect(fallbackTerm("")).toBe("");
  });
});

describe("systemsFor", () => {
  it("defaults to ICD-10 only, so a hospital that never opted in is unaffected", () => {
    expect(systemsFor(null)).toEqual(["icd10"]);
    expect(systemsFor(undefined)).toEqual(["icd10"]);
    expect(systemsFor("icd10")).toEqual(["icd10"]);
  });

  it("honours the opt-in values", () => {
    expect(systemsFor("icd11")).toEqual(["icd11"]);
    expect(systemsFor("both")).toEqual(["icd10", "icd11"]);
  });
});

describe("MIN_SEARCH_LENGTH", () => {
  it("keeps the 3-character threshold both pickers already used", () => {
    expect(MIN_SEARCH_LENGTH).toBe(3);
  });
});

const icd = (code: string, description: string): IcdResult => ({ code, description, code_system: "icd10" });

describe("expandTokens", () => {
  it("keeps the typed words first, so the query can only widen", () => {
    expect(expandTokens("cervical spondylitis").slice(0, 2)).toEqual(["cervical", "spondylitis"]);
  });

  it("adds the spelling the catalogue actually uses", () => {
    // The reported bug: the seed spells this 'spondylosis' and nothing matched the typed form.
    expect(expandTokens("cervical spondylitis")).toContain("spondylosis");
  });

  it("leaves a term with no synonyms exactly as it was", () => {
    expect(expandTokens("acute upper respiratory infection")).toEqual([
      "acute", "upper", "respiratory", "infection",
    ]);
  });
});

describe("fallbackTerms", () => {
  it("tries the specific word before the generic one", () => {
    // The old fallback took the leading word — "cervical" — and gave up when it missed.
    expect(fallbackTerms("cervical spondylitis")[0]).toBe("spondylitis");
  });

  it("still yields the only word for a single-word term", () => {
    expect(fallbackTerms("fever")).toEqual(["fever"]);
  });
});

describe("scoreMatch", () => {
  it("scores a row that answers every typed word above one that answers half", () => {
    const full = scoreMatch("cervical spondylitis", icd("M47.812", "Spondylosis without myelopathy, cervical region"));
    const half = scoreMatch("cervical spondylitis", icd("N87.9", "Cervical dysplasia, unspecified"));
    expect(full).toBe(1);
    expect(half).toBeLessThan(full);
  });

  it("treats an exact code as what the doctor meant", () => {
    expect(scoreMatch("M47.9", icd("M47.9", "Spondylosis, unspecified"))).toBe(1);
  });

  it("is zero when nothing overlaps", () => {
    expect(scoreMatch("dengue fever", icd("M47.9", "Spondylosis, unspecified"))).toBe(0);
  });
});

describe("localSearch", () => {
  it("finds the code the seeded table is missing", () => {
    // This is the exact term from the bug report, and the code is in the shipped catalogue.
    const hits = localSearch("cervical spondylitis");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].code).toBe("M47.812");
  });

  it("returns nothing rather than noise for an unmatchable term", () => {
    expect(localSearch("zzzzq")).toEqual([]);
  });

  it("ranks the fuller match above the one that only shares a generic word", () => {
    const hits = localSearch("cervical spondylitis");
    const spondylosis = hits.findIndex((h) => h.code === "M47.812");
    const cervicalOnly = hits.findIndex((h) => h.code === "M50.10");
    expect(spondylosis).toBeGreaterThanOrEqual(0);
    if (cervicalOnly >= 0) expect(spondylosis).toBeLessThan(cervicalOnly);
  });
});

describe("pickAutoFill", () => {
  it("fills only when one code answers the whole term", () => {
    const results = [
      icd("M47.812", "Spondylosis without myelopathy, cervical region"),
      icd("M54.2", "Cervicalgia"),
    ];
    expect(pickAutoFill("cervical spondylitis", results)?.code).toBe("M47.812");
  });

  it("refuses when two codes match equally well — that is the doctor's call", () => {
    const results = [
      icd("M47.812", "Spondylosis without myelopathy, cervical region"),
      icd("M47.813", "Spondylosis without myelopathy, cervical region"),
    ];
    expect(pickAutoFill("cervical spondylitis", results)).toBeNull();
  });

  it("refuses on a partial match rather than coding a guess", () => {
    expect(pickAutoFill("cervical spondylitis", [icd("N87.9", "Cervical dysplasia")])).toBeNull();
  });

  it("refuses on an empty result set", () => {
    expect(pickAutoFill("anything", [])).toBeNull();
  });
});

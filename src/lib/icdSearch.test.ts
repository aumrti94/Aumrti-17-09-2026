import { describe, it, expect } from "vitest";
import {
  systemsFor,
  buildTsQuery,
  fallbackTerm,
  expandTokens,
  fallbackTerms,
  scoreMatch,
  pickAutoFill,
  localSearch,
  MIN_SEARCH_LENGTH,
  type IcdResult,
} from "@/lib/icdSearch";

describe("systemsFor — the ICD-10/11 Code Master active_code_system setting", () => {
  it("'both' searches both catalogues", () => {
    expect(systemsFor("both")).toEqual(["icd10", "icd11"]);
  });

  it("'icd11' searches ICD-11 only — a different setting value than 'icd10' produces a different query scope", () => {
    expect(systemsFor("icd11")).toEqual(["icd11"]);
    expect(systemsFor("icd10")).toEqual(["icd10"]);
    expect(systemsFor("icd11")).not.toEqual(systemsFor("icd10"));
  });

  it("an unset/unknown value defaults to ICD-10 only — pre-ICD-11 behaviour for hospitals that never opened the setting", () => {
    expect(systemsFor(null)).toEqual(["icd10"]);
    expect(systemsFor(undefined)).toEqual(["icd10"]);
  });
});

describe("buildTsQuery — the OR'd tsquery this module exists to fix", () => {
  it("joins terms with | for to_tsquery, not websearch's silent AND", () => {
    expect(buildTsQuery("acute upper respiratory infection")).toBe("acute | upper | respiratory | infection");
  });

  it("drops words of length <= 2 and caps at maxTerms", () => {
    expect(buildTsQuery("a cervical spondylitis of the spine", 2)).toBe("cervical | spondylitis");
  });

  it("returns empty string when nothing usable survives, so callers skip FTS entirely", () => {
    expect(buildTsQuery("a an of")).toBe("");
    expect(buildTsQuery("")).toBe("");
  });

  it("strips punctuation before tokenising, so it cannot leak a tsquery operator", () => {
    expect(buildTsQuery("diabetes; DROP TABLE --")).toBe("diabetes | drop | table");
  });
});

describe("fallbackTerm", () => {
  it("picks the first word longer than 2 chars, not the leading generic word", () => {
    expect(fallbackTerm("cervical spondylitis")).toBe("cervical");
  });

  it("falls back to the raw first token when nothing survives the length filter", () => {
    expect(fallbackTerm("a b")).toBe("a");
  });
});

describe("expandTokens — synonym widening is additive", () => {
  it("typed words always lead, synonyms are appended after", () => {
    const tokens = expandTokens("cervical spondylitis");
    expect(tokens.slice(0, 2)).toEqual(["cervical", "spondylitis"]);
    expect(tokens).toContain("spondylosis");
  });

  it("a term with no known synonym returns only the typed tokens", () => {
    expect(expandTokens("fracture femur")).toEqual(["fracture", "femur"]);
  });

  it("does not duplicate a synonym that is already one of the typed words", () => {
    const tokens = expandTokens("sugar diabetes");
    expect(tokens.filter((t) => t === "diabetes")).toHaveLength(1);
  });

  it("respects maxTerms on the typed side before expanding synonyms", () => {
    const tokens = expandTokens("sugar problem long standing issue", 1);
    expect(tokens[0]).toBe("sugar");
    expect(tokens).toContain("diabetes");
  });
});

describe("fallbackTerms — most specific (longest) word first, typed before synonym", () => {
  it("orders the rarer, more diagnostic word ahead of the generic one", () => {
    const terms = fallbackTerms("cervical spondylitis");
    expect(terms[0]).toBe("spondylitis");
    expect(terms).toContain("cervical");
  });

  it("typed words are probed before any synonym even if the synonym is longer", () => {
    const terms = fallbackTerms("sugar");
    expect(terms.indexOf("sugar")).toBeLessThan(terms.indexOf("diabetes"));
  });
});

describe("scoreMatch", () => {
  const desc = (d: string): Pick<IcdResult, "code" | "description"> => ({ code: "X00", description: d });

  it("scores 1 when every typed word is found (direct or via synonym)", () => {
    expect(scoreMatch("cervical spondylitis", desc("cervical spondylosis of neck"))).toBe(1);
  });

  it("scores partial credit when only some typed words are found", () => {
    expect(scoreMatch("cervical spondylitis fracture", desc("cervical spondylosis of neck"))).toBeCloseTo(2 / 3);
  });

  it("scores 0 for an empty typed term", () => {
    expect(scoreMatch("", desc("anything"))).toBe(0);
  });

  it("an exact code match scores 1 regardless of the description", () => {
    expect(scoreMatch("M47.2", { code: "M47.2", description: "totally unrelated text" })).toBe(1);
  });
});

describe("pickAutoFill — deliberately conservative, feeds billing/PMJAY/FHIR", () => {
  const r = (code: string, description: string): IcdResult => ({ code, description, code_system: "icd10" });

  it("returns the single candidate that matches every typed word", () => {
    const results = [r("M47.2", "cervical spondylosis with radiculopathy")];
    expect(pickAutoFill("cervical spondylitis", results)).toEqual(results[0]);
  });

  it("refuses to pick when the top candidate does not fully match", () => {
    const results = [r("M47.2", "cervical spondylosis"), r("S12.9", "cervical fracture, unspecified")];
    expect(pickAutoFill("cervical spondylitis fracture", results)).toBeNull();
  });

  it("refuses to pick on a tie between two equally-good candidates — that is the doctor's call", () => {
    const results = [r("M47.2", "cervical spondylosis"), r("M47.9", "spondylosis, unspecified")];
    expect(pickAutoFill("spondylosis", results)).toBeNull();
  });

  it("returns null for an empty result set", () => {
    expect(pickAutoFill("anything", [])).toBeNull();
  });
});

describe("localSearch — bundled catalogue fallback", () => {
  it("returns [] for a term with no usable tokens", () => {
    expect(localSearch("a")).toEqual([]);
  });

  it("returns only icd10-tagged results and honours the limit", () => {
    const results = localSearch("diabetes", 3);
    expect(results.length).toBeLessThanOrEqual(3);
    for (const r of results) expect(r.code_system).toBe("icd10");
  });
});

describe("MIN_SEARCH_LENGTH", () => {
  it("is 3, matching the documented pre-existing callers' behaviour", () => {
    expect(MIN_SEARCH_LENGTH).toBe(3);
  });
});

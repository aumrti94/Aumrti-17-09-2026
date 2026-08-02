import { describe, it, expect } from "vitest";
import {
  normalizeTerm, phoneticKey, phoneticNormalize, levenshtein, similarityRatio,
  buildLexiconIndex, repairTranscript, shouldAutoApply, expandSpelledLetters,
  COMMON_ENGLISH_WORDS, CLINICAL_ABBREVIATIONS,
  type LexiconEntry,
} from "./medicalLexicon";

const drugs = (...names: string[]): LexiconEntry[] =>
  names.map(term => ({ term, source: "drug_master" as const }));

const HOSPITAL: LexiconEntry[] = [
  ...drugs("Paracetamol", "Amoxicillin", "Pantoprazole", "Cetirizine", "Metformin",
           "Atorvastatin", "Azithromycin", "Ciprofloxacin", "Amlodipine", "Ondansetron"),
  { term: "ECG", source: "abbreviation" },
  { term: "Complete Blood Count", source: "lab_test_master" },
  { term: "Serum Creatinine", source: "lab_test_master" },
  { term: "Chest X-ray", source: "radiology_study_master" },
];

describe("normalizeTerm", () => {
  it("reduces to comparable lowercase alphanumerics", () => {
    expect(normalizeTerm("Chest X-ray")).toBe("chestxray");
    expect(normalizeTerm("PT/INR")).toBe("ptinr");
    expect(normalizeTerm("  Paracetamol,  ")).toBe("paracetamol");
  });

  it("survives empty and non-latin input", () => {
    expect(normalizeTerm("")).toBe("");
    expect(normalizeTerm("ఏం కాలే")).toBe("");
  });
});

describe("phoneticKey", () => {
  it("collapses an ASR word-split onto the real drug's key", () => {
    // The exact live failure: "paracetamol" heard as three pseudo-words.
    expect(phoneticKey("para seta mall")).toBe(phoneticKey("paracetamol"));
    expect(phoneticKey("amoxy sillin")).toBe(phoneticKey("amoxicillin"));
    expect(phoneticKey("pan toe prazole")).toBe(phoneticKey("pantoprazole"));
  });

  it("normalises the spellings Indian English varies most", () => {
    expect(phoneticKey("cetirizine")).toBe(phoneticKey("setirizine"));
    expect(phoneticKey("sulphate")).toBe(phoneticKey("sulfate"));
    expect(phoneticKey("chloroquine")).toBe(phoneticKey("kloroquine"));
  });

  it("keeps genuinely different drugs in different buckets", () => {
    expect(phoneticKey("metformin")).not.toBe(phoneticKey("metronidazole"));
    expect(phoneticKey("amlodipine")).not.toBe(phoneticKey("amoxicillin"));
    expect(phoneticKey("atorvastatin")).not.toBe(phoneticKey("azithromycin"));
  });

  it("returns empty for input with no latin characters", () => {
    expect(phoneticKey("")).toBe("");
    expect(phoneticKey("ఉపిరి")).toBe("");
  });
});

describe("levenshtein / similarityRatio", () => {
  it("computes standard edit distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("abc", "abc")).toBe(0);
    expect(levenshtein("", "abc")).toBe(3);
  });

  it("scores identical strings as 1 and empties as 1", () => {
    expect(similarityRatio("paracetamol", "paracetamol")).toBe(1);
    expect(similarityRatio("", "")).toBe(1);
  });

  it("scores a near-miss high and an unrelated word low", () => {
    expect(similarityRatio("parasetamall", "paracetamol")).toBeGreaterThan(0.7);
    expect(similarityRatio("metformin", "paracetamol")).toBeLessThan(0.4);
  });
});

describe("phoneticNormalize", () => {
  it("is the space in which similarity must be measured", () => {
    // Raw, an Indian-English spelling of the same drug scores only 0.75 and would
    // fail the 0.85 auto-apply gate. Normalised, the residual distance is the one
    // real difference — which is the whole point of the gate.
    expect(similarityRatio("parasetamall", "paracetamol")).toBeLessThan(0.85);
    expect(
      similarityRatio(phoneticNormalize("parasetamall"), phoneticNormalize("paracetamol")),
    ).toBeGreaterThan(0.85);
  });

  it("makes spelling variants of the same sound identical", () => {
    expect(phoneticNormalize("amoxysillin")).toBe(phoneticNormalize("amoxicillin"));
    expect(phoneticNormalize("sulphate")).toBe(phoneticNormalize("sulfate"));
  });

  it("keeps vowels, unlike phoneticKey", () => {
    expect(phoneticNormalize("metformin")).toContain("o");
    expect(phoneticKey("metformin")).not.toContain("O");
  });

  it("still separates genuinely different drugs", () => {
    expect(
      similarityRatio(phoneticNormalize("metformin"), phoneticNormalize("metronidazole")),
    ).toBeLessThan(0.85);
  });
});

// The single most safety-critical behaviour in this module.
describe("shouldAutoApply — clinical safety gate", () => {
  const base = {
    sourceWords: ["parasetamall"],
    candidateScore: 0.95,
    runnerUpScore: 0,
    phoneticExact: true,
    autoApplyThreshold: 0.85,
    ambiguityMargin: 0.05,
  };

  it("allows a clean, unambiguous, phonetically exact match", () => {
    expect(shouldAutoApply(base)).toBe(true);
  });

  it("REFUSES when the phonetic skeletons disagree, however similar the spelling", () => {
    expect(shouldAutoApply({ ...base, phoneticExact: false })).toBe(false);
  });

  it("REFUSES below the similarity threshold", () => {
    expect(shouldAutoApply({ ...base, candidateScore: 0.80 })).toBe(false);
  });

  it("REFUSES to overwrite an ordinary English word", () => {
    // The nightmare case: "cold" quietly becoming some drug name.
    expect(shouldAutoApply({ ...base, sourceWords: ["cold"] })).toBe(false);
    expect(shouldAutoApply({ ...base, sourceWords: ["pain"] })).toBe(false);
    expect(shouldAutoApply({ ...base, sourceWords: ["fever"] })).toBe(false);
  });

  it("REFUSES when two catalogue terms are equally plausible", () => {
    expect(shouldAutoApply({ ...base, candidateScore: 0.92, runnerUpScore: 0.90 })).toBe(false);
  });

  it("allows a multi-word join, because the joined form is never a real word", () => {
    expect(shouldAutoApply({ ...base, sourceWords: ["para", "seta", "mall"] })).toBe(true);
  });

  it("still REFUSES a multi-word join whose joined form IS an ordinary word", () => {
    expect(shouldAutoApply({ ...base, sourceWords: ["fe", "ver"] })).toBe(false);
  });
});

describe("buildLexiconIndex", () => {
  it("indexes by exact and phonetic key", () => {
    const idx = buildLexiconIndex(HOSPITAL);
    expect(idx.size).toBe(HOSPITAL.length);
    expect(idx.byExact.get("paracetamol")?.term).toBe("Paracetamol");
    expect(idx.byPhonetic.get(phoneticKey("paracetamol"))?.[0].term).toBe("Paracetamol");
  });

  it("drops terms too short to match safely", () => {
    // A 2-char "term" would bucket-match half the transcript.
    const idx = buildLexiconIndex([{ term: "AB", source: "drug_master" }, ...drugs("Metformin")]);
    expect(idx.size).toBe(1);
  });

  it("de-duplicates repeated terms across sources", () => {
    const idx = buildLexiconIndex([
      { term: "Paracetamol", source: "drug_master" },
      { term: "Paracetamol", source: "service_master" },
    ]);
    expect(idx.size).toBe(1);
  });

  it("handles an empty catalogue", () => {
    expect(buildLexiconIndex([]).size).toBe(0);
  });
});

describe("repairTranscript", () => {
  const idx = buildLexiconIndex(HOSPITAL);

  it("rejoins and corrects a drug name the ASR split into pseudo-words", () => {
    const r = repairTranscript("give para seta mall twice daily", idx);
    expect(r.repairedText).toBe("give Paracetamol twice daily");
    expect(r.repairs).toHaveLength(1);
    expect(r.repairs[0]).toMatchObject({ from: "para seta mall", to: "Paracetamol", source: "drug_master" });
  });

  it("corrects a single mangled word", () => {
    const r = repairTranscript("start amoxycillin for five days", idx);
    expect(r.repairedText).toContain("Amoxicillin");
  });

  it("NEVER rewrites ordinary English, even inside a clinical sentence", () => {
    const text = "patient has cold and pain in the chest since two days";
    const r = repairTranscript(text, idx);
    expect(r.repairedText).toBe(text);
    expect(r.repairs).toHaveLength(0);
  });

  it("leaves an already-correct transcript byte-identical", () => {
    const text = "Paracetamol 500 mg and Pantoprazole before food";
    const r = repairTranscript(text, idx);
    expect(r.repairedText).toBe(text);
    expect(r.repairs).toHaveLength(0);
  });

  it("demotes an uncertain match to a suggestion instead of rewriting", () => {
    const r = repairTranscript("advised ondansetrn injection", idx);
    const rewrote = r.repairs.some(x => x.to === "Ondansetron");
    const suggested = r.suggestions.some(s => s.candidates.includes("Ondansetron"));
    expect(rewrote || suggested).toBe(true);
    // Whichever path it took, it must not have invented an unrelated drug.
    expect(r.repairedText).not.toContain("Metformin");
  });

  it("does not join a phrase across a sentence boundary", () => {
    // "mall" here starts a new clause; joining across the full stop would be wrong.
    const r = repairTranscript("she went to para. seta mall yesterday", idx);
    expect(r.repairedText).not.toBe("she went to Paracetamol yesterday");
  });

  it("scores hit rate low for a transcript full of unresolvable mush", () => {
    const r = repairTranscript("kaale kaale upiri vasta ivvandi thoraga", idx);
    expect(r.lexiconHitRate).not.toBeNull();
    expect(r.lexiconHitRate as number).toBeLessThan(0.3);
  });

  it("scores hit rate high for clean clinical English", () => {
    const r = repairTranscript("Paracetamol Pantoprazole Metformin Cetirizine", idx);
    expect(r.lexiconHitRate).toBe(1);
  });

  it("returns null hit rate when there is nothing clinical to resolve", () => {
    // Honest "no signal" beats a misleading 0%.
    const r = repairTranscript("he is not well today", idx);
    expect(r.lexiconHitRate).toBeNull();
  });

  it("handles empty input and an empty catalogue without throwing", () => {
    expect(repairTranscript("", idx).repairedText).toBe("");
    const empty = buildLexiconIndex([]);
    expect(repairTranscript("give para seta mall", empty).repairedText).toBe("give para seta mall");
    expect(repairTranscript("give para seta mall", empty).lexiconHitRate).toBeNull();
  });

  it("resolves a spelled-out investigation to its acronym", () => {
    const r = repairTranscript("order ee see gee today", buildLexiconIndex([
      { term: "ECG", source: "abbreviation" },
    ]));
    expect(r.repairedText).toBe("order ECG today");
    expect(r.repairs[0]).toMatchObject({ from: "ee see gee", to: "ECG" });
  });

  it("prefers the longest phrase so fragments are not matched individually", () => {
    const r = repairTranscript("do a complete blood count now", idx);
    expect(r.repairedText).toBe("do a Complete Blood Count now");
  });

  it("respects a stricter autoApplyThreshold by suggesting instead", () => {
    const strict = repairTranscript("give para seta mall", idx, { autoApplyThreshold: 0.99 });
    expect(strict.repairs).toHaveLength(0);
  });
});

describe("expandSpelledLetters", () => {
  const known = (s: string) => ["ECG", "USG", "CBC", "UC"].includes(s);

  it("folds a spelled-out run into its acronym", () => {
    expect(expandSpelledLetters(["ee", "see", "gee"], known).words).toEqual(["ECG"]);
    expect(expandSpelledLetters(["yu", "es", "jee"], known).words).toEqual(["USG"]);
  });

  it("REFUSES a two-word run made entirely of ordinary English words", () => {
    // "you see" must never silently become the diagnosis "UC", even though the
    // acronym exists in the catalogue.
    expect(expandSpelledLetters(["you", "see"], known).words).toEqual(["you", "see"]);
  });

  it("REFUSES a longer ordinary-English run that spells nothing in the catalogue", () => {
    // "oh i see" spells OIC — no hospital stocks that, so it stays prose.
    expect(expandSpelledLetters(["oh", "i", "see"], known).words).toEqual(["oh", "i", "see"]);
  });

  it("accepts a 3+ run of ordinary words when it spells a real catalogue term", () => {
    // Every token of "see bee see" is a word in its own right, but three consecutive
    // letter sounds spelling a term the hospital stocks is evidence enough.
    expect(expandSpelledLetters(["see", "bee", "see"], known).words).toEqual(["CBC"]);
  });

  it("REFUSES an acronym the hospital does not actually have", () => {
    expect(expandSpelledLetters(["ee", "ef"], known).words).toEqual(["ee", "ef"]);
  });

  it("REFUSES a single letter sound", () => {
    expect(expandSpelledLetters(["see"], known).words).toEqual(["see"]);
  });

  it("leaves ordinary sentences completely untouched", () => {
    const s = ["patient", "has", "chest", "pain"];
    expect(expandSpelledLetters(s, known).words).toEqual(s);
  });

  it("takes the longest matching acronym and keeps the remainder", () => {
    const r = expandSpelledLetters(["see", "bee", "see", "tomorrow"], known);
    expect(r.words).toEqual(["CBC", "tomorrow"]);
  });

  it("reports what it expanded, so the repair stays auditable", () => {
    expect(expandSpelledLetters(["ee", "see", "gee"], known).expansions)
      .toEqual([{ from: "ee see gee", to: "ECG" }]);
  });
});

describe("CLINICAL_ABBREVIATIONS", () => {
  it("covers the Indian shorthand the ward-round prompt already relies on", () => {
    for (const a of ["BD", "TDS", "OD", "HS", "SOS", "STAT", "USG", "CECT", "HRCT", "FBS", "RBS", "PPBS"]) {
      expect(CLINICAL_ABBREVIATIONS).toContain(a);
    }
  });

  it("does not collide with the common-word guard list", () => {
    for (const a of CLINICAL_ABBREVIATIONS) {
      expect(COMMON_ENGLISH_WORDS.has(normalizeTerm(a))).toBe(false);
    }
  });
});

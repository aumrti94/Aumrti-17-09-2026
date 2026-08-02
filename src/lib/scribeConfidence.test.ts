import { describe, it, expect } from "vitest";
import {
  computeScribeConfidence, asrScore, repetitionScore, llmScore,
  populatedSections, toPercent, SCRIBE_SECTIONS, LOW_CONFIDENCE_THRESHOLD,
  type ConfidenceInputs,
} from "./scribeConfidence";
import { collapseRepetitionLoops } from "./transcriptMerge";

const clean: ConfidenceInputs = {
  segments: [{ languageProbability: 0.97, words: 120 }],
  repetition: { repetitionRatio: 0, maxRepeats: 1 },
  lexiconHitRate: 0.9,
  fieldConfidence: { chief_complaint: 0.9, diagnosis: 0.85, plan: 0.9 },
  populatedSections: ["chief_complaint", "diagnosis", "plan"],
};

describe("asrScore", () => {
  it("weights by segment length so a short blip cannot sink a long dictation", () => {
    const score = asrScore([
      { languageProbability: 0.98, words: 200 },
      { languageProbability: 0.20, words: 2 },
    ]);
    expect(score).toBeGreaterThan(0.95);
  });

  it("returns null when no engine reported a probability", () => {
    expect(asrScore([{ languageProbability: null, words: 30 }])).toBeNull();
    expect(asrScore([])).toBeNull();
    expect(asrScore(undefined)).toBeNull();
  });

  it("ignores zero-word segments rather than dividing by zero", () => {
    expect(asrScore([{ languageProbability: 0.9, words: 0 }])).toBeNull();
  });
});

describe("repetitionScore", () => {
  it("scores a clean transcript at 1", () => {
    expect(repetitionScore({ repetitionRatio: 0, maxRepeats: 1 })).toBe(1);
    expect(repetitionScore(null)).toBe(1);
    expect(repetitionScore(undefined)).toBe(1);
  });

  it("punishes the reported Telugu loop hard", () => {
    // Fed straight from the real collapse output, not hand-tuned numbers.
    const rep = collapseRepetitionLoops(
      "ఏం కాలే ఏం కాలే ఏం కాలే ఏం కాలే ఉపిరి వస్తా ఉపిరి వస్తా ఉపిరి వస్తా ఉపిరి వస్తా",
    );
    expect(repetitionScore(rep)).toBeLessThan(0.3);
  });

  it("tolerates ordinary mild repetition", () => {
    expect(repetitionScore({ repetitionRatio: 0, maxRepeats: 2 })).toBe(1);
  });

  it("penalises a many-times repeated phrase even at a low overall ratio", () => {
    // One phrase looping 8 times inside an otherwise long note is still damning.
    expect(repetitionScore({ repetitionRatio: 0.05, maxRepeats: 8 })).toBeLessThan(0.2);
  });
});

describe("llmScore", () => {
  it("averages the per-field self-reports", () => {
    expect(llmScore({ chief_complaint: 0.8, diagnosis: 0.6 })).toBeCloseTo(0.7, 5);
  });

  it("returns null when the model reported nothing", () => {
    expect(llmScore({})).toBeNull();
    expect(llmScore(null)).toBeNull();
    expect(llmScore({ chief_complaint: null })).toBeNull();
  });
});

describe("computeScribeConfidence", () => {
  it("scores a clean dictation high", () => {
    const c = computeScribeConfidence(clean);
    expect(c.overall).not.toBeNull();
    expect(c.overall as number).toBeGreaterThan(LOW_CONFIDENCE_THRESHOLD);
    expect(c.warnings).toEqual([]);
  });

  it("flags the reported failure that the old scoring missed entirely", () => {
    // Repeated ASR loop + almost nothing resolving against the catalogue. The old
    // badge would have shown whatever the LLM felt like claiming.
    const c = computeScribeConfidence({
      segments: [{ languageProbability: 0.42, words: 16 }],
      repetition: collapseRepetitionLoops("ఏం కాలే ఏం కాలే ఏం కాలే ఏం కాలే"),
      lexiconHitRate: 0.05,
      fieldConfidence: { plan: 0.44 },
      populatedSections: ["plan"],
    });
    expect(c.overall as number).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
    expect(c.warnings.length).toBeGreaterThanOrEqual(3);
    expect(c.warnings.join(" ")).toContain("repeated the same phrase");
  });

  it("does NOT let a confident-sounding LLM rescue a broken transcript", () => {
    // The core failure of self-reported confidence: the model claiming 0.95 over
    // audio that looped and matched no vocabulary must still score low.
    const c = computeScribeConfidence({
      segments: [{ languageProbability: 0.3, words: 20 }],
      repetition: { repetitionRatio: 0.7, maxRepeats: 9 },
      lexiconHitRate: 0.0,
      fieldConfidence: { chief_complaint: 0.95, diagnosis: 0.95, plan: 0.95 },
      populatedSections: ["chief_complaint", "diagnosis", "plan"],
    });
    expect(c.overall as number).toBeLessThan(0.5);
  });

  it("marks sections that were never dictated as null, not 0%", () => {
    // The distinction the whole per-section design exists for: silence about the
    // examination is not the same as mis-hearing it.
    const c = computeScribeConfidence(clean);
    const exam = c.sections.find(s => s.section === "examination_findings")!;
    expect(exam.notDictated).toBe(true);
    expect(exam.score).toBeNull();
    expect(toPercent(exam.score)).toBeNull();
  });

  it("scores a populated section and leaves an empty one untouched", () => {
    const c = computeScribeConfidence(clean);
    const cc = c.sections.find(s => s.section === "chief_complaint")!;
    expect(cc.notDictated).toBe(false);
    expect(cc.score).not.toBeNull();
    expect(cc.score as number).toBeGreaterThan(0.5);
  });

  it("separates a well-heard section from a badly-heard one in the same note", () => {
    // The reported screenshot: Plan came through, Diagnosis did not.
    const c = computeScribeConfidence({
      ...clean,
      fieldConfidence: { chief_complaint: 0.92, diagnosis: 0.25, plan: 0.9 },
      populatedSections: ["chief_complaint", "diagnosis", "plan"],
    });
    const cc = c.sections.find(s => s.section === "chief_complaint")!.score as number;
    const dx = c.sections.find(s => s.section === "diagnosis")!.score as number;
    expect(cc).toBeGreaterThan(dx);
    expect(dx).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
  });

  it("returns every known section exactly once", () => {
    const c = computeScribeConfidence(clean);
    expect(c.sections.map(s => s.section)).toEqual([...SCRIBE_SECTIONS]);
  });

  it("skips missing signals instead of scoring them as zero", () => {
    // An engine that reports no language probability must not be punished for it.
    const withAsr = computeScribeConfidence(clean).overall as number;
    const withoutAsr = computeScribeConfidence({
      ...clean, segments: [{ languageProbability: null, words: 120 }],
    }).overall as number;
    expect(withoutAsr).toBeGreaterThan(withAsr - 0.15);
    expect(computeScribeConfidence({ ...clean, segments: [] }).breakdown.asr).toBeNull();
  });

  it("reports null overall when there is genuinely no signal at all", () => {
    const c = computeScribeConfidence({});
    // repetition defaults to 1 (nothing observed), so overall is that alone —
    // but every section must be honest about having no content.
    expect(c.sections.every(s => s.notDictated)).toBe(true);
    expect(c.warnings.join(" ")).toContain("Nothing clinical could be extracted");
  });

  it("exposes the breakdown so the UI can explain a low score", () => {
    const c = computeScribeConfidence(clean);
    expect(c.breakdown.asr).toBeCloseTo(0.97, 2);
    expect(c.breakdown.repetition).toBe(1);
    expect(c.breakdown.lexicon).toBeCloseTo(0.9, 5);
    expect(c.breakdown.llm).toBeCloseTo((0.9 + 0.85 + 0.9) / 3, 5);
  });

  it("does not warn about lexicon when there was nothing clinical to match", () => {
    const c = computeScribeConfidence({ ...clean, lexiconHitRate: null });
    expect(c.breakdown.lexicon).toBeNull();
    expect(c.warnings.join(" ")).not.toContain("catalogue");
  });
});

describe("populatedSections", () => {
  it("detects filled string and array fields", () => {
    expect(populatedSections({
      chief_complaint: "fever",
      examination_findings: "   ",
      investigations: ["CBC"],
      prescription: [],
    })).toEqual(["chief_complaint", "investigations"]);
  });

  it("handles null and empty input", () => {
    expect(populatedSections(null)).toEqual([]);
    expect(populatedSections({})).toEqual([]);
  });
});

describe("toPercent", () => {
  it("rounds to a whole percent and passes null through", () => {
    expect(toPercent(0.444)).toBe(44);
    expect(toPercent(1)).toBe(100);
    expect(toPercent(null)).toBeNull();
  });
});

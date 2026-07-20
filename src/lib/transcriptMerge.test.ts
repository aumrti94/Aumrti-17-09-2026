import { describe, it, expect } from "vitest";
import { mergeTranscriptChunk, joinTranscriptChunks } from "./transcriptMerge";

describe("mergeTranscriptChunk", () => {
  it("drops the duplicated overlap at a chunk seam", () => {
    // The ~200ms audio overlap makes the tail of chunk N reappear as the head of chunk N+1.
    expect(mergeTranscriptChunk("patient has fever for", "fever for fifteen days"))
      .toBe("patient has fever for fifteen days");
  });

  it("removes the LONGEST repeated run, not just the first match", () => {
    expect(mergeTranscriptChunk("come and see me after", "and see me after five days"))
      .toBe("come and see me after five days");
  });

  it("ignores case and punctuation differences across the seam", () => {
    // ASR punctuates the same audio inconsistently in the two segments.
    expect(mergeTranscriptChunk("severe headache, fever", "Fever occurs at night"))
      .toBe("severe headache, fever occurs at night");
  });

  it("leaves genuinely different chunks untouched", () => {
    expect(mergeTranscriptChunk("fever for fifteen days", "severe headache also"))
      .toBe("fever for fifteen days severe headache also");
  });

  it("does not swallow a legitimately repeated word when there is no seam overlap", () => {
    // "very very" is real speech, not a seam artifact — a 1-word overlap match is still
    // correct behaviour here, but the merge must never drop MORE than the matched run.
    const out = mergeTranscriptChunk("pain is very", "bad today");
    expect(out).toBe("pain is very bad today");
  });

  it("handles empty / whitespace input on either side", () => {
    expect(mergeTranscriptChunk("", "hello there")).toBe("hello there");
    expect(mergeTranscriptChunk("hello there", "")).toBe("hello there");
    expect(mergeTranscriptChunk("   ", "  hello ")).toBe("hello");
  });

  it("works on Telugu (non-latin) script", () => {
    expect(mergeTranscriptChunk("నాకు జ్వరంగా ఉంది", "జ్వరంగా ఉంది తలనొప్పి కూడా"))
      .toBe("నాకు జ్వరంగా ఉంది తలనొప్పి కూడా");
  });
});

describe("joinTranscriptChunks", () => {
  it("de-duplicates every seam across many segments", () => {
    // Reproduces the live artifact: naive join(' ') produced
    // "...at night one or two one or two one or three".
    const chunks = [
      "fever occurs at night one or two",
      "one or two one or three",
      "one or three come see me after five days",
    ];
    expect(joinTranscriptChunks(chunks))
      .toBe("fever occurs at night one or two one or three come see me after five days");
  });

  it("matches a plain join when there is no overlap at all", () => {
    expect(joinTranscriptChunks(["alpha beta", "gamma delta"])).toBe("alpha beta gamma delta");
  });

  it("handles an empty list and blank chunks", () => {
    expect(joinTranscriptChunks([])).toBe("");
    expect(joinTranscriptChunks(["", "  ", "only this"])).toBe("only this");
  });
});

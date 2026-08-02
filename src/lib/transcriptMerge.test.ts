import { describe, it, expect } from "vitest";
import { mergeTranscriptChunk, joinTranscriptChunks, collapseRepetitionLoops } from "./transcriptMerge";

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

describe("collapseRepetitionLoops", () => {
  it("collapses the live Telugu ASR loop from the reported dictation", () => {
    // Verbatim from the failing screenshot: the recognizer got stuck and repeated
    // two phrases over and over, filling the transcript box with nothing.
    const stuck = "ఏం కాలే ఏం కాలే ఏం కాలే ఏం కాలే ఉపిరి వస్తా ఉపిరి వస్తా ఉపిరి వస్తా ఉపిరి వస్తా";
    const r = collapseRepetitionLoops(stuck);
    expect(r.text).toBe("ఏం కాలే ఉపిరి వస్తా");
    expect(r.maxRepeats).toBe(4);
    expect(r.removedWords).toBe(12);
    expect(r.repetitionRatio).toBeCloseTo(12 / 16, 5);
  });

  it("keeps ONE occurrence — the doctor did say it once", () => {
    const r = collapseRepetitionLoops("chest pain chest pain chest pain chest pain chest pain");
    expect(r.text).toBe("chest pain");
  });

  it("leaves normal repeated speech alone below the threshold", () => {
    // "very very tender" and "no no" are real speech, not a loop.
    const r = collapseRepetitionLoops("abdomen is very very tender no no guarding");
    expect(r.text).toBe("abdomen is very very tender no no guarding");
    expect(r.removedWords).toBe(0);
  });

  it("reports maxRepeats even when nothing crosses the threshold", () => {
    // Signal for the confidence score: mild repetition is still worth knowing about.
    const r = collapseRepetitionLoops("cough cough cough and fever");
    expect(r.text).toBe("cough cough cough and fever");
    expect(r.maxRepeats).toBe(3);
  });

  it("collapses multi-word phrases rather than shredding them word by word", () => {
    const r = collapseRepetitionLoops(
      "take one tablet take one tablet take one tablet take one tablet after food",
    );
    expect(r.text).toBe("take one tablet after food");
  });

  it("ignores case and punctuation when detecting a loop", () => {
    const r = collapseRepetitionLoops("Fever, fever. FEVER fever fever since morning");
    expect(r.text).toBe("Fever, since morning");
  });

  it("preserves the original (unnormalised) words it keeps", () => {
    // Output must stay verbatim — normalisation is for comparison only.
    const r = collapseRepetitionLoops("Paracetamol, Paracetamol, Paracetamol, Paracetamol, 500 mg");
    expect(r.text).toBe("Paracetamol, 500 mg");
  });

  it("handles empty and whitespace-only input", () => {
    expect(collapseRepetitionLoops("").text).toBe("");
    expect(collapseRepetitionLoops("   ").text).toBe("");
    expect(collapseRepetitionLoops("").repetitionRatio).toBe(0);
    expect(collapseRepetitionLoops("").maxRepeats).toBe(1);
  });

  it("leaves a clean transcript completely untouched", () => {
    const clean = "patient complains of shortness of breath for three days no fever";
    const r = collapseRepetitionLoops(clean);
    expect(r.text).toBe(clean);
    expect(r.repetitionRatio).toBe(0);
    expect(r.maxRepeats).toBe(1);
  });

  it("respects a custom threshold", () => {
    const r = collapseRepetitionLoops("pain pain pain", { threshold: 2 });
    expect(r.text).toBe("pain");
  });
});

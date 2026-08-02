// Composite confidence for voice-scribe notes.
//
// WHY THIS EXISTS
// The "Low confidence (44%)" badge used to be nothing but the structuring LLM's own
// guess about itself — the model was asked to emit a `confidence` float and the panel
// rendered it. Nothing measured ever reached that number: not the ASR, not the audio,
// not whether the drug names resolved. A model that hallucinated a confident-sounding
// note reported high confidence for it, and a transcript that came back as the same
// Telugu phrase repeated twelve times still got a number that looked like a real score.
//
// This replaces it with signal that is actually observed:
//
//   ASR             Sarvam's `language_probability` (see the honesty note below)
//   repetition      runaway phrase loops from collapseRepetitionLoops()
//   lexicon         did the clinical vocabulary resolve against the hospital catalogue
//   LLM per-field   the model's self-report, kept as ONE input rather than the answer
//
// HONESTY NOTE ON THE ASR TERM
// `language_probability` is Sarvam's confidence that it identified the spoken LANGUAGE
// correctly. It is NOT a word-level transcription confidence — the REST API does not
// expose one. It is a genuine but partial signal (a model unsure what language it is
// hearing is usually hearing badly), so it is deliberately given a floor and blended
// rather than multiplied raw. The load-bearing signals are repetition and lexicon hit
// rate, both of which are measured directly from the transcript.

import type { RepetitionResult } from "./transcriptMerge";

/** Sections a structured note can carry a confidence for. */
export const SCRIBE_SECTIONS = [
  "chief_complaint",
  "history_of_present_illness",
  "examination_findings",
  // The UI has always had two examination boxes (General, and Systemic / Clinical Notes)
  // while the AI schema had one, so the systemic box could never be filled by dictation.
  "systemic_examination",
  "diagnosis",
  "plan",
  "follow_up",
  "prescription",
  "investigations",
] as const;

export type ScribeSection = (typeof SCRIBE_SECTIONS)[number];

export interface SegmentSignal {
  /** Sarvam `language_probability`, 0-1, or null when the engine returned none. */
  languageProbability: number | null;
  /** Word count of this segment's transcript — used to weight its influence. */
  words: number;
}

export interface ConfidenceInputs {
  segments?: readonly SegmentSignal[];
  repetition?: Pick<RepetitionResult, "repetitionRatio" | "maxRepeats"> | null;
  /** From repairTranscript(); null when the transcript had nothing clinical in it. */
  lexiconHitRate?: number | null;
  /** The LLM's per-field self-report. Missing/null means "the model said nothing". */
  fieldConfidence?: Partial<Record<ScribeSection, number | null>> | null;
  /** Which sections actually came back with content. */
  populatedSections?: readonly ScribeSection[];
}

export interface SectionConfidence {
  section: ScribeSection;
  /** 0-1, or null when the section was never dictated (render as "—", not as 0%). */
  score: number | null;
  /** True when the section is empty because nothing was said about it. */
  notDictated: boolean;
}

export interface ScribeConfidence {
  /** Overall 0-1, or null when there is genuinely no signal to report. */
  overall: number | null;
  sections: SectionConfidence[];
  /** Component scores, surfaced so the UI can explain WHY a note scored low. */
  breakdown: {
    asr: number | null;
    repetition: number;
    lexicon: number | null;
    llm: number | null;
  };
  /** Human-readable reasons, worst first. Empty when the note looks healthy. */
  warnings: string[];
}

/** Below this the panel shows the amber "please review carefully" banner. */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Length-weighted mean of per-segment language probability.
 *
 * Weighted because a 2-word segment that Sarvam was unsure about should not drag down
 * a 200-word dictation it handled cleanly.
 */
export function asrScore(segments: readonly SegmentSignal[] | undefined): number | null {
  const usable = (segments ?? []).filter(
    s => typeof s.languageProbability === "number" && s.words > 0,
  );
  if (usable.length === 0) return null;

  const totalWords = usable.reduce((sum, s) => sum + s.words, 0);
  if (totalWords === 0) return null;
  const weighted = usable.reduce(
    (sum, s) => sum + (s.languageProbability as number) * s.words, 0,
  );
  return clamp01(weighted / totalWords);
}

/**
 * Penalty in 0-1 (1 = no repetition) for runaway ASR loops.
 *
 * Deliberately harsh. The reported failure — the same Telugu phrase emitted over and
 * over — is the single most reliable "this audio was not understood" signal available,
 * and the old scoring missed it entirely.
 */
export function repetitionScore(
  rep: Pick<RepetitionResult, "repetitionRatio" | "maxRepeats"> | null | undefined,
): number {
  if (!rep) return 1;
  const ratio = clamp01(rep.repetitionRatio ?? 0);
  // A quarter of the words being loop repetitions is already a broken transcript.
  const fromRatio = clamp01(1 - ratio * 2);
  // Independently, a single phrase repeating many times is damning on its own.
  const repeats = Math.max(1, rep.maxRepeats ?? 1);
  const fromRepeats = repeats <= 2 ? 1 : clamp01(1 - (repeats - 2) * 0.15);
  return Math.min(fromRatio, fromRepeats);
}

/** Mean of the LLM's per-field self-reports, or null if it reported none. */
export function llmScore(
  fieldConfidence: Partial<Record<ScribeSection, number | null>> | null | undefined,
): number | null {
  const values = Object.values(fieldConfidence ?? {}).filter(
    (v): v is number => typeof v === "number",
  );
  if (values.length === 0) return null;
  return clamp01(values.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Combine the available signals.
 *
 * Missing signals are SKIPPED rather than treated as zero — an engine that returns no
 * language probability must not be punished for it. Weights favour the two signals
 * measured directly from the transcript over the two that are self-reported or proxied.
 */
function combine(parts: { value: number | null; weight: number }[]): number | null {
  const present = parts.filter(p => p.value !== null);
  if (present.length === 0) return null;
  const totalWeight = present.reduce((s, p) => s + p.weight, 0);
  if (totalWeight === 0) return null;
  return clamp01(
    present.reduce((s, p) => s + (p.value as number) * p.weight, 0) / totalWeight,
  );
}

/**
 * Geometric mean, used for SECTION scores specifically.
 *
 * A section is only trustworthy if the transcript it came from was good AND the model
 * was sure about that particular field. An arithmetic mean lets one rescue the other:
 * a clean recording would drag a diagnosis the model itself rated 0.25 up to ~0.61 and
 * out of the review banner, which is precisely the wrong answer — that diagnosis is
 * exactly what a doctor needs to check. The geometric mean scores it 0.49 and flags it.
 *
 * Nulls are skipped, so a signal that was never observed neither helps nor hurts.
 */
function geometricMean(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  const product = present.reduce((p, v) => p * clamp01(v), 1);
  return clamp01(Math.pow(product, 1 / present.length));
}

export function computeScribeConfidence(inputs: ConfidenceInputs): ScribeConfidence {
  const asr = asrScore(inputs.segments);
  const repetition = repetitionScore(inputs.repetition);
  const lexicon = typeof inputs.lexiconHitRate === "number"
    ? clamp01(inputs.lexiconHitRate)
    : null;
  const llm = llmScore(inputs.fieldConfidence);

  // The transcript-level quality every section inherits.
  const transcriptQuality = combine([
    { value: asr, weight: 1 },
    { value: repetition, weight: 3 },
    { value: lexicon, weight: 2 },
  ]);

  const populated = new Set(inputs.populatedSections ?? []);
  const sections: SectionConfidence[] = SCRIBE_SECTIONS.map(section => {
    const field = inputs.fieldConfidence?.[section];
    const hasContent = populated.has(section);

    // Nothing said about it AND the model claimed nothing → not dictated, not "0%".
    if (!hasContent && (field === null || field === undefined)) {
      return { section, score: null, notDictated: true };
    }

    const score = geometricMean([
      transcriptQuality,
      typeof field === "number" ? clamp01(field) : null,
    ]);
    return { section, score, notDictated: false };
  });

  const overall = combine([
    { value: asr, weight: 1 },
    { value: repetition, weight: 3 },
    { value: lexicon, weight: 2 },
    { value: llm, weight: 2 },
  ]);

  const warnings: string[] = [];
  if (repetition < 0.5) {
    warnings.push("The recogniser repeated the same phrase — the audio was likely unclear.");
  }
  if (lexicon !== null && lexicon < 0.3) {
    warnings.push("Few medical terms matched your hospital's catalogue.");
  }
  if (asr !== null && asr < 0.5) {
    warnings.push("The speech engine was unsure which language it was hearing.");
  }
  if (sections.every(s => s.notDictated)) {
    warnings.push("Nothing clinical could be extracted from this dictation.");
  }

  return { overall, sections, breakdown: { asr, repetition, lexicon, llm }, warnings };
}

/** Which sections of a structured note actually carry content. */
export function populatedSections(
  data: Record<string, unknown> | null | undefined,
): ScribeSection[] {
  if (!data) return [];
  return SCRIBE_SECTIONS.filter(section => {
    const v = data[section];
    if (typeof v === "string") return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return false;
  });
}

/** Percent for display, or null when there is no score to show. */
export function toPercent(score: number | null): number | null {
  return score === null ? null : Math.round(score * 100);
}

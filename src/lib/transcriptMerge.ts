// Long dictation is split into ~25s audio segments because Sarvam caps a request at 30s.
// To avoid dropping speech at a boundary, the next segment deliberately starts SEGMENT_OVERLAP_MS
// BEFORE the previous one stops (see VoiceDictationButton "OVERLAPPING segments (gapless)").
//
// That overlap means the same slice of speech is transcribed TWICE — once at the tail of
// segment N and once at the head of segment N+1. Naively `join(" ")`-ing the chunk transcripts
// therefore injects DUPLICATED words at every 25-second boundary, which corrupts the transcript
// the structuring LLM then reads (observed live as "...as one or two one or three").
//
// mergeTranscriptChunk stitches the seam: it finds the longest word-run that is both a suffix of
// what we already have and a prefix of the incoming chunk, and drops that repeat. Comparison is
// case/punctuation-insensitive because ASR punctuates the same audio inconsistently across
// segments. Returns the ORIGINAL (unnormalised) words so the transcript stays verbatim.

/** Normalise a word for overlap comparison only — never for output. */
const norm = (w: string): string =>
  w.toLowerCase().replace(/[.,!?;:।॥"'`()[\]{}—–-]/g, "");

/**
 * Append `next` to `prev`, removing the duplicated overlap region if there is one.
 *
 * @param maxOverlapWords upper bound on how many words the seam may repeat.
 *
 *   This window used to be 15, which was far larger than the seam it exists to clean. The
 *   deliberate overlap is ~800ms of audio ≈ 1-3 words, but the search takes the LONGEST
 *   match it can find — so a 15-word window could match on speech that merely REPEATS near
 *   a boundary ("pain, pain on the left side") and delete a dozen words the doctor actually
 *   said. Sized to the real overlap, the search can only remove what the overlap could
 *   plausibly have duplicated. It also keeps this O(n·window).
 */
export function mergeTranscriptChunk(prev: string, next: string, maxOverlapWords = 4): string {
  const a = (prev ?? "").trim();
  const b = (next ?? "").trim();
  if (!a) return b;
  if (!b) return a;

  const aw = a.split(/\s+/);
  const bw = b.split(/\s+/);
  const window = Math.min(maxOverlapWords, aw.length, bw.length);

  // Prefer the LONGEST repeated run so we don't leave a partial duplicate behind.
  for (let n = window; n > 0; n--) {
    let same = true;
    for (let i = 0; i < n; i++) {
      if (norm(aw[aw.length - n + i]) !== norm(bw[i])) { same = false; break; }
    }
    if (same) return [...aw, ...bw.slice(n)].join(" ");
  }
  return `${a} ${b}`;
}

/** Fold a list of per-segment transcripts into one transcript, de-duplicating each seam. */
export function joinTranscriptChunks(chunks: string[], maxOverlapWords = 4): string {
  return (chunks ?? []).reduce((acc, c) => mergeTranscriptChunk(acc, c, maxOverlapWords), "").trim();
}

// ── Repetition-loop collapse ────────────────────────────────────────────────
//
// mergeTranscriptChunk only fixes the SEAM between two segments. It cannot help with
// a loop *inside* one segment, where the ASR gets stuck and emits the same phrase over
// and over — observed live on a Telugu dictation that came back as
// "ఏం కాలే ఏం కాలే ఏం కాలే ఏం కాలే ఉపిరి వస్తా ఉపిరి వస్తా ఉపిరి వస్తా …".
//
// Two things matter about that failure. The obvious one is that it fills the transcript
// box with garbage. The more useful one is that runaway consecutive repetition is one of
// the most RELIABLE signals that a segment's audio was unusable — far more trustworthy
// than the language-detection probability — so the fact that it happened is reported
// back to the caller and feeds the composite confidence score.

export interface RepetitionResult {
  /** Transcript with runaway repeats folded down to a single occurrence. */
  text: string;
  /** How many words were removed as loop repetitions. */
  removedWords: number;
  /** Longest number of consecutive repeats seen for any one phrase (1 = no repetition). */
  maxRepeats: number;
  /** Fraction of the original words that were loop repetitions, 0-1. */
  repetitionRatio: number;
}

/**
 * Collapse any 1..`maxPhraseWords`-word phrase repeating more than `threshold` times
 * consecutively down to a single occurrence.
 *
 * The threshold exists because legitimate speech does repeat a little — "no no",
 * "very very tender", a doctor counting "one two three" — so only *runaway* repetition
 * is treated as an ASR loop. Longer phrases are tested first, otherwise a repeated
 * two-word phrase would be mis-collapsed one word at a time.
 */
export function collapseRepetitionLoops(
  text: string,
  { threshold = 3, maxPhraseWords = 4 }: { threshold?: number; maxPhraseWords?: number } = {},
): RepetitionResult {
  const src = (text ?? "").trim();
  if (!src) return { text: "", removedWords: 0, maxRepeats: 1, repetitionRatio: 0 };

  let words = src.split(/\s+/);
  const originalCount = words.length;
  let maxRepeats = 1;

  for (let phraseLen = Math.min(maxPhraseWords, Math.floor(words.length / 2)); phraseLen >= 1; phraseLen--) {
    const out: string[] = [];
    let i = 0;
    while (i < words.length) {
      const phrase = words.slice(i, i + phraseLen);
      if (phrase.length < phraseLen) { out.push(...words.slice(i)); break; }

      // Count how many times this phrase repeats back-to-back from here.
      let repeats = 1;
      let j = i + phraseLen;
      while (j + phraseLen <= words.length) {
        let same = true;
        for (let k = 0; k < phraseLen; k++) {
          if (norm(words[j + k]) !== norm(phrase[k])) { same = false; break; }
        }
        if (!same) break;
        repeats++;
        j += phraseLen;
      }

      if (repeats > maxRepeats) maxRepeats = repeats;

      if (repeats > threshold) {
        out.push(...phrase);   // keep ONE occurrence — the doctor did say it once
        i = j;
      } else {
        out.push(...phrase);
        i += phraseLen;
      }
    }
    words = out;
  }

  const removedWords = originalCount - words.length;
  return {
    text: words.join(" "),
    removedWords,
    maxRepeats,
    repetitionRatio: originalCount > 0 ? removedWords / originalCount : 0,
  };
}

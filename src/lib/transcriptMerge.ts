// Long dictation is split into ~25s audio segments because Sarvam caps a request at 30s.
// To avoid dropping speech at a boundary, the next segment deliberately starts ~200ms BEFORE
// the previous one stops (see VoiceDictationButton "OVERLAPPING segments (gapless)").
//
// That overlap means the same ~200ms of speech is transcribed TWICE — once at the tail of
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
  w.toLowerCase().replace(/[.,!?;:।॥"'`()\[\]{}—–-]/g, "");

/**
 * Append `next` to `prev`, removing the duplicated overlap region if there is one.
 * @param maxOverlapWords upper bound on how many words the seam may repeat. The overlap is
 *   only ~200ms of audio, so a small window is plenty and keeps this O(n·window).
 */
export function mergeTranscriptChunk(prev: string, next: string, maxOverlapWords = 15): string {
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
export function joinTranscriptChunks(chunks: string[], maxOverlapWords = 15): string {
  return (chunks ?? []).reduce((acc, c) => mergeTranscriptChunk(acc, c, maxOverlapWords), "").trim();
}

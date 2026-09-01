/**
 * ASR language codes — the ONE place the app states what each speech provider accepts.
 *
 * This file exists because the same list used to be written out four times (the scribe
 * catalogue, bhashini-transcribe's langMap, translate-text's two maps, and the settings
 * page), and they had already drifted: the catalogue shipped `or-IN` for Odia and `bo-IN`
 * for Bodo. Sarvam accepts neither — Odia is `od-IN` and Bodo is `brx-IN` (`bo` is
 * Tibetan) — so those two languages could never have transcribed, and nothing failed
 * loudly enough for anyone to notice.
 *
 * CANONICAL FORM: the app speaks Sarvam's BCP-47 codes internally. Bhashini uses bare
 * ISO-639 and DISAGREES on two of them (`od-IN`→`or`, `brx-IN`→`brx`), so provider maps
 * translate outward at the call site rather than each caller guessing.
 *
 * The region between the region:pure markers is duplicated verbatim into
 * supabase/functions/_shared/asr-languages.ts (edge functions cannot import from src/).
 * asrLanguages.parity.test.ts fails if the two drift.
 */

// ── region:pure ────────────────────────────────────────────────────────────

/**
 * Every `language_code` Sarvam's /speech-to-text endpoint accepts, verbatim from its API
 * reference. `unknown` is Sarvam's auto-detect sentinel — the app's "auto" maps onto it.
 *
 * Kept as the full enum rather than "the ones we offer" so validation can reject a bad
 * code with a specific message instead of a 400 from upstream.
 */
export const SARVAM_ASR_CODES = [
  "unknown",
  "en-IN", "hi-IN", "bn-IN", "gu-IN", "kn-IN", "ml-IN", "mr-IN", "od-IN",
  "pa-IN", "ta-IN", "te-IN", "as-IN", "ur-IN", "ne-IN", "kok-IN", "ks-IN",
  "sd-IN", "sa-IN", "sat-IN", "mni-IN", "brx-IN", "mai-IN", "doi-IN",
] as const;

export type SarvamAsrCode = typeof SARVAM_ASR_CODES[number];

const SARVAM_CODE_SET: ReadonlySet<string> = new Set(SARVAM_ASR_CODES);

export function isSarvamAsrCode(code: string | null | undefined): boolean {
  return !!code && SARVAM_CODE_SET.has(code);
}

/**
 * Codes that are easy to get wrong, mapped to the right one, so a rejection can say what
 * to use instead of just "invalid". `or-IN` and `bo-IN` are the two this codebase shipped.
 */
export const SARVAM_CODE_CORRECTIONS: Readonly<Record<string, string>> = {
  "or-IN": "od-IN",   // Odia
  "or": "od-IN",
  "bo-IN": "brx-IN",  // Bodo — `bo` is Tibetan, a different language
  "bo": "brx-IN",
  "ori-IN": "od-IN",
  "brx": "brx-IN",
};

/** Human-readable explanation for a code Sarvam will not accept. */
export function explainBadSarvamCode(code: string): string {
  const fix = SARVAM_CODE_CORRECTIONS[code];
  return fix
    ? `Sarvam does not accept "${code}" — use "${fix}".`
    : `Sarvam does not accept "${code}". Supported: ${SARVAM_ASR_CODES.join(", ")}.`;
}

/**
 * Canonical (Sarvam) code → Bhashini's ISO-639 code. A language absent from this map has
 * no Bhashini ASR route, which is what tells the failover chain not to bother with a leg
 * it knows will fail.
 */
export const BHASHINI_LANG_MAP: Readonly<Record<string, string>> = {
  "en-IN": "en", "hi-IN": "hi", "bn-IN": "bn", "gu-IN": "gu", "kn-IN": "kn",
  "ml-IN": "ml", "mr-IN": "mr", "od-IN": "or", "pa-IN": "pa", "ta-IN": "ta",
  "te-IN": "te", "as-IN": "as", "ur-IN": "ur", "ne-IN": "ne", "kok-IN": "kok",
  "ks-IN": "ks", "sd-IN": "sd", "sa-IN": "sa", "sat-IN": "sat", "mni-IN": "mni",
  "brx-IN": "brx", "mai-IN": "mai", "doi-IN": "doi",
};

export function toBhashiniLang(code: string | null | undefined): string | null {
  if (!code) return null;
  return BHASHINI_LANG_MAP[code] ?? null;
}

/**
 * Sarvam's translate endpoint takes the BCP-47 code directly, so this is identity for
 * every supported language. It exists as a lookup rather than a pass-through so an
 * unmapped code (notably "auto", which is NOT a language) is caught instead of being
 * forwarded to the API as a source language.
 */
export function toSarvamTranslateLang(code: string | null | undefined): string | null {
  if (!code || code === "unknown") return null;
  return isSarvamAsrCode(code) ? code : null;
}

// ── endregion:pure ─────────────────────────────────────────────────────────

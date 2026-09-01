/**
 * ASR engine failover chain.
 *
 * Before this existed, each language carried ONE engine label and `sendChunk` called that
 * engine and gave up if it failed. So an upstream Sarvam problem — a bad key, an exhausted
 * quota, a rejected language — presented to the doctor as "this language does not work",
 * with no second attempt and no stated reason.
 *
 * A chain is a list of legs tried in order for each audio segment; the first leg returning
 * non-empty text wins. Bhashini exists as a real fallback because its ASR covers the same
 * Indic set, so a language is unavailable only when BOTH providers decline it.
 *
 * TRANSLATION IS NOT UNIFORM ACROSS LEGS, and callers must respect that: Sarvam runs in
 * `mode=translate` and returns ENGLISH, while Bhashini returns NATIVE SCRIPT. Claiming a
 * Bhashini transcript was pre-translated makes ai-clinical-voice skip translation, and the
 * note comes out half in Devanagari. `preTranslates` on each leg records the difference.
 */

import { toBhashiniLang, isSarvamAsrCode } from "@/lib/asrLanguages";

export type AsrEngine = "web_speech" | "sarvam" | "bhashini";

/**
 * Saaras output mode. Sarvam's own default is `transcribe`; this app used to override it
 * to `translate` on EVERY call, in every language, which is what made English dictation
 * come back paraphrased ("neck pain" → "headache", dropped clauses). `translate` runs a
 * generative speech-TRANSLATION decoder: it renders meaning, not words. `transcribe`
 * stays anchored to the acoustics and cannot silently substitute one symptom for another.
 */
export type SarvamMode = "transcribe" | "translate";

export interface AsrLeg {
  engine: AsrEngine;
  /** The code to send to THIS provider — already translated to its dialect. */
  langCode: string;
  /** True when this engine returns English rather than the spoken language's script. */
  preTranslates: boolean;
  /**
   * Saaras mode for this leg. Only meaningful for `engine: "sarvam"`.
   * ALWAYS moves in lockstep with `preTranslates` — see `sarvamLeg`.
   */
  mode?: SarvamMode;
}

/**
 * Build a Sarvam leg with `mode` and `preTranslates` derived from ONE condition.
 *
 * These two fields must never disagree: `preTranslates` is what tells
 * `transcriptIsPreTranslated` whether ai-clinical-voice still has to translate, so a leg
 * claiming `translate` mode while reporting `preTranslates: false` (or the reverse) makes
 * the note come out half-translated. Deriving both here is what keeps that impossible.
 */
function sarvamLeg(langCode: string, mode: SarvamMode): AsrLeg {
  return { engine: "sarvam", langCode, preTranslates: mode === "translate", mode };
}

/**
 * The second-chance leg for a Sarvam segment that came back EMPTY in `translate` mode.
 *
 * Saaras translates the ten major Indian languages well, but its translation head is much
 * likelier to return nothing at all on a low-resource language (Santali, Bodo, Dogri,
 * Kashmiri, Sindhi, Konkani, Sanskrit, Manipuri). Because the app never retried, those
 * languages simply produced no text — which is what "voice is not being detected for this
 * language" actually was. Re-decoding the SAME audio in `transcribe` mode gets the words
 * in the native script, and ai-clinical-voice translates them downstream on its existing,
 * already-working non-pre-translated path.
 *
 * Returns null when the leg has nothing to retry: a non-Sarvam engine, or one that was
 * already running in `transcribe` mode.
 */
export function transcribeRetryLeg(leg: AsrLeg): AsrLeg | null {
  if (leg.engine !== "sarvam") return null;
  if (leg.mode === "transcribe") return null;
  return sarvamLeg(leg.langCode, "transcribe");
}

/** Sarvam's auto-detect sentinel. The app's user-facing "auto" maps onto it. */
export const SARVAM_AUTODETECT = "unknown";
export const AUTO = "auto";

export interface ChainInput {
  /** What the doctor picked: "auto", "en-IN", or a Sarvam BCP-47 code. */
  selected: string;
  /** Language Sarvam reported hearing earlier in this session, if any. */
  detected?: string | null;
  /** The hospital's configured default, used only to rescue "auto" when nothing was detected. */
  hospitalDefault?: string | null;
  /** False on Safari and other browsers without SpeechRecognition. */
  webSpeechSupported?: boolean;
  /**
   * Platform-wide engine override from /platform → API Hub. When an admin has pinned an
   * engine, it is tried FIRST — but the other legs are kept, because a pin is a preference
   * and must not turn a provider outage into an outage for the hospital.
   */
  adminEngine?: string | null;
}

/**
 * Resolve which language code Bhashini should be asked for.
 *
 * Bhashini ASR cannot auto-detect — its pipeline requires an explicit `sourceLanguage`
 * (its task types are asr/translation/tts only). So for "auto" the fallback needs a code
 * from somewhere else: what Sarvam already reported hearing, else the hospital default.
 * When neither is available the leg is dropped rather than guessing a language, because
 * transcribing Tamil audio against a Hindi model produces confident nonsense, which is
 * worse in a clinical note than an honest failure.
 */
function bhashiniLegFor(input: ChainInput): AsrLeg | null {
  const { selected, detected, hospitalDefault } = input;
  const canonical = selected === AUTO ? (detected || hospitalDefault || null) : selected;
  const lang = toBhashiniLang(canonical);
  return lang ? { engine: "bhashini", langCode: lang, preTranslates: false } : null;
}

/**
 * Build the ordered legs for one dictation.
 *
 *   "auto"      Sarvam(unknown) → Bhashini(detected ?? hospital default)
 *   "en-IN"     Web Speech → Sarvam(en-IN) → Bhashini(en)
 *   Indic X     Sarvam(X) → Bhashini(map[X])
 *
 * Legs that cannot possibly work are omitted, not attempted: an unsupported Sarvam code, a
 * language Bhashini has no route for, Web Speech on a browser that lacks it.
 */
export function buildChain(input: ChainInput): AsrLeg[] {
  const { selected, webSpeechSupported = false, adminEngine } = input;
  const legs: AsrLeg[] = [];

  // Web Speech is free and instant, but it only ever handles the explicitly-English case.
  // It is never used for "auto": the browser recogniser cannot report what it heard, so a
  // wrong guess would be indistinguishable from a correct one.
  if (selected === "en-IN" && webSpeechSupported) {
    legs.push({ engine: "web_speech", langCode: "en-IN", preTranslates: false });
  }

  const sarvamCode = selected === AUTO ? SARVAM_AUTODETECT : selected;
  if (isSarvamAsrCode(sarvamCode)) {
    // English is transcribed, never translated: there is nothing to translate, and asking
    // the translation head for it is what paraphrased the dictation. Indic keeps
    // mode=translate — Saaras returns English from the same call at the same cost, which
    // is 3-6x cheaper in downstream LLM tokens than shipping native script into the prompt.
    //
    // "auto" (SARVAM_AUTODETECT) must start on `translate`: the language is genuinely
    // unknown until Sarvam answers, and getting native script back for an Indic dictation
    // is the more expensive mistake. The caller switches later segments to `transcribe`
    // once detection reports en-IN — see sarvamModeFor.
    legs.push(sarvamLeg(sarvamCode, sarvamCode === "en-IN" ? "transcribe" : "translate"));
  }

  const bhashini = bhashiniLegFor(input);
  if (bhashini) legs.push(bhashini);

  // An admin pin reorders; it does not remove the alternatives.
  if (adminEngine === "bhashini" || adminEngine === "web_speech" || adminEngine === "sarvam") {
    const pinned = legs.filter(l => l.engine === adminEngine);
    if (pinned.length > 0) {
      return [...pinned, ...legs.filter(l => l.engine !== adminEngine)];
    }
  }

  return legs;
}

/**
 * The Saaras mode to use for THIS segment of an in-progress dictation.
 *
 * Only "auto" needs this. `buildChain` cannot know the language of an auto dictation — it
 * has not heard any audio yet — so its Sarvam leg starts on `translate`. Once Sarvam has
 * reported hearing English, every REMAINING segment should be transcribed rather than
 * translated, for the same reason an explicit en-IN dictation is: running English through
 * a translation decoder paraphrases it.
 *
 * An explicitly-chosen language keeps the leg's own mode; nothing detected mid-dictation
 * should override what the doctor selected.
 */
export function sarvamModeFor(leg: AsrLeg, input: Pick<ChainInput, "selected" | "detected">): SarvamMode {
  const legMode: SarvamMode = leg.mode ?? "translate";
  if (leg.engine !== "sarvam") return legMode;
  if (input.selected !== AUTO) return legMode;
  return input.detected === "en-IN" ? "transcribe" : legMode;
}

/**
 * The language to tell ai-clinical-voice about.
 *
 * NEVER the literal "auto": that string is not a language, and it used to be forwarded
 * straight through to Sarvam's translate endpoint as a source language, where it was
 * rejected and the translation silently fell back. Prefer what Sarvam actually heard.
 */
export function resolveNoteLanguage(input: Pick<ChainInput, "selected" | "detected" | "hospitalDefault">): string {
  const { selected, detected, hospitalDefault } = input;
  if (selected !== AUTO) return selected;
  if (detected && isSarvamAsrCode(detected) && detected !== SARVAM_AUTODETECT) return detected;
  if (hospitalDefault && isSarvamAsrCode(hospitalDefault)) return hospitalDefault;
  // Nothing was detected and no default applies. en-IN makes ai-clinical-voice skip
  // translation, which is the right call: we have no idea what language this is, and
  // guessing one would send the transcript through a wrong-language translation.
  return "en-IN";
}

/**
 * Whether the finished transcript can be declared already-English.
 *
 * Only true when EVERY segment came from an engine that translates. One Bhashini segment in
 * a Sarvam dictation means the transcript is mixed, and `pre_translated_by` must be withheld
 * so the structuring step translates the remainder.
 *
 * The same applies to a segment rescued by `transcribeRetryLeg`: it carries
 * `preTranslates: false` because `transcribe` mode returns the NATIVE script. Callers must
 * therefore record the leg that actually served each segment — not the leg they set out to
 * use — or a dictation part-translated by Saaras and part-transcribed comes back to the
 * doctor half in Devanagari.
 */
export function transcriptIsPreTranslated(legsUsed: readonly AsrLeg[]): boolean {
  return legsUsed.length > 0 && legsUsed.every(l => l.preTranslates);
}

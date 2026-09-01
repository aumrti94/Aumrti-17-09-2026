// DENO COPY of the pure functions in src/lib/medicalLexicon.ts.
//
// Edge functions cannot import from src/, and vitest cannot see supabase/functions/,
// so the repo's established answer (see _shared/platform-billing.ts) is a duplicated
// file guarded by a parity test. medicalLexicon.parity.test.ts fails if these drift.
//
// DO NOT EDIT THE PURE REGION BY HAND — edit src/lib/medicalLexicon.ts and copy across.
// The database-loading layer below is Deno-only and has no counterpart in src/.
// @ts-nocheck

// ── region:pure ────────────────────────────────────────────────────────────

/** Strip to comparable form: lowercase alphanumerics only. */
export function normalizeTerm(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Consonant-skeleton phonetic key, tuned for Indic-accented English medical terms.
 *
 * The dominant ASR failure here is not a single wrong letter — it is a term being
 * split into pseudo-words with the vowels rewritten ("para seta mall"). Dropping
 * vowels and normalising the consonant spellings that Indian English varies most
 * (ph/f, c/k/s, th/t, x/ks, qu/k) collapses those variants onto one key:
 *
 *   "parasetamall" -> PRSTML   "paracetamol"  -> PRSTML
 *   "amoxysillin"  -> MKSSLN   "amoxicillin"  -> MKSSLN
 *   "pantoeprazole"-> PNTPRSL  "pantoprazole" -> PNTPRSL
 *
 * It is deliberately lossy — it is a BUCKETING function, not a decision. Levenshtein
 * similarity and the safety gate decide whether a bucket-mate is actually a match.
 */
/**
 * Reconcile the spelling variants without discarding vowels.
 *
 * This is the space in which similarity should be MEASURED. Comparing raw strings
 * punishes exactly the differences the phonetic key exists to forgive: "parasetamall"
 * vs "paracetamol" is only 0.75 raw, which would fail the 0.85 gate even though the
 * two are the same word. After normalisation they are "parasetamal"/"parasetamol" —
 * 0.91 — so the residual distance now reflects a REAL difference rather than an
 * Indian-English spelling of the same sound.
 */
export function phoneticNormalize(input: string): string {
  const s = normalizeTerm(input);
  if (!s) return "";
  return s
    .replace(/sch/g, "sk")
    .replace(/ph/g, "f")
    .replace(/gh/g, "g")
    .replace(/ck/g, "k")
    .replace(/ch/g, "k")
    .replace(/qu/g, "k")
    .replace(/kw/g, "k")
    .replace(/c([eiy])/g, "s$1")
    .replace(/c/g, "k")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/z/g, "s")
    .replace(/th/g, "t")
    .replace(/dh/g, "d")
    .replace(/bh/g, "b")
    .replace(/kh/g, "k")
    .replace(/w/g, "v")
    .replace(/y/g, "i")
    .replace(/ee/g, "i")
    .replace(/oo/g, "u")
    .replace(/(.)\1+/g, "$1");
}

export function phoneticKey(input: string): string {
  let s = normalizeTerm(input);
  if (!s) return "";

  // Order matters: longer digraphs must be consumed before their prefixes.
  s = s
    .replace(/sch/g, "sk")
    .replace(/ph/g, "f")
    .replace(/gh/g, "g")
    .replace(/ck/g, "k")
    .replace(/ch/g, "k")
    .replace(/qu/g, "k")
    .replace(/kw/g, "k")
    .replace(/c([eiy])/g, "s$1")   // ce/ci/cy sound like s (cetirizine, ciprofloxacin)
    .replace(/c/g, "k")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/z/g, "s")
    .replace(/th/g, "t")
    .replace(/dh/g, "d")
    .replace(/bh/g, "b")
    .replace(/kh/g, "k")
    .replace(/w/g, "v")
    .replace(/y/g, "i")
    .replace(/ee/g, "i")
    .replace(/oo/g, "u");

  s = s.replace(/(.)\1+/g, "$1");            // collapse doubled letters

  const first = s[0];
  const rest = s.slice(1).replace(/[aeiou]/g, "");   // keep leading char, drop later vowels
  return (first + rest).replace(/(.)\1+/g, "$1").toUpperCase();
}

/** Classic Levenshtein edit distance. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const tmp = prev; prev = curr; curr = tmp;
  }
  return prev[b.length];
}

/** Similarity in 0..1, where 1 is identical. */
export function similarityRatio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

/**
 * Words that must NEVER be silently replaced by a lexicon term, however well they
 * score. Ordinary English plus the everyday clinical vocabulary a doctor dictates in
 * plain speech ("cold", "pain", "rash"), any of which sits phonetically close to some
 * drug or test name in a large hospital catalogue.
 */
export const COMMON_ENGLISH_WORDS: ReadonlySet<string> = new Set([
  // function words / everyday English
  "the", "and", "for", "with", "from", "that", "this", "these", "those", "there", "then",
  "than", "have", "has", "had", "will", "would", "should", "could", "been", "being", "was",
  "were", "are", "not", "but", "you", "your", "she", "her", "him", "his", "they", "them",
  "who", "what", "when", "where", "which", "some", "any", "all", "one", "two", "three",
  "four", "five", "six", "seven", "eight", "nine", "ten", "day", "days", "week", "weeks",
  "month", "months", "year", "years", "hour", "hours", "time", "times", "also", "very",
  "much", "more", "most", "less", "least", "after", "before", "since", "until", "while",
  "into", "over", "under", "again", "still", "just", "only", "same", "each", "both",
  "take", "takes", "taking", "taken", "give", "given", "come", "came", "goes", "going",
  "said", "says", "tell", "told", "ask", "asked", "feel", "feels", "felt", "look", "looks",
  "make", "made", "need", "needs", "want", "wants", "know", "knows", "think", "seem",
  "good", "bad", "better", "worse", "well", "fine", "okay", "yes", "now", "today",
  "morning", "night", "evening", "afternoon", "food", "water", "milk", "left", "right",
  "side", "back", "front", "top", "little", "lot", "bit", "next", "last", "first", "old",
  "new", "high", "low", "long", "short", "small", "large", "big", "full", "empty", "hard",
  "soft", "hot", "cold", "warm", "dry", "wet", "clear", "please", "thank", "sir", "madam",
  // NOTE: "cue"/"queue" are deliberately ABSENT — CUE (Complete Urine Examination) is a
  // routine Indian lab test, and guarding the English word would block a real repair.
  // The letter-spelling path does not need them: "kyu" carries the Q sound there.
  "see", "seen", "saw", "eye", "oh", "why",
  // everyday clinical words a doctor speaks in plain English
  "pain", "pains", "fever", "cough", "cold", "rash", "sleep", "stool", "urine", "blood",
  "chest", "head", "neck", "arm", "arms", "leg", "legs", "hand", "hands", "foot", "feet",
  "eye", "eyes", "ear", "ears", "nose", "mouth", "throat", "skin", "bone", "bones",
  "heart", "lung", "lungs", "liver", "kidney", "stomach", "abdomen", "waist", "hip",
  "knee", "ankle", "shoulder", "wrist", "elbow", "spine", "joint", "joints", "muscle",
  "tablet", "tablets", "syrup", "drops", "injection", "capsule", "dose", "doses",
  "test", "tests", "scan", "report", "reports", "check", "normal", "swelling", "weak",
  "weakness", "tired", "vomiting", "loose", "motion", "motions", "burning", "itching",
  "breath", "breathing", "sugar", "pressure", "weight", "height", "appetite", "patient",
  "doctor", "nurse", "hospital", "medicine", "medicines", "treatment", "history",
]);

export type RepairSource =
  | "drug_master" | "ayush_drug_master" | "lab_test_master" | "lab_test_groups"
  | "service_master" | "radiology_study_master" | "icd10_codes" | "abbreviation"
  /**
   * Presenting complaints, working diagnoses and anatomical sites.
   *
   * SUGGESTION-ONLY — never auto-applied, enforced in `shouldAutoApply`. The reason this
   * source exists at all is that a mis-heard SYMPTOM previously had nothing to match
   * against: the catalogue held drugs, tests, services and radiology, so when the ASR
   * turned "neck pain" into "headache" no layer downstream could even notice, let alone
   * flag it. These terms give the structuring model something to notice it WITH.
   *
   * They must not be rewritten silently, because they collide head-on with ordinary
   * speech — "cold", "pain", "back", "head" are all real English words a doctor says in
   * their plain sense, and COMMON_ENGLISH_WORDS deliberately protects them. Suggesting is
   * safe; substituting is not.
   */
  | "symptom";

export interface LexiconEntry {
  /** Canonical, display-ready term. */
  term: string;
  source: RepairSource;
}

export interface LexiconIndex {
  /** phoneticKey -> entries sharing that key. */
  byPhonetic: Map<string, LexiconEntry[]>;
  /** normalizeTerm(term) -> entry, for exact hits. */
  byExact: Map<string, LexiconEntry>;
  size: number;
}

export interface AppliedRepair {
  from: string;
  to: string;
  score: number;
  source: RepairSource;
}

export interface RepairSuggestion {
  from: string;
  candidates: string[];
  score: number;
}

export interface RepairResult {
  repairedText: string;
  repairs: AppliedRepair[];
  suggestions: RepairSuggestion[];
  /**
   * Of the tokens that plausibly SHOULD be clinical terms (long, not ordinary English),
   * what fraction resolved to something in the hospital's catalogue. A Telugu dictation
   * that came back as phonetic mush scores near 0; clean clinical English scores high.
   * `null` when the transcript contained no candidate tokens at all — an honest
   * "no signal" rather than a misleading 0.
   */
  lexiconHitRate: number | null;
}

export interface RepairOptions {
  /** Minimum similarity for an automatic substitution. */
  autoApplyThreshold?: number;
  /** Minimum similarity to offer as a suggestion to the LLM. */
  suggestThreshold?: number;
  /** Longest run of words that may be joined into one candidate term. */
  maxPhraseWords?: number;
  /** Runner-up must trail the winner by at least this much for an auto-apply. */
  ambiguityMargin?: number;
}

/** Build the lookup index once per dictation; reuse across n-gram sizes. */
export function buildLexiconIndex(entries: readonly LexiconEntry[]): LexiconIndex {
  const byPhonetic = new Map<string, LexiconEntry[]>();
  const byExact = new Map<string, LexiconEntry>();

  for (const e of entries ?? []) {
    const term = (e?.term ?? "").trim();
    if (term.length < 3) continue;               // 1-2 char "terms" match everything
    const exact = normalizeTerm(term);
    if (!exact) continue;
    if (!byExact.has(exact)) byExact.set(exact, { term, source: e.source });

    const key = phoneticKey(term);
    if (!key) continue;
    const bucket = byPhonetic.get(key);
    if (bucket) {
      if (!bucket.some(b => normalizeTerm(b.term) === exact)) bucket.push({ term, source: e.source });
    } else {
      byPhonetic.set(key, [{ term, source: e.source }]);
    }
  }
  return { byPhonetic, byExact, size: byExact.size };
}

/**
 * The four-condition safety gate. ALL must hold before a transcript word is silently
 * rewritten. Exported so the gate itself is directly testable — it is the single most
 * safety-critical decision in this module.
 */
export function shouldAutoApply(args: {
  sourceWords: string[];
  candidateScore: number;
  runnerUpScore: number;
  phoneticExact: boolean;
  autoApplyThreshold: number;
  ambiguityMargin: number;
  /** Which catalogue the winning candidate came from. Omitted = a non-symptom source. */
  candidateSource?: RepairSource;
}): boolean {
  const { sourceWords, candidateScore, runnerUpScore, phoneticExact,
          autoApplyThreshold, ambiguityMargin, candidateSource } = args;

  // 0. Symptoms, diagnoses and body sites are offered to the LLM, never substituted.
  //    Rewriting a symptom is how a transcript stops matching what the doctor said, and
  //    unlike a drug name there is no spelling a clinician would recognise as "wrong".
  if (candidateSource === "symptom") return false;
  // 1. The phonetic skeletons must agree exactly — similarity alone is not enough.
  if (!phoneticExact) return false;
  // 2. Close enough by edit distance.
  if (candidateScore < autoApplyThreshold) return false;
  // 3. Never overwrite ordinary English. A single common word is off limits outright;
  //    a multi-word phrase is only joined when the JOINED form is not a real word
  //    (which it essentially never is — "parasetamall" is not English).
  if (sourceWords.length === 1) {
    if (COMMON_ENGLISH_WORDS.has(sourceWords[0].toLowerCase())) return false;
  } else if (COMMON_ENGLISH_WORDS.has(normalizeTerm(sourceWords.join("")))) {
    return false;
  }
  // 4. One unambiguous winner.
  if (candidateScore - runnerUpScore < ambiguityMargin) return false;

  return true;
}

/** True when a token is worth trying to resolve against the catalogue at all. */
function isCandidateToken(word: string): boolean {
  const n = normalizeTerm(word);
  return n.length >= 4 && !COMMON_ENGLISH_WORDS.has(n) && /[a-z]/.test(n);
}

/**
 * How Indian English says each letter aloud. Doctors spell investigations out —
 * "ee see gee", "yu es jee", "see bee see" — and the ASR faithfully writes down the
 * sounds, producing tokens no phonetic match against "ECG" can ever recover, because
 * the transcript contains a spelling of the NAME of each letter, not the word.
 */
const LETTER_SOUNDS: Readonly<Record<string, string>> = {
  ay: "A", ae: "A", aye: "A",
  bee: "B", be: "B", bi: "B",
  see: "C", cee: "C", si: "C", sea: "C",
  dee: "D", de: "D", di: "D",
  ee: "E", e: "E",
  ef: "F", eff: "F",
  jee: "G", gee: "G", ji: "G",
  aitch: "H", ech: "H", eich: "H",
  eye: "I", ai: "I", i: "I",
  jay: "J", je: "J",
  kay: "K", ke: "K",
  el: "L", ell: "L",
  em: "M", emm: "M",
  en: "N", enn: "N",
  oh: "O", o: "O",
  pee: "P", pi: "P",
  cue: "Q", kyu: "Q", queue: "Q",
  aar: "R", ar: "R", are: "R",
  es: "S", ess: "S",
  tee: "T", ti: "T",
  yu: "U", you: "U", yoo: "U",
  vee: "V", vi: "V",
  ex: "X", eks: "X",
  wai: "Y", why: "Y",
  zed: "Z", zee: "Z", jed: "Z",
};

/**
 * The subset of letter sounds that are NOT also ordinary English words. Their presence
 * is what distinguishes a doctor spelling an investigation out from someone simply
 * talking — "ee see gee" contains "ee" and "gee"; "you see" contains neither, and must
 * never be allowed to become the diagnosis "UC".
 */
const UNAMBIGUOUS_LETTER_SOUNDS: ReadonlySet<string> = new Set([
  "ae", "aye", "bi", "cee", "de", "di", "ee", "eff", "jee", "gee", "ji", "aitch",
  "ech", "eich", "ai", "je", "ke", "ell", "emm", "enn", "pee", "pi", "kyu", "aar",
  "ess", "tee", "ti", "yu", "yoo", "vee", "vi", "eks", "wai", "zed", "zee", "jed",
  "es", "ef", "em", "en", "el", "kay", "jay", "dee", "bee",
]);

/**
 * Collapse a run of spelled-out letters into the acronym it spells.
 *
 * Guarded hard, because several letter sounds ("are", "you", "oh", "see") are ordinary
 * English: the run must be at least two tokens long, at least one token must NOT be an
 * ordinary English word, and — decisively — the resulting acronym must already exist in
 * this hospital's catalogue. "you see" therefore stays "you see" unless the hospital
 * genuinely has a "UC" term AND one of the tokens is unusual, which it is not.
 */
export function expandSpelledLetters(
  words: readonly string[],
  isKnownTerm: (acronym: string) => boolean,
): { words: string[]; expansions: { from: string; to: string }[] } {
  const out: string[] = [];
  const expansions: { from: string; to: string }[] = [];
  let i = 0;

  while (i < words.length) {
    let j = i;
    const letters: string[] = [];
    while (j < words.length) {
      const key = normalizeTerm(words[j]);
      const letter = LETTER_SOUNDS[key];
      if (!letter) break;
      letters.push(letter);
      j++;
    }

    if (letters.length >= 2) {
      const run = words.slice(i, j);
      // A two-token run must contain a sound that is only ever a letter name. Three or
      // more consecutive letter sounds spelling a term the hospital actually stocks is
      // itself strong enough evidence — "see bee see" is CBC, while "oh i see" spells
      // nothing in any catalogue and so falls through untouched.
      const hasUnambiguous = run.some(w => UNAMBIGUOUS_LETTER_SOUNDS.has(normalizeTerm(w)));
      // Try the longest acronym first, then shorter prefixes of the run.
      let matched = false;
      for (let take = letters.length; take >= 2 && !matched; take--) {
        const permitted = hasUnambiguous || take >= 3;
        const acronym = letters.slice(0, take).join("");
        if (permitted && isKnownTerm(acronym)) {
          out.push(acronym);
          expansions.push({ from: run.slice(0, take).join(" "), to: acronym });
          i += take;
          matched = true;
        }
      }
      if (matched) continue;
    }

    out.push(words[i]);
    i++;
  }
  return { words: out, expansions };
}

/**
 * Repair a transcript against the hospital's own catalogue.
 *
 * Longer phrases are tried first so a term the ASR split across three words is
 * rejoined before its fragments are matched individually.
 */
export function repairTranscript(
  text: string,
  index: LexiconIndex,
  options: RepairOptions = {},
): RepairResult {
  const {
    autoApplyThreshold = 0.85,
    suggestThreshold = 0.70,
    maxPhraseWords = 3,
    ambiguityMargin = 0.05,
  } = options;

  const src = (text ?? "").trim();
  if (!src || index.size === 0) {
    return { repairedText: src, repairs: [], suggestions: [], lexiconHitRate: null };
  }

  const repairs: AppliedRepair[] = [];
  const suggestions: RepairSuggestion[] = [];

  // Pre-pass: fold spelled-out investigations ("ee see gee") into their acronym,
  // which no amount of phonetic matching against "ECG" could otherwise recover.
  const spelled = expandSpelledLetters(
    src.split(/\s+/),
    (acronym) => index.byExact.has(normalizeTerm(acronym)),
  );
  for (const e of spelled.expansions) {
    const entry = index.byExact.get(normalizeTerm(e.to));
    repairs.push({ from: e.from, to: e.to, score: 1, source: entry?.source ?? "abbreviation" });
  }

  const words = spelled.words;
  const consumed = new Array<boolean>(words.length).fill(false);
  const replacement = new Array<string | null>(words.length).fill(null);

  // A term is never split across a sentence boundary, so a word ending in terminal
  // punctuation cannot be joined to the one after it.
  const endsPhrase = (w: string) => /[.!?;:।॥,]$/.test(w);

  let candidateTokens = 0;
  let resolvedTokens = 0;

  for (let phraseLen = Math.min(maxPhraseWords, words.length); phraseLen >= 1; phraseLen--) {
    for (let i = 0; i + phraseLen <= words.length; i++) {
      let free = true;
      for (let k = 0; k < phraseLen; k++) if (consumed[i + k]) { free = false; break; }
      if (!free) continue;
      let spans = false;
      for (let k = 0; k < phraseLen - 1; k++) if (endsPhrase(words[i + k])) { spans = true; break; }
      if (spans) continue;

      const sourceWords = words.slice(i, i + phraseLen);
      const joined = normalizeTerm(sourceWords.join(""));
      const minLen = phraseLen === 1 ? 4 : 6;
      if (joined.length < minLen) continue;

      // Exact catalogue hit — already correct, nothing to repair.
      const exact = index.byExact.get(joined);
      if (exact) {
        for (let k = 0; k < phraseLen; k++) consumed[i + k] = true;
        if (phraseLen > 1) {
          replacement[i] = exact.term;
          for (let k = 1; k < phraseLen; k++) replacement[i + k] = "";
        }
        // Symptom terms are excluded from the hit rate. They are everyday words that
        // appear in almost every dictation, so counting them would push the score up
        // regardless of whether the CLINICAL vocabulary — the drug and test names this
        // metric exists to track — actually landed, and confidence is scaled off it.
        if (exact.source !== "symptom") { candidateTokens++; resolvedTokens++; }
        continue;
      }

      const bucket = index.byPhonetic.get(phoneticKey(joined));
      if (!bucket || bucket.length === 0) continue;

      // Score in the phonetically-normalised space so Indian-English spelling
      // variants do not count against an otherwise exact match.
      const joinedNorm = phoneticNormalize(joined);
      const scored = bucket
        .map(e => ({ entry: e, score: similarityRatio(joinedNorm, phoneticNormalize(e.term)) }))
        .sort((a, b) => b.score - a.score);

      const best = scored[0];
      const runnerUp = scored[1]?.score ?? 0;

      if (shouldAutoApply({
        sourceWords, candidateScore: best.score, runnerUpScore: runnerUp,
        phoneticExact: true, autoApplyThreshold, ambiguityMargin,
        candidateSource: best.entry.source,
      })) {
        for (let k = 0; k < phraseLen; k++) consumed[i + k] = true;
        replacement[i] = best.entry.term;
        for (let k = 1; k < phraseLen; k++) replacement[i + k] = "";
        repairs.push({
          from: sourceWords.join(" "), to: best.entry.term,
          score: Number(best.score.toFixed(3)), source: best.entry.source,
        });
        candidateTokens++; resolvedTokens++;
      } else if (best.score >= suggestThreshold) {
        // Not confident enough to rewrite — hand it to the LLM as context instead. This is
        // also the ONLY channel a symptom match can ever take (see shouldAutoApply), and
        // it is what gives a mis-heard "neck pain" a chance to be caught downstream.
        suggestions.push({
          from: sourceWords.join(" "),
          candidates: scored.slice(0, 3).map(s => s.entry.term),
          score: Number(best.score.toFixed(3)),
        });
        if (phraseLen === 1 && best.entry.source !== "symptom") candidateTokens++;
      }
    }
  }

  // Count the leftover unresolved candidate tokens so the hit rate reflects how much
  // of the clinical vocabulary actually landed.
  for (let i = 0; i < words.length; i++) {
    if (consumed[i]) continue;
    if (isCandidateToken(words[i])) candidateTokens++;
  }

  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const r = replacement[i];
    if (r === null) out.push(words[i]);
    else if (r !== "") out.push(r);
  }

  return {
    repairedText: out.join(" "),
    repairs,
    suggestions,
    lexiconHitRate: candidateTokens > 0 ? resolvedTokens / candidateTokens : null,
  };
}

/**
 * Indian clinical shorthand. These are added to the lexicon as terms in their own
 * right so a spelled-out dictation ("ee see gee") resolves to the abbreviation.
 * They are NOT expanded into prose — rewriting "BD" as "twice daily" would change
 * the note the doctor dictated.
 */
export const CLINICAL_ABBREVIATIONS: readonly string[] = [
  "ECG", "EEG", "ECHO", "USG", "CECT", "HRCT", "MRI", "CT scan", "X-ray", "PFT",
  "CBC", "ESR", "CRP", "LFT", "RFT", "KFT", "TSH", "HbA1c", "FBS", "RBS", "PPBS",
  "CBP", "CUE", "ABG", "PT INR", "APTT", "RTPCR", "HIV", "HBsAg", "HCV", "VDRL",
  "BP", "PR", "RR", "SpO2", "GRBS", "GCS", "CVS", "RS", "PA", "CNS",
  "OD", "BD", "TDS", "QID", "HS", "SOS", "STAT", "PRN", "NPO",
  "IV", "IM", "SC", "PO", "NG", "ET",
  "COPD", "CAD", "CKD", "DM", "HTN", "IHD", "UTI", "URTI", "LRTI", "AKI", "CVA",
  "K/C/O", "C/O", "H/O", "N/V", "SOB", "LOC",
];

/**
 * Presenting complaints and working diagnoses every Indian OPD sees, used when a hospital
 * has not customised its quick picks.
 *
 * Mirrors src/lib/quickPickDefaults.ts, which is what the doctor sees as the "Quick add"
 * chips under Chief Complaint. Duplicated rather than imported because edge functions
 * cannot reach into src/ — the same constraint that produced _shared/asr-languages.ts.
 */
export const DEFAULT_SYMPTOM_TERMS: readonly string[] = [
  // complaints
  "Fever", "Cough", "Cold", "Headache", "Body pain", "Vomiting", "Diarrhoea",
  "Chest pain", "Breathlessness", "Abdominal pain", "Burning urination",
  "Knee pain", "Back pain", "Skin rash",
  // diagnoses
  "Upper Respiratory Tract Infection", "Hypertension", "Type 2 Diabetes Mellitus",
  "Acute Gastroenteritis", "Migraine", "Urinary Tract Infection",
  "Bronchial Asthma", "Anaemia",
];

/**
 * Site + symptom phrases, so the location a doctor actually named survives.
 *
 * "Preserve the EXACT anatomical location" is already an explicit rule in the structuring
 * prompt, but the model can only preserve what reached it. When the ASR substitutes one
 * body part for another the prompt has nothing to work from — these give the deterministic
 * pass a phrase to match and surface as a suggestion.
 */
export const ANATOMY_SYMPTOM_TERMS: readonly string[] = [
  "neck pain", "lower back pain", "upper back pain", "shoulder pain", "left shoulder pain",
  "right shoulder pain", "hip pain", "ankle pain", "wrist pain", "elbow pain",
  "joint pain", "calf pain", "thigh pain", "jaw pain", "ear pain", "eye pain",
  "throat pain", "tooth pain", "heel pain", "flank pain", "loin pain",
  "left hand", "right hand", "left leg", "right leg", "left side", "right side",
];

// ── Deno-only: load the hospital's catalogue ────────────────────────────────

/**
 * Per-hospital lexicon cache. Edge instances are reused across invocations, so the
 * catalogue is fetched once per warm instance rather than once per dictation — the
 * tables are effectively static compared to how often a doctor dictates.
 */
const LEXICON_TTL_MS = 10 * 60 * 1000;
const lexiconCache = new Map<string, { index: LexiconIndex; loadedAt: number }>();

/** Pull `column` from `table` for one hospital, tolerating a table that does not exist. */
async function safeSelect(
  sb: { from: (t: string) => any },
  table: string,
  columns: string[],
  hospitalId: string,
  extraFilter?: (q: any) => any,
): Promise<Record<string, unknown>[]> {
  try {
    let q = sb.from(table).select(columns.join(",")).eq("hospital_id", hospitalId).limit(5000);
    if (extraFilter) q = extraFilter(q);
    const { data, error } = await q;
    if (error) {
      console.warn(`medical-lexicon: skipping ${table} — ${error.message}`);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.warn(`medical-lexicon: skipping ${table} —`, err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Build the repair lexicon from what this hospital actually stocks and orders.
 *
 * Every source is optional: a hospital without a radiology catalogue simply gets no
 * radiology terms. A missing table must never break dictation, so each read is
 * individually guarded — the module degrades to "fewer repairs", never to an error.
 */
export async function loadHospitalLexicon(
  sb: { from: (t: string) => any },
  hospitalId: string,
): Promise<LexiconIndex> {
  const cached = lexiconCache.get(hospitalId);
  if (cached && Date.now() - cached.loadedAt < LEXICON_TTL_MS) return cached.index;

  const activeOnly = (q: any) => q.eq("is_active", true);

  const [drugs, ayush, labs, labGroups, services, radiology, quickPicks] = await Promise.all([
    safeSelect(sb, "drug_master", ["drug_name", "generic_name"], hospitalId, activeOnly),
    safeSelect(sb, "ayush_drug_master", ["drug_name"], hospitalId),
    safeSelect(sb, "lab_test_master", ["test_name", "test_code"], hospitalId),
    safeSelect(sb, "lab_test_groups", ["group_name", "group_code"], hospitalId),
    safeSelect(sb, "service_master", ["name"], hospitalId, activeOnly),
    safeSelect(sb, "radiology_study_master", ["study_name"], hospitalId),
    // The doctors' own complaint and diagnosis chips — the closest thing the system has to
    // a record of the words THIS hospital's clinicians actually say. `items` is a JSON
    // array of strings for these two categories (see src/hooks/useDoctorQuickPicks.ts).
    safeSelect(sb, "doctor_quick_picks", ["category", "items"], hospitalId,
      (q: any) => q.in("category", ["complaints", "diagnoses"])),
  ]);

  const entries: LexiconEntry[] = [];
  const push = (term: unknown, source: RepairSource) => {
    if (typeof term === "string" && term.trim()) entries.push({ term: term.trim(), source });
  };

  for (const r of drugs) { push(r.drug_name, "drug_master"); push(r.generic_name, "drug_master"); }
  for (const r of ayush) push(r.drug_name, "ayush_drug_master");
  for (const r of labs) { push(r.test_name, "lab_test_master"); push(r.test_code, "lab_test_master"); }
  for (const r of labGroups) { push(r.group_name, "lab_test_groups"); push(r.group_code, "lab_test_groups"); }
  for (const r of services) push(r.name, "service_master");
  for (const r of radiology) push(r.study_name, "radiology_study_master");

  // The Indian clinical shorthand every hospital shares, regardless of catalogue.
  for (const a of CLINICAL_ABBREVIATIONS) entries.push({ term: a, source: "abbreviation" });

  // Symptoms LAST, deliberately. buildLexiconIndex keeps the FIRST entry for a given
  // normalised term, so appending here guarantees a real catalogue item always wins a
  // collision — a symptom term must never shadow a drug or test of the same name and
  // turn an auto-repairable term into a suggestion-only one.
  for (const r of quickPicks) {
    const items = r.items;
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      if (typeof it === "string" && it.trim()) entries.push({ term: it.trim(), source: "symptom" });
    }
  }
  // Fall back to the shared defaults only where the hospital supplied nothing — a doctor
  // who has curated their chips should not have the stock list competing with them.
  if (!quickPicks.some(r => Array.isArray(r.items) && r.items.length > 0)) {
    for (const t of DEFAULT_SYMPTOM_TERMS) entries.push({ term: t, source: "symptom" });
  }
  for (const t of ANATOMY_SYMPTOM_TERMS) entries.push({ term: t, source: "symptom" });

  const index = buildLexiconIndex(entries);
  lexiconCache.set(hospitalId, { index, loadedAt: Date.now() });
  console.log(`medical-lexicon: indexed ${index.size} terms for hospital ${hospitalId}`);
  return index;
}

/**
 * Highest-value terms to offer the ASR as hotword bias, shortest-first so the cap
 * favours the compact drug names most likely to be mangled.
 *
 * Symptoms are included even though they can never be auto-repaired. Biasing and repairing
 * are opposite ends of the problem: repair is a rewrite AFTER the damage, and is unsafe for
 * everyday words; biasing happens BEFORE, inside the recogniser, where making "neck pain"
 * more likely to be heard costs nothing and risks nothing. Preventing the substitution is
 * strictly better than detecting it.
 */
export function topHotwords(index: LexiconIndex, limit = 100): string[] {
  const BIASED: ReadonlySet<RepairSource> = new Set<RepairSource>([
    "drug_master", "lab_test_master", "abbreviation", "symptom",
  ]);
  return Array.from(index.byExact.values())
    .filter(e => BIASED.has(e.source))
    .map(e => e.term)
    .sort((a, b) => a.length - b.length)
    .slice(0, limit);
}

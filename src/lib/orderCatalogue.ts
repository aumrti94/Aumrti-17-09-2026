// Resolve dictated investigation names against the hospital's own lab / radiology catalogues.
//
// WHY THIS EXISTS
// Voice-dictated investigations were routed to "lab" or "radiology" by a single regex
// (`isRadiologyKeyword` in investigationSync.ts) and then written through as free text. Two
// consequences:
//
//   1. `syncLabOrders` requires an EXACT case-insensitive `lab_test_master.test_name` match
//      and silently drops anything else (`unmatched`). So a dictated test that the hospital
//      genuinely offers, phrased slightly differently, was never ordered and never billed —
//      which is precisely the revenue leak `pendingInvestigations.ts` exists to measure.
//   2. Nothing told the doctor whether the hospital even offers the test.
//
// Matching against the real catalogues fixes both, and catalogue membership is a far better
// lab-vs-radiology router than a keyword regex: if the name resolves to a
// `radiology_study_master` row it IS radiology, whatever it sounds like. The regex stays as
// a fallback for names that resolve to neither.
//
// Conservative by design: an unresolved name is reported as `unresolved`, never assumed
// available. It still reaches the prescription so the doctor can see and act on it.

import { supabase } from "@/integrations/supabase/client";
import {
  COMMON_ENGLISH_WORDS,
  normalizeTerm,
  phoneticNormalize,
  similarityRatio,
} from "@/lib/medicalLexicon";
import { BUILT_IN_ORDER_ALIASES } from "@/lib/orderAliases";

export type CatalogueKind = "lab" | "lab_group" | "radiology";

export interface CatalogueEntry {
  id: string;
  name: string;
  kind: CatalogueKind;
}

export interface OrderCatalogue {
  /** normalizeTerm(name) -> entry, for exact hits. */
  byExact: Map<string, CatalogueEntry>;
  /**
   * normalizeTerm(alias) -> entry. Built-in shorthand ("CBC", "KFT", "CXR") plus whatever
   * this hospital has already learned in `order_name_aliases`. Optional so a hand-built
   * catalogue (tests) stays valid.
   */
  byAlias?: Map<string, CatalogueEntry>;
  all: CatalogueEntry[];
}

/**
 * Expand the symbols catalogue names use but doctors speak as words.
 *
 * `normalizeTerm` strips punctuation entirely, so "USG Abdomen & Pelvis" reduces to
 * "usgabdomenpelvis" while a doctor saying "USG abdomen and pelvis" reduces to
 * "usgabdomenandpelvis" — three characters apart, enough to miss the threshold on a real
 * study the hospital does offer. Expanding first makes the two identical.
 */
function expandSymbols(name: string): string {
  return (name ?? "")
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/\//g, " ");
}

/** Below this similarity a name is left unresolved rather than matched to the wrong test. */
const MATCH_THRESHOLD = 0.88;

/**
 * Per-TOKEN similarity floor for the token-coverage path below. Deliberately lower than
 * MATCH_THRESHOLD: it is applied to one short word at a time ("creatinin" vs "creatinine"),
 * where a single edit costs far more of the ratio than it does across a whole phrase.
 */
const TOKEN_MATCH_THRESHOLD = 0.85;

/**
 * Words a doctor appends to a request that carry no catalogue meaning.
 *
 * "Fever panel test" and "Fever Panel" are the same order. Whole-string Levenshtein does not
 * know that — it scores them 0.714, under MATCH_THRESHOLD — so a panel the hospital offers
 * was reported as "not found in the lab catalogue", never ordered and never billed. That is
 * the bug this list exists to fix.
 *
 * `panel`, `profile`, `count`, `level`, `total`, `serum` and `routine` are deliberately NOT
 * here. They are load-bearing catalogue words: "Lipid" is not "Lipid Profile", and treating
 * the distinguishing noun as noise is how you bill a patient for the wrong test.
 */
export const ORDER_NOISE_WORDS: ReadonlySet<string> = new Set([
  "test", "tests", "testing", "study", "studies", "scan", "scans",
  "screen", "screening", "investigation", "investigations",
  "exam", "examination", "report", "reports",
  "please", "kindly", "do", "send", "order", "get", "check",
  "for", "of", "the", "and", "a", "an", "with", "plus",
]);

const CATALOGUE_TTL_MS = 5 * 60 * 1000;
const catalogueCache = new Map<string, { catalogue: OrderCatalogue; loadedAt: number }>();

/** Drop the cached catalogue — call after the hospital edits its test/study masters. */
export function invalidateOrderCatalogue(hospitalId?: string): void {
  if (hospitalId) catalogueCache.delete(hospitalId);
  else catalogueCache.clear();
}

/**
 * Index a set of catalogue rows for matching.
 *
 * Separate from `loadOrderCatalogue` so callers that have ALREADY fetched the masters can
 * match against the same tiers without a second round trip — `investigationSync` does exactly
 * this, which is what lets the order-creation path and the on-screen badge agree.
 */
export function buildOrderCatalogue(
  all: CatalogueEntry[],
  learnedAliases: ReadonlyArray<{ raw_name_norm: string; canonical_name: string }> = [],
): OrderCatalogue {
  const byExact = new Map<string, CatalogueEntry>();
  for (const e of all) {
    const key = normalizeTerm(expandSymbols(e.name));
    if (key && !byExact.has(key)) byExact.set(key, e);
  }

  // Aliases resolve THROUGH byExact, never around it: the right-hand side of an alias is a
  // canonical name, and if this hospital does not carry that name the alias simply does not
  // exist here. That is what keeps "KFT" from ordering a panel the lab cannot run.
  const byAlias = new Map<string, CatalogueEntry>();
  const addAlias = (rawKey: string, canonical: string) => {
    const key = normalizeTerm(expandSymbols(rawKey));
    if (!key || byExact.has(key) || byAlias.has(key)) return;
    const target = byExact.get(normalizeTerm(expandSymbols(canonical)));
    if (target) byAlias.set(key, target);
  };
  for (const a of BUILT_IN_ORDER_ALIASES) addAlias(a.alias, a.canonical);
  // Learned aliases are added last so a hospital's own correction wins a key collision.
  for (const row of learnedAliases) {
    if (row?.raw_name_norm && row?.canonical_name) {
      byAlias.delete(row.raw_name_norm);
      addAlias(row.raw_name_norm, row.canonical_name);
    }
  }

  return { byExact, byAlias, all };
}

/**
 * Load this hospital's active lab tests, lab panels and radiology studies.
 *
 * Three queries in one round trip, cached per hospital, because this now runs on the
 * consultation critical path when a dictation is applied.
 */
export async function loadOrderCatalogue(hospitalId: string): Promise<OrderCatalogue> {
  const empty: OrderCatalogue = { byExact: new Map(), all: [] };
  if (!hospitalId) return empty;

  const cached = catalogueCache.get(hospitalId);
  if (cached && Date.now() - cached.loadedAt < CATALOGUE_TTL_MS) return cached.catalogue;

  const [labs, groups, studies, learned] = await Promise.all([
    supabase.from("lab_test_master").select("id, test_name")
      .eq("hospital_id", hospitalId).eq("is_active", true).limit(5000),
    supabase.from("lab_test_groups").select("id, group_name")
      .eq("hospital_id", hospitalId).eq("is_active", true).limit(1000),
    supabase.from("radiology_study_master").select("id, study_name")
      .eq("hospital_id", hospitalId).eq("is_active", true).limit(2000),
    // Phrasings this hospital has already resolved once — a doctor's correction or an
    // accepted ai-resolve-orders answer. Reading them here is what stops the same phrase
    // costing an LLM call on every consultation.
    (supabase as any).from("order_name_aliases").select("raw_name_norm, canonical_name")
      .eq("hospital_id", hospitalId).limit(5000),
  ]);

  const all: CatalogueEntry[] = [];
  for (const r of ((labs.data ?? []) as { id: string; test_name: string }[])) {
    if (r.test_name?.trim()) all.push({ id: r.id, name: r.test_name.trim(), kind: "lab" });
  }
  for (const r of ((groups.data ?? []) as { id: string; group_name: string }[])) {
    if (r.group_name?.trim()) all.push({ id: r.id, name: r.group_name.trim(), kind: "lab_group" });
  }
  for (const r of ((studies.data ?? []) as { id: string; study_name: string }[])) {
    if (r.study_name?.trim()) all.push({ id: r.id, name: r.study_name.trim(), kind: "radiology" });
  }

  const catalogue = buildOrderCatalogue(
    all,
    (learned.data ?? []) as { raw_name_norm: string; canonical_name: string }[],
  );
  catalogueCache.set(hospitalId, { catalogue, loadedAt: Date.now() });
  return catalogue;
}

/**
 * Split a name into meaningful, comparison-ready tokens.
 *
 * Symbols are expanded first (so "&" becomes the word "and", which is then dropped as noise
 * rather than silently deleted the way `normalizeTerm` would), each token is reduced to the
 * phonetic space Indian-English spelling variants collapse into, and noise words are removed.
 */
function orderContentTokens(name: string): string[] {
  return expandSymbols(name)
    .split(/\s+/)
    .map((t) => normalizeTerm(t))
    .filter((t) => t && !ORDER_NOISE_WORDS.has(t))
    .map((t) => phoneticNormalize(t));
}

/**
 * Order-independent token match: 0..1 when every token on BOTH sides pairs off, else null.
 *
 * Requiring a 1:1 pairing after noise removal is what keeps this safe. A query with a token
 * the candidate lacks is a DIFFERENT request ("malaria fever panel" is not "Fever Panel"),
 * and a candidate with a token the query lacks is a MORE SPECIFIC test ("Lipid" is not
 * "Lipid Profile", "Urine" is not "Urine R/M"). Both are rejected outright rather than
 * scored, because a near-miss here bills the patient for work nobody asked for.
 */
function tokenPairScore(queryTokens: readonly string[], candidate: string): number | null {
  const cTokens = orderContentTokens(candidate);
  // A candidate made entirely of noise words has nothing to distinguish it — it would match
  // every query. Leave it to the character path.
  if (!cTokens.length || cTokens.length !== queryTokens.length) return null;

  const taken = new Array<boolean>(cTokens.length).fill(false);
  let total = 0;

  for (const q of queryTokens) {
    let bestIdx = -1;
    let best = 0;
    for (let i = 0; i < cTokens.length; i++) {
      if (taken[i]) continue;
      const s = similarityRatio(q, cTokens[i]);
      if (s > best) { best = s; bestIdx = i; }
    }
    if (bestIdx < 0 || best < TOKEN_MATCH_THRESHOLD) return null;
    taken[bestIdx] = true;
    total += best;
  }

  return total / queryTokens.length;
}

/** How a name was resolved to its catalogue row. Surfaced in the UI and the audit line. */
export type MatchSource = "exact" | "alias" | "fuzzy" | "llm";

export interface OrderMatch {
  entry: CatalogueEntry;
  source: MatchSource;
  score: number;
}

export interface ResolvedOrder {
  /** What the doctor actually said, unchanged. */
  dictated: string;
  /** Canonical catalogue name, or the dictated text when unresolved. */
  name: string;
  kind: CatalogueKind | null;
  catalogueId: string | null;
  /** True when it resolved to a real row this hospital offers. */
  offered: boolean;
  /** How it resolved. Absent when nothing matched. */
  matchSource?: MatchSource;
  /**
   * The doctor's own wording, set ONLY when the canonical name differs from it. The UI shows
   * this as `matched from "…"` so an auto-selection is never silent — a name that was
   * rewritten on the doctor's behalf, and then billed, has to be visible and reversible.
   */
  matchedFrom?: string;
}

/**
 * Match one dictated investigation name against the catalogue.
 *
 * Exact normalised match first, then best phonetic-space match above MATCH_THRESHOLD.
 * The threshold is higher than the drug one because test names are short and share many
 * prefixes ("Urine R/M" vs "Urine Culture"), where a wrong match orders the wrong test.
 */
export function matchOrderName(dictated: string, catalogue: OrderCatalogue): CatalogueEntry | null {
  return matchOrderNameDetailed(dictated, catalogue)?.entry ?? null;
}

/**
 * As `matchOrderName`, but reports HOW the name resolved.
 *
 * Four tiers, cheapest and safest first:
 *   1. exact  — the normalised name is in the catalogue verbatim
 *   2. alias  — known shorthand ("CBC", "KFT", "CXR") or a mapping this hospital already
 *               learned, from `orderAliases.ts` / `order_name_aliases`
 *   3. fuzzy  — best of two independent scorers, each with its own gate:
 *               • character-level phonetic similarity (the original path, unchanged), which
 *                 forgives spelling drift: "creatinin" -> "Serum Creatinine"
 *               • token coverage, which forgives redundant words and word order:
 *                 "Fever panel test" -> "Fever Panel"
 *   4. (llm)  — not done here; see resolveOrders' caller, which sends the leftovers to
 *               `ai-resolve-orders` and writes accepted answers back as tier-2 aliases.
 *
 * The ambiguity guard is what makes auto-selection safe to bill on: when two catalogue rows
 * both qualify and score within 0.02 of each other, nothing is returned. Ordering the wrong
 * test is far worse than asking the doctor to pick.
 */
export function matchOrderNameDetailed(dictated: string, catalogue: OrderCatalogue): OrderMatch | null {
  const q = normalizeTerm(expandSymbols(dictated));
  if (!q) return null;

  const exact = catalogue.byExact.get(q);
  if (exact) return { entry: exact, source: "exact", score: 1 };

  const alias = catalogue.byAlias?.get(q);
  if (alias) return { entry: alias, source: "alias", score: 1 };

  const qNorm = phoneticNormalize(expandSymbols(dictated));
  if (!qNorm) return null;

  // A request made entirely of everyday words ("pain", "check the sugar") must never be
  // rewritten into a test name, however well it happens to score against a large catalogue.
  const qTokens = orderContentTokens(dictated);
  if (!qTokens.length) return null;
  const rawWords = expandSymbols(dictated).split(/\s+/).map(normalizeTerm).filter(Boolean);
  if (rawWords.every((w) => COMMON_ENGLISH_WORDS.has(w))) return null;

  let best: CatalogueEntry | null = null;
  let bestScore = 0;
  // Highest score of ANY OTHER row, whether or not it cleared a gate. The runner-up is
  // deliberately not restricted to qualifying rows: a second test sitting 0.01 away is
  // exactly as much of a coin-flip when it fell just short of the gate as when it cleared it.
  let runnerUp = 0;

  for (const e of catalogue.all) {
    const charScore = similarityRatio(qNorm, phoneticNormalize(expandSymbols(e.name)));
    const tokenScore = tokenPairScore(qTokens, e.name);
    const effective = Math.max(charScore, tokenScore ?? 0);
    // A candidate qualifies on either basis, each with its own gate.
    const qualifies = charScore >= MATCH_THRESHOLD || tokenScore !== null;

    if (qualifies && effective > bestScore) {
      runnerUp = Math.max(runnerUp, bestScore);
      bestScore = effective;
      best = e;
    } else if (effective > runnerUp) {
      runnerUp = effective;
    }
  }

  if (!best) return null;
  if (bestScore - runnerUp < 0.02) return null;
  return { entry: best, source: "fuzzy", score: bestScore };
}

/**
 * Resolve a batch of dictated investigation names.
 *
 * `fallbackIsRadiology` routes names that match nothing — pass `isRadiologyKeyword` so
 * behaviour for unresolved names is unchanged from before.
 */
export function resolveOrders(
  names: readonly string[],
  catalogue: OrderCatalogue,
  fallbackIsRadiology: (name: string) => boolean,
): ResolvedOrder[] {
  return (names ?? [])
    .map(n => (n ?? "").trim())
    .filter(Boolean)
    .map((dictated) => {
      const hit = matchOrderNameDetailed(dictated, catalogue);
      if (hit) {
        return {
          dictated,
          name: hit.entry.name,
          kind: hit.entry.kind,
          catalogueId: hit.entry.id,
          offered: true,
          matchSource: hit.source,
          matchedFrom: hit.entry.name === dictated ? undefined : dictated,
        };
      }
      return {
        dictated,
        name: dictated,
        kind: fallbackIsRadiology(dictated) ? "radiology" as const : "lab" as const,
        catalogueId: null,
        offered: false,
      };
    });
}

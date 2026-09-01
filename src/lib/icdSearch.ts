/**
 * icdSearch — the single ICD catalogue lookup, shared by every picker.
 *
 * WHY THIS EXISTS. There was no shared helper: DiagnosisPanel (OPD) and ICDCodingTab (MRD)
 * each inlined their own Supabase query against `icd10_codes`. The two copies drifted, and
 * both carried the same silent bug:
 *
 *     const terms = text.split(/\s+/).filter(w => w.length > 2).join(" | ");
 *     .textSearch("description", terms, { type: "websearch", config: "english" })
 *
 * `websearch_to_tsquery` does NOT implement `|`. It treats the pipe as punctuation, drops it,
 * and ANDs the surviving lexemes — so "acute upper respiratory infection" demanded that one
 * ICD description contain *every* word. Almost nothing matched, results silently collapsed
 * onto the single-word `ilike` fallback, and the dropdown looked broken or empty.
 *
 * Omitting `type` makes Supabase emit `to_tsquery`, which does honour `|`, so the OR that was
 * always intended actually happens. The input is already stripped to `\w\s` before it gets
 * here, so no tsquery operator can be injected through it.
 *
 * The query also targets `search_tsv` — a stored generated column added in
 * 20261017000001_icd11_support.sql — rather than `description`. The pre-existing GIN index was
 * built on `to_tsvector('english', code || ' ' || description)` while the callers searched
 * `description`, a different expression, so the index was never used. That was survivable at
 * ~294 seeded rows; it is not once a full ICD-11 linearization is uploaded.
 *
 * ADDITIVE BY CONSTRUCTION. `systems` defaults to `["icd10"]`, ordering (`common_india desc`,
 * `use_count desc`), `limit`, the `is_billable = true` filter and the `ilike` fallback are all
 * carried over unchanged from the two call sites. Any term that returned rows before must
 * still return them — the OR tsquery can only add matches on top. See icdSearch.test.ts.
 */

import { supabase } from "@/integrations/supabase/client";
import { ICD10_DATA } from "@/lib/icd10Data";

export type IcdSystem = "icd10" | "icd11";

/** The per-hospital switch stored in `hospital_icd_settings.active_code_system`. */
export type ActiveCodeSystem = "icd10" | "icd11" | "both";

/** Which catalogue rows a hospital may see — `hospital_icd_settings.active_set`. */
export type ActiveSet = "system_only" | "hospital_only" | "all";

export interface IcdResult {
  code: string;
  description: string;
  category?: string;
  code_system: IcdSystem;
}

export interface IcdSearchOptions {
  term: string;
  /** Defaults to ICD-10 only, i.e. exactly the pre-ICD-11 behaviour. */
  systems?: IcdSystem[];
  hospitalId?: string | null;
  activeSet?: ActiveSet;
  commonFirst?: boolean;
  limit?: number;
  /** How many words feed the OR'd query. MRD passes 5 (its historical breadth); OPD uses 4. */
  maxTerms?: number;
}

/** Below this many characters the callers never searched, and still don't. */
export const MIN_SEARCH_LENGTH = 3;

/**
 * Translate the per-hospital switch into the list of systems to query.
 * An unset/unknown value falls back to ICD-10 so a hospital that has never opened the
 * settings page sees precisely what it saw before ICD-11 existed.
 */
export function systemsFor(active: ActiveCodeSystem | null | undefined): IcdSystem[] {
  if (active === "both") return ["icd10", "icd11"];
  if (active === "icd11") return ["icd11"];
  return ["icd10"];
}

/**
 * Build the OR'd tsquery from free text.
 *
 * Pure and exported so the `|` semantics above are testable without a database.
 * Returns "" when nothing usable survives — the caller then skips FTS entirely rather than
 * sending an empty query to Postgres.
 */
export function buildTsQuery(text: string, maxTerms = 4): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, maxTerms)
    .join(" | ");
}

/** The word the `ilike` fallback searches on — the first usable token. */
export function fallbackTerm(text: string): string {
  const first = text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)[0];
  return first || text.trim().split(/\s+/)[0] || "";
}

/** Usable tokens, lowercased and stripped — the shared front half of every stage below. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/**
 * Words clinicians type that the ICD catalogue files under a different spelling.
 *
 * This is a SEARCH aid only — it widens the OR'd query so the right rows surface. It never
 * assigns a code: the doctor still picks, and `pickAutoFill` below refuses to choose when the
 * candidates disagree. Each pair is a term Indian OPD notes use interchangeably with the
 * catalogue's own wording.
 *
 * "spondylitis"/"spondylosis" is the entry this map was written for: cervical spondylosis is
 * near-universally dictated as "cervical spondylitis" here, and the catalogue only ever spells
 * it the other way, so the picker returned nothing at all for the typed form.
 */
const SEARCH_SYNONYMS: Record<string, string[]> = {
  spondylitis: ["spondylosis", "spondylopathy"],
  spondylosis: ["spondylitis", "spondylopathy"],
  sugar: ["diabetes", "diabetic"],
  diabetic: ["diabetes"],
  piles: ["haemorrhoids", "hemorrhoids"],
  haemorrhoids: ["hemorrhoids"],
  hemorrhoids: ["haemorrhoids"],
  fits: ["epilepsy", "convulsions", "seizure"],
  seizure: ["epilepsy", "convulsions"],
  bp: ["hypertension", "hypertensive"],
  hypertension: ["hypertensive"],
  acidity: ["gastritis", "reflux", "dyspepsia"],
  gastritis: ["dyspepsia"],
  jaundice: ["hepatitis", "bilirubin"],
  diarrhoea: ["diarrhea", "gastroenteritis"],
  diarrhea: ["diarrhoea", "gastroenteritis"],
  anaemia: ["anemia"],
  anemia: ["anaemia"],
  oedema: ["edema"],
  edema: ["oedema"],
  tb: ["tuberculosis"],
  asthma: ["asthmatic", "bronchitis"],
  stroke: ["infarction", "cerebrovascular"],
  heartattack: ["infarction"],
  kidney: ["renal"],
  renal: ["kidney"],
  liver: ["hepatic"],
  stomach: ["gastric"],
};

/** Cap on how many synonym words get appended, so the OR stays cheap. */
const MAX_SYNONYMS = 4;

/**
 * The tokens actually sent to Postgres: the typed words plus their catalogue spellings.
 *
 * Additive by construction — the typed words always lead, so every row that matched before
 * still matches, and the synonyms can only widen the result set.
 */
export function expandTokens(text: string, maxTerms = 4): string[] {
  const base = tokenize(text).slice(0, maxTerms);
  const seen = new Set(base);
  const extra: string[] = [];
  for (const t of base) {
    for (const syn of SEARCH_SYNONYMS[t] || []) {
      if (!seen.has(syn) && extra.length < MAX_SYNONYMS) {
        seen.add(syn);
        extra.push(syn);
      }
    }
  }
  return [...base, ...extra];
}

/**
 * The `ilike` candidates, most specific first.
 *
 * The old single-term fallback always took the *leading* word, which for "cervical
 * spondylitis" meant searching on "cervical" — the generic half — and giving up when that
 * missed. Longer words are the rarer, more diagnostic ones, so they get tried first.
 */
export function fallbackTerms(text: string): string[] {
  const base = tokenize(text).slice(0, 4);
  const baseSet = new Set(base);
  // Typed words are probed before any synonym: what the doctor wrote outranks what this
  // module guesses they meant. Within each group, longer (rarer) words go first.
  const byLength = (a: string, b: string) => b.length - a.length;
  const synonyms = expandTokens(text).filter((t) => !baseSet.has(t));
  return [...base.sort(byLength), ...synonyms.sort(byLength)];
}

/**
 * How well a catalogue row answers what the doctor typed, in [0, 1].
 *
 * Postgres returns rows in `common_india` / `use_count` order, which says nothing about
 * relevance to this term — under an OR'd query the row matching the one generic word can
 * easily outrank the row matching the specific one. Scoring here re-floats the best answer,
 * which is also what makes an auto-fill safe to offer.
 */
export function scoreMatch(term: string, r: Pick<IcdResult, "code" | "description">): number {
  const typed = tokenize(term);
  if (typed.length === 0) return 0;

  const haystack = ` ${r.description.toLowerCase()} `;
  let hits = 0;
  for (const t of typed) {
    // Direct hit on the typed word, or on any spelling the catalogue might use instead.
    const forms = [t, ...(SEARCH_SYNONYMS[t] || [])];
    if (forms.some((f) => haystack.includes(f))) hits += 1;
  }

  let score = hits / typed.length;
  // An exact code match is what the doctor meant, whatever the description says.
  if (r.code.toLowerCase() === term.trim().toLowerCase()) score = 1;
  return score;
}

/** Stable relevance sort: DB ordering survives as the tiebreak for equally good rows. */
function rankResults(term: string, rows: IcdResult[]): IcdResult[] {
  return rows
    .map((r, i) => ({ r, i, s: scoreMatch(term, r) }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map((x) => x.r);
}

/**
 * In-memory search over the catalogue the app already ships.
 *
 * The seeded `icd10_codes` table carries 294 India-common rows; `ICD10_DATA` carries ~650 and
 * is what the insurance pickers have always searched. A term the seed simply does not contain
 * — "cervical spondylitis" being the reported one — returned an empty dropdown even though the
 * code was sitting in the bundle. This stage runs only after the database has found nothing,
 * so it costs nothing on the normal path and cannot displace a hospital's own catalogue rows.
 */
export function localSearch(term: string, limit = 8): IcdResult[] {
  const typed = tokenize(term);
  if (typed.length === 0) return [];

  const scored: { r: IcdResult; s: number }[] = [];
  for (const e of ICD10_DATA) {
    const r: IcdResult = { code: e.code, description: e.desc, code_system: "icd10" };
    const s = scoreMatch(term, r);
    if (s > 0) scored.push({ r, s });
  }

  return scored
    .sort((a, b) => (b.s - a.s) || a.r.code.localeCompare(b.r.code))
    .slice(0, limit)
    .map((x) => x.r);
}

/**
 * The result safe to drop into the ICD field without the doctor picking it, or null.
 *
 * Deliberately conservative. A coded diagnosis flows into billing, PMJAY and the FHIR export,
 * so a guess is worse than a blank field: this returns a code only when one candidate matches
 * everything the doctor typed AND no rival matches it equally well. Anything less stays a
 * suggestion in the dropdown.
 */
export function pickAutoFill(term: string, results: IcdResult[]): IcdResult | null {
  if (results.length === 0) return null;
  const top = results[0];
  const topScore = scoreMatch(term, top);
  // Every typed word has to be accounted for.
  if (topScore < 1) return null;
  // A tie means the catalogue offers two equally good codes — that is the doctor's call.
  if (results.length > 1 && scoreMatch(term, results[1]) >= topScore) return null;
  return top;
}

/**
 * Apply the catalogue-scope and ordering rules both call sites already used.
 *
 * `withCodeSystem` is false on the legacy path below, which has to run against a database
 * where the ICD-11 migration has not been applied yet.
 */
function applyScope(
  query: any,
  { systems, hospitalId, activeSet, commonFirst }: Required<Pick<IcdSearchOptions, "systems" | "activeSet" | "commonFirst">> & { hospitalId?: string | null },
  withCodeSystem = true,
) {
  let q = query.eq("is_billable", true);
  if (withCodeSystem) q = q.in("code_system", systems);

  if (activeSet === "system_only") {
    q = q.is("hospital_id", null);
  } else if (activeSet === "hospital_only" && hospitalId) {
    q = q.eq("hospital_id", hospitalId);
  }

  if (commonFirst) {
    q = q.order("common_india", { ascending: false }).order("use_count", { ascending: false });
  } else {
    q = q.order("use_count", { ascending: false });
  }

  return q;
}

const SELECT_COLS = "code, description, category, code_system";
const LEGACY_SELECT_COLS = "code, description, category";

/**
 * Last-resort lookup for a database that predates 20261017000001_icd11_support.sql — no
 * `code_system`, no `search_tsv`. Without this, an app deployed ahead of its migration would
 * error on every ICD query and the picker would go blank, which is strictly worse than the
 * behaviour being fixed. Mirrors the original `ilike` fallback exactly.
 */
async function legacySearch(
  term: string,
  scope: Required<Pick<IcdSearchOptions, "systems" | "activeSet" | "commonFirst">> & { hospitalId?: string | null },
  limit: number,
): Promise<IcdResult[]> {
  const word = fallbackTerm(term);
  if (!word) return [];

  const { data } = await applyScope(
    (supabase as any).from("icd10_codes").select(LEGACY_SELECT_COLS),
    scope,
    false,
  )
    .ilike("description", `%${word}%`)
    .limit(limit);

  // Everything in a pre-migration catalogue is ICD-10 by definition.
  return ((data || []) as Omit<IcdResult, "code_system">[]).map((r) => ({ ...r, code_system: "icd10" as IcdSystem }));
}

/**
 * Search the ICD catalogue. Full-text first, `ilike` on the leading word as a fallback —
 * the same two-stage shape both pickers already had, minus the broken pipe handling.
 *
 * Never throws: a failed lookup returns [] so a transient DB error degrades the dropdown
 * instead of breaking the consultation screen.
 */
export async function searchIcdCodes(opts: IcdSearchOptions): Promise<IcdResult[]> {
  const {
    term,
    systems = ["icd10"],
    hospitalId = null,
    activeSet = "all",
    commonFirst = true,
    limit = 8,
    maxTerms = 4,
  } = opts;

  if (!term || term.trim().length < MIN_SEARCH_LENGTH) return [];
  if (systems.length === 0) return [];

  const scope = { systems, hospitalId, activeSet, commonFirst };
  // The bundled catalogue stands in for a catalogue miss, but only where it is allowed to:
  // it is ICD-10 only, and `hospital_only` is an explicit instruction to show nothing but
  // this hospital's own rows — a global fallback would quietly overrule that setting.
  const local = () =>
    systems.includes("icd10") && activeSet !== "hospital_only" ? localSearch(term, limit) : [];

  try {
    // Synonyms ride along in the same OR'd query rather than costing a second round trip.
    const tsQuery = expandTokens(term, maxTerms).join(" | ");

    if (tsQuery) {
      // No `type` → to_tsquery, which honours the `|` separators built above.
      // `websearch` here would silently AND them, which is the bug this helper exists to fix.
      const { data, error } = await applyScope(
        (supabase as any).from("icd10_codes").select(SELECT_COLS),
        scope,
      )
        .textSearch("search_tsv", tsQuery, { config: "english" })
        .limit(limit);

      // A missing column means the ICD-11 migration has not run against this database yet.
      if (error) {
        const legacy = await legacySearch(term, scope, limit);
        return legacy.length > 0 ? rankResults(term, legacy) : local();
      }
      if (data && data.length > 0) return rankResults(term, data as IcdResult[]);
    }

    // FTS found nothing, or the term was all stop words and to_tsquery came back empty.
    // Try each word, most specific first, instead of giving up on the leading one.
    // Capped: this only runs when FTS already missed, and three probes is enough to tell a
    // catalogue gap from a spelling one without stacking round trips behind the debounce.
    for (const word of fallbackTerms(term).slice(0, 3)) {
      const { data: fallback, error: fallbackError } = await applyScope(
        (supabase as any).from("icd10_codes").select(SELECT_COLS),
        scope,
      )
        .ilike("description", `%${word}%`)
        .limit(limit);

      if (fallbackError) {
        const legacy = await legacySearch(term, scope, limit);
        return legacy.length > 0 ? rankResults(term, legacy) : local();
      }
      if (fallback && fallback.length > 0) return rankResults(term, fallback as IcdResult[]);
    }

    // Nothing in this hospital's catalogue — fall back to the codes shipped with the app so
    // the dropdown is never blank for a common diagnosis.
    return local();
  } catch {
    return local();
  }
}

/**
 * Read a hospital's ICD preferences. Returns the pre-ICD-11 defaults when no row exists,
 * so a hospital that never visited the settings page is unaffected by this feature.
 */
export async function fetchIcdSettings(hospitalId: string | null | undefined): Promise<{
  activeSet: ActiveSet;
  commonFirst: boolean;
  activeCodeSystem: ActiveCodeSystem;
}> {
  const defaults = { activeSet: "all" as ActiveSet, commonFirst: true, activeCodeSystem: "icd10" as ActiveCodeSystem };
  if (!hospitalId) return defaults;

  try {
    const { data } = await (supabase as any)
      .from("hospital_icd_settings")
      .select("active_set, show_common_first, active_code_system")
      .eq("hospital_id", hospitalId)
      .maybeSingle();

    if (!data) return defaults;
    return {
      activeSet: (data.active_set as ActiveSet) || defaults.activeSet,
      commonFirst: data.show_common_first ?? defaults.commonFirst,
      activeCodeSystem: (data.active_code_system as ActiveCodeSystem) || defaults.activeCodeSystem,
    };
  } catch {
    return defaults;
  }
}

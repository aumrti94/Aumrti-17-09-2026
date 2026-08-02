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
import { normalizeTerm, phoneticNormalize, similarityRatio } from "@/lib/medicalLexicon";

export type CatalogueKind = "lab" | "lab_group" | "radiology";

export interface CatalogueEntry {
  id: string;
  name: string;
  kind: CatalogueKind;
}

export interface OrderCatalogue {
  /** normalizeTerm(name) -> entry, for exact hits. */
  byExact: Map<string, CatalogueEntry>;
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
const CATALOGUE_TTL_MS = 5 * 60 * 1000;
const catalogueCache = new Map<string, { catalogue: OrderCatalogue; loadedAt: number }>();

/** Drop the cached catalogue — call after the hospital edits its test/study masters. */
export function invalidateOrderCatalogue(hospitalId?: string): void {
  if (hospitalId) catalogueCache.delete(hospitalId);
  else catalogueCache.clear();
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

  const [labs, groups, studies] = await Promise.all([
    supabase.from("lab_test_master").select("id, test_name")
      .eq("hospital_id", hospitalId).eq("is_active", true).limit(5000),
    supabase.from("lab_test_groups").select("id, group_name")
      .eq("hospital_id", hospitalId).eq("is_active", true).limit(1000),
    supabase.from("radiology_study_master").select("id, study_name")
      .eq("hospital_id", hospitalId).eq("is_active", true).limit(2000),
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

  const byExact = new Map<string, CatalogueEntry>();
  for (const e of all) {
    const key = normalizeTerm(expandSymbols(e.name));
    if (key && !byExact.has(key)) byExact.set(key, e);
  }

  const catalogue: OrderCatalogue = { byExact, all };
  catalogueCache.set(hospitalId, { catalogue, loadedAt: Date.now() });
  return catalogue;
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
}

/**
 * Match one dictated investigation name against the catalogue.
 *
 * Exact normalised match first, then best phonetic-space match above MATCH_THRESHOLD.
 * The threshold is higher than the drug one because test names are short and share many
 * prefixes ("Urine R/M" vs "Urine Culture"), where a wrong match orders the wrong test.
 */
export function matchOrderName(dictated: string, catalogue: OrderCatalogue): CatalogueEntry | null {
  const q = normalizeTerm(expandSymbols(dictated));
  if (!q) return null;

  const exact = catalogue.byExact.get(q);
  if (exact) return exact;

  const qNorm = phoneticNormalize(expandSymbols(dictated));
  if (!qNorm) return null;

  let best: CatalogueEntry | null = null;
  let bestScore = 0;
  let runnerUp = 0;
  for (const e of catalogue.all) {
    const score = similarityRatio(qNorm, phoneticNormalize(expandSymbols(e.name)));
    if (score > bestScore) { runnerUp = bestScore; bestScore = score; best = e; }
    else if (score > runnerUp) { runnerUp = score; }
  }

  if (bestScore < MATCH_THRESHOLD) return null;
  if (bestScore - runnerUp < 0.02) return null;
  return best;
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
      const hit = matchOrderName(dictated, catalogue);
      if (hit) {
        return { dictated, name: hit.name, kind: hit.kind, catalogueId: hit.id, offered: true };
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

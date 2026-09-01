// Tier four of investigation-name resolution: ask the model about the leftovers.
//
// Tiers one to three live in orderCatalogue.ts and run in the browser — exact name, alias
// table, then token- and phonetic-aware fuzzy matching. They are instant, free and offline.
// Only names none of them can reach come here, because the gap is semantic rather than
// textual ("sugar test", "bleeding profile", a phrasing peculiar to one consultant).
//
// EVERY ACCEPTED ANSWER IS WRITTEN BACK as an alias, so a phrase costs one model call for the
// whole hospital, ever. That is the point of this module as much as the call itself: without
// the write-back, the same three consultants would pay for the same three phrasings every
// morning.
//
// Failure here is never fatal and never blocking. The orders are already on screen; this is an
// upgrade that either arrives or does not. A hospital with the feature switched off, an
// expired AI budget or no network keeps exactly the local behaviour.

import { supabase } from "@/integrations/supabase/client";
import {
  invalidateOrderCatalogue,
  matchOrderNameDetailed,
  type CatalogueKind,
  type OrderCatalogue,
} from "@/lib/orderCatalogue";
import { normalizeTerm } from "@/lib/medicalLexicon";

export interface AIOrderResolution {
  input: string;
  canonicalName: string;
  kind: CatalogueKind;
  confidence: number;
}

/**
 * Below this the model's own answer is discarded.
 *
 * It is not a statistical threshold — it is the point at which "I think" stops being good
 * enough to raise an order and a charge without the doctor having asked for that specific
 * test. A rejected answer costs the doctor one manual selection; an accepted wrong one is an
 * investigation performed on a patient who did not need it.
 */
const MIN_CONFIDENCE = 0.7;

/** Names already sent this session, so a re-render cannot re-ask. */
const asked = new Set<string>();

/** Clear the per-session guard — for tests, and when the hospital context changes. */
export function resetAIOrderResolutionCache(): void {
  asked.clear();
}

/**
 * Resolve names the local tiers could not, and remember the answers.
 *
 * @param catalogue the caller's own catalogue, used to re-validate every answer. The model is
 *   already constrained to a server-computed shortlist; this is the second, independent check
 *   that a name it returned is a row this hospital actually offers.
 */
export async function resolveOrdersWithAI(opts: {
  hospitalId: string;
  names: readonly string[];
  catalogue: OrderCatalogue;
  patientId?: string | null;
  encounterId?: string | null;
}): Promise<AIOrderResolution[]> {
  const { hospitalId, catalogue } = opts;
  if (!hospitalId || !catalogue.all.length) return [];

  const names = Array.from(new Set(
    (opts.names ?? []).map((n) => (n ?? "").trim()).filter(Boolean),
  )).filter((n) => !asked.has(`${hospitalId}:${normalizeTerm(n)}`));

  if (!names.length) return [];
  for (const n of names) asked.add(`${hospitalId}:${normalizeTerm(n)}`);

  try {
    const { data, error } = await supabase.functions.invoke("ai-resolve-orders", {
      body: {
        names,
        patient_id: opts.patientId || null,
        encounter_id: opts.encounterId || null,
      },
    });
    // A 403 here is the hospital's administrator switching the feature off, not a fault.
    if (error || !data || (data as any).error) return [];

    const rows = Array.isArray((data as any).resolutions) ? (data as any).resolutions : [];
    const accepted: AIOrderResolution[] = [];

    for (const r of rows) {
      const input = typeof r?.input === "string" ? r.input : "";
      const canonicalName = typeof r?.canonical_name === "string" ? r.canonical_name : "";
      const confidence = Number(r?.confidence) || 0;
      if (!input || !canonicalName || confidence < MIN_CONFIDENCE) continue;

      // Independent re-check against the catalogue this client actually holds. The server
      // constrains the model to a shortlist; this catches the remaining case where the two
      // views disagree — a test deactivated between the two reads, say.
      const verified = matchOrderNameDetailed(canonicalName, catalogue);
      if (!verified || verified.entry.name !== canonicalName) continue;

      accepted.push({ input, canonicalName, kind: verified.entry.kind, confidence });
    }

    if (accepted.length) await persistAliases(hospitalId, accepted, catalogue);
    return accepted;
  } catch {
    // Never surface this. The doctor is mid-consultation and the orders are on screen either
    // way; a toast about a background matcher is noise they cannot act on.
    return [];
  }
}

/**
 * Write accepted answers to order_name_aliases so the next occurrence resolves locally.
 *
 * `source: 'llm'` never overwrites a row a human wrote — a doctor's correction of a match is
 * the most authoritative signal there is, and the model must not be able to undo it. The
 * partial-index-free way to express that is the WHERE clause on the update path below.
 */
async function persistAliases(
  hospitalId: string,
  accepted: readonly AIOrderResolution[],
  catalogue: OrderCatalogue,
): Promise<void> {
  const rows = accepted.map((a) => ({
    hospital_id: hospitalId,
    raw_name_norm: normalizeTerm(a.input),
    raw_name: a.input,
    canonical_name: a.canonicalName,
    catalogue_kind: a.kind,
    catalogue_id: catalogue.byExact.get(normalizeTerm(a.canonicalName))?.id ?? null,
    source: "llm",
    confidence: a.confidence,
  }));

  const { error } = await (supabase as any)
    .from("order_name_aliases")
    .upsert(rows, { onConflict: "hospital_id,raw_name_norm", ignoreDuplicates: true });

  // A failed write costs one repeated model call later, nothing more — not worth interrupting
  // the consultation for, but worth seeing in the console when tuning cost.
  if (error) {
    console.warn("order_name_aliases write failed (non-fatal):", error.message);
    return;
  }
  // The cached catalogue predates these aliases; drop it so the next lookup picks them up.
  invalidateOrderCatalogue(hospitalId);
}

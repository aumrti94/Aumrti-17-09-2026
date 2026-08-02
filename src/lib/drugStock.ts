// Drug availability lookup: free-text drug name → catalogue row + units on hand.
//
// WHY THIS EXISTS
// Voice-dictated prescriptions landed in the Rx tab as bare text, with no check that the
// hospital stocks the drug, no `drug_master` id, no `is_ndps` flag, and `quantity` hardcoded
// to "" — so there was nothing to bill against and nothing to check stock against. The
// doctor then re-picked every drug by hand.
//
// The lookup itself already existed twice, inlined and un-shared:
//   - src/components/pharmacy/ip/DispensingWorkspace.tsx  (ilike + limit 1, one query per drug)
//   - src/components/pharmacy/retail/RetailDrugSearch.tsx (N+1: one drug_batches query per drug)
// This module is that logic extracted and BATCHED — two queries total regardless of how many
// drugs were dictated, which matters because it now runs on the consultation critical path.
//
// Availability is deliberately conservative: anything we cannot positively confirm is
// reported as unavailable rather than assumed in stock. Over-reporting stock would put a
// drug on a bill the pharmacy cannot dispense.

import { supabase } from "@/integrations/supabase/client";
import { normalizeTerm, phoneticNormalize, similarityRatio } from "@/lib/medicalLexicon";

export interface DrugStockInfo {
  /** drug_master.id */
  drug_id: string;
  /** Canonical name from drug_master, not the dictated text. */
  drug_name: string;
  is_ndps: boolean;
  /** Units across all usable batches. 0 means catalogued but out of stock. */
  total_stock: number;
  /** Earliest-expiring usable batch (FEFO), if any. */
  best_batch: { id: string; batch_number: string; expiry_date: string; quantity_available: number } | null;
}

interface DrugMasterRow {
  id: string;
  drug_name: string;
  generic_name: string | null;
  is_ndps: boolean | null;
}

interface BatchRow {
  id: string;
  drug_id: string;
  batch_number: string;
  expiry_date: string;
  quantity_available: number;
}

/** Below this similarity a name is treated as NOT matched rather than guessed at. */
const MATCH_THRESHOLD = 0.85;

/**
 * Resolve dictated drug names against `drug_master` and `drug_batches`.
 *
 * Returns a Map keyed by the ORIGINAL dictated name (exactly as passed in) so callers can
 * line results back up with what the doctor said. A name absent from the map was not
 * matched to any catalogue row.
 *
 * Two queries total: one `drug_master` fetch, one batched `drug_batches` fetch via `.in()`.
 */
export async function resolveDrugStock(
  hospitalId: string,
  names: readonly string[],
): Promise<Map<string, DrugStockInfo>> {
  const out = new Map<string, DrugStockInfo>();
  const wanted = (names ?? []).map(n => (n ?? "").trim()).filter(Boolean);
  if (!hospitalId || wanted.length === 0) return out;

  // 1. The hospital's active drug catalogue. Fetched whole rather than one ilike per name:
  //    a dictated list is small, the catalogue is bounded, and this is one round trip.
  const { data: masterRows, error: masterErr } = await supabase
    .from("drug_master")
    .select("id, drug_name, generic_name, is_ndps")
    .eq("hospital_id", hospitalId)
    .eq("is_active", true)
    .limit(5000);

  if (masterErr || !masterRows?.length) return out;
  const master = masterRows as unknown as DrugMasterRow[];

  // Match each dictated name to at most one catalogue row.
  const matched = new Map<string, DrugMasterRow>();
  for (const name of wanted) {
    const row = matchDrugName(name, master);
    if (row) matched.set(name, row);
  }
  if (matched.size === 0) return out;

  // 2. Stock for every matched drug in ONE query.
  const drugIds = [...new Set([...matched.values()].map(m => m.id))];
  const today = new Date().toISOString().split("T")[0];

  const { data: batchRows } = await supabase
    .from("drug_batches")
    .select("id, drug_id, batch_number, expiry_date, quantity_available")
    .eq("hospital_id", hospitalId)
    .in("drug_id", drugIds)
    .gt("quantity_available", 0)
    .gt("expiry_date", today)
    .eq("is_active", true)
    .neq("status", "quarantined")
    .neq("status", "destroyed")
    .order("expiry_date", { ascending: true });

  const byDrug = new Map<string, BatchRow[]>();
  for (const b of ((batchRows ?? []) as unknown as BatchRow[])) {
    const list = byDrug.get(b.drug_id);
    if (list) list.push(b);
    else byDrug.set(b.drug_id, [b]);
  }

  for (const [dictated, row] of matched) {
    const batches = byDrug.get(row.id) ?? [];
    out.set(dictated, {
      drug_id: row.id,
      drug_name: row.drug_name,
      is_ndps: row.is_ndps === true,
      total_stock: batches.reduce((s, b) => s + (Number(b.quantity_available) || 0), 0),
      // Already ordered by expiry ascending, so the first is the FEFO pick.
      best_batch: batches[0]
        ? {
            id: batches[0].id,
            batch_number: batches[0].batch_number,
            expiry_date: batches[0].expiry_date,
            quantity_available: Number(batches[0].quantity_available) || 0,
          }
        : null,
    });
  }

  return out;
}

/**
 * Match one dictated name against the catalogue.
 *
 * Exact normalised match wins outright. Otherwise the best phonetic-space match above
 * MATCH_THRESHOLD is taken — reusing the scoring from `medicalLexicon.ts`, which measures
 * similarity AFTER reconciling Indian-English spelling variants (so "Pantacid" vs
 * "Pantacid 40" and "Amoxycillin" vs "Amoxicillin" score as the same drug rather than
 * being penalised for spelling). Below the threshold, nothing is returned: a wrong drug
 * match is far worse than an unmatched one.
 */
export function matchDrugName<T extends { drug_name: string; generic_name?: string | null }>(
  dictated: string,
  catalogue: readonly T[],
): T | null {
  const q = normalizeTerm(dictated);
  if (!q) return null;

  for (const row of catalogue) {
    if (normalizeTerm(row.drug_name) === q) return row;
  }

  // Dictations routinely carry a strength the catalogue name omits ("Pantacid 40").
  const qNorm = phoneticNormalize(stripStrength(dictated));
  if (!qNorm) return null;

  let best: T | null = null;
  let bestScore = 0;
  let runnerUp = 0;

  for (const row of catalogue) {
    const score = Math.max(
      similarityRatio(qNorm, phoneticNormalize(stripStrength(row.drug_name))),
      row.generic_name ? similarityRatio(qNorm, phoneticNormalize(stripStrength(row.generic_name))) : 0,
    );
    if (score > bestScore) { runnerUp = bestScore; bestScore = score; best = row; }
    else if (score > runnerUp) { runnerUp = score; }
  }

  if (bestScore < MATCH_THRESHOLD) return null;
  // Two catalogue entries equally close means we cannot tell which the doctor meant.
  if (bestScore - runnerUp < 0.02) return null;
  return best;
}

/** Drop a trailing strength/unit so "Pantacid 40 mg" compares against "Pantacid". */
export function stripStrength(name: string): string {
  return (name ?? "")
    .replace(/\b\d+(\.\d+)?\s*(mg|mcg|g|ml|iu|%)\b/gi, " ")
    .replace(/\b\d+(\.\d+)?\b/g, " ")
    .trim();
}

/**
 * Units to dispense for a course. Mirrors calcQty in RxOrdersTab so a voice-added drug is
 * quantified the same way a hand-picked one is — without a quantity there is nothing to
 * check against stock and nothing to bill.
 */
export const FREQ_PER_DAY: Record<string, number> = {
  OD: 1, HS: 1, BD: 2, TDS: 3, QID: 4, Q6H: 4, Q8H: 3, Q12H: 2, SOS: 1, STAT: 1,
};

export function calcDrugQuantity(dose: string, frequency: string, durationDays: string): string {
  const perDose = parseFloat((dose ?? "").match(/\d+(\.\d+)?/)?.[0] ?? "1") || 1;
  const perDay = FREQ_PER_DAY[(frequency ?? "").toUpperCase()] ?? 1;
  const days = parseInt(durationDays ?? "", 10);
  if (!Number.isFinite(days) || days <= 0) return "";
  const qty = Math.ceil(perDose * perDay * days);
  return qty > 0 ? String(qty) : "";
}

/**
 * wards.nursing_rate_per_day access, tolerant of the column not existing yet.
 *
 * WHY THIS FILE EXISTS. The column ships in migration 20261011000091. An environment whose
 * database has not had that migration applied still runs this code, and PostgREST answers a
 * select naming an unknown column with error 42703 — not with a null field. Folding the
 * column into an existing select therefore does not degrade, it takes the whole query down:
 * adding it to the Settings → Wards & Beds list blanked the page ("Total Wards 0") even
 * though every ward was still there, and adding it to the IPD admission select would have
 * taken out the room charge and with it the entire discharge sweep.
 *
 * So every read and write of this column goes through here, isolated in its own request. If
 * the column is missing we latch that fact once and report "no nursing rate configured" —
 * which is exactly the column's default meaning (0 = nursing is included in the room rate),
 * so the app behaves correctly rather than merely failing quietly. The moment the migration
 * lands, restart the app and the feature switches on with no code change.
 */

import { supabase } from "@/integrations/supabase/client";

/** Latched after the first 42703 so we don't re-issue a query we know will fail. */
let columnMissing = false;

/** True when the error is Postgres/PostgREST complaining the column isn't there. */
function isMissingColumn(error: any): boolean {
  if (!error) return false;
  // 42703 = undefined_column. PGRST204 = column not found in PostgREST's schema cache,
  // which is what a write against a not-yet-reloaded schema returns.
  if (error.code === "42703" || error.code === "PGRST204") return true;
  const msg = String(error.message || "").toLowerCase();
  return msg.includes("nursing_rate_per_day") &&
    (msg.includes("does not exist") || msg.includes("could not find"));
}

/** True once we know the deployment predates the nursing-rate migration. */
export function nursingRateColumnAvailable(): boolean {
  return !columnMissing;
}

/**
 * The configured nursing rate for one ward. 0 means "included in the room rate" — both when
 * that is what the hospital configured and when the column does not exist yet.
 */
export async function getWardNursingRate(wardId: string | null | undefined): Promise<number> {
  if (!wardId || columnMissing) return 0;
  const { data, error } = await (supabase as any)
    .from("wards")
    .select("nursing_rate_per_day")
    .eq("id", wardId)
    .maybeSingle();
  if (error) {
    if (isMissingColumn(error)) columnMissing = true;
    return 0;
  }
  return Number(data?.nursing_rate_per_day) || 0;
}

/** Nursing rates for every ward, keyed by ward id. Empty when the column is absent. */
export async function getWardNursingRates(): Promise<Record<string, number>> {
  if (columnMissing) return {};
  const { data, error } = await (supabase as any)
    .from("wards")
    .select("id, nursing_rate_per_day");
  if (error) {
    if (isMissingColumn(error)) columnMissing = true;
    return {};
  }
  const out: Record<string, number> = {};
  (data || []).forEach((w: any) => { out[w.id] = Number(w.nursing_rate_per_day) || 0; });
  return out;
}

/**
 * Persist a ward's nursing rate. Returns false (without throwing) when the column is not
 * there yet, so a ward edit that also changes the name and bed count still succeeds — the
 * nursing rate is the only part that can't be saved.
 */
export async function setWardNursingRate(wardId: string, rate: number): Promise<boolean> {
  if (!wardId || columnMissing) return false;
  const { error } = await (supabase as any)
    .from("wards")
    .update({ nursing_rate_per_day: rate })
    .eq("id", wardId);
  if (error) {
    if (isMissingColumn(error)) columnMissing = true;
    return false;
  }
  return true;
}

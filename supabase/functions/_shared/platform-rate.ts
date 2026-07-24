/**
 * The USD→INR rate used to convert provider AI costs into rupees.
 *
 * Its own module so that both the LLM metering path (`ai-config.ts`) and the
 * ASR metering path (`asr-metering.ts`) read ONE definition, without the small
 * transcribe functions having to import the whole AI-config module to get it.
 *
 * Aumrti prices, sells and invoices in rupees; the providers bill in dollars.
 * The rate is manually maintained in /platform rather than fetched live, so a
 * hospital's budget percentage never moves because the market moved, and so a
 * rate change never silently re-values a closed month — each row freezes the
 * rupee figure that was in force when it was written.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Mirrors the DEFAULT on platform_settings.usd_to_inr. */
export const DEFAULT_USD_TO_INR = 85;

// Cached for the life of the isolate: a manually-maintained rate cannot change
// mid-request, and re-reading it per AI call would add a query to a hot path.
let cached: number | null = null;

export async function getUsdToInr(sb: SupabaseClient): Promise<number> {
  if (cached != null) return cached;
  try {
    const { data } = await sb
      .from("platform_settings")
      .select("usd_to_inr")
      .eq("id", true)
      .maybeSingle();
    const rate = Number(data?.usd_to_inr);
    cached = Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_USD_TO_INR;
  } catch {
    // Metering must never fail on a settings lookup. A slightly stale rate is
    // far better than an unrecorded cost.
    cached = DEFAULT_USD_TO_INR;
  }
  return cached;
}

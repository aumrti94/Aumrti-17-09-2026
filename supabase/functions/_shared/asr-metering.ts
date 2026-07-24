/**
 * Speech-to-text (ASR) cost metering.
 *
 * Why this is separate from the metering in `ai-config.ts`: the transcription
 * functions never touch that module. They call Sarvam/Bhashini directly, so the
 * `callAiChatWithUsage` choke point does not see them and their spend has been
 * completely invisible — not in `ai_usage_logs`, not in `ai_cost_daily`, not in
 * any budget.
 *
 * That matters more than the raw number suggests. Voice scribe is one of the
 * three features that carry nearly all AI cost, and a dictated encounter is two
 * halves: transcription (here, billed per audio-minute) and structuring (an LLM
 * call, already metered). Measuring only the second half understates the cost of
 * exactly the feature the pricing work is trying to put a per-encounter price on.
 *
 * ASR is priced per MINUTE OF AUDIO, not per token, so `estimateAiCostUsd` does
 * not apply — rates live in the `asr_pricing` table and are edited in /platform.
 *
 * Everything here is best-effort: metering must never fail a transcription.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getUsdToInr } from "./platform-rate.ts";

/** The catalogue feature key ASR spend is recorded under. */
export const ASR_FEATURE_KEY = "voice_asr_engine";

/**
 * Resolve the calling user's hospital from their JWT.
 *
 * Server-side derivation on purpose: a client-supplied hospital id would let a
 * caller bill another tenant's account, and these functions are invoked straight
 * from the browser.
 *
 * Returns null when unauthenticated or unmapped — the caller should still run
 * the transcription and simply skip metering, because refusing to transcribe
 * over a billing lookup would break a clinical workflow.
 */
export async function resolveHospitalFromJwt(
  req: Request,
  sb: SupabaseClient,
): Promise<string | null> {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return null;

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: { user } } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!user) return null;

    const { data } = await sb
      .from("users")
      .select("hospital_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    return (data?.hospital_id as string | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Estimate audio duration when the provider does not report it.
 *
 * Browser MediaRecorder emits webm/opus, which is constant-ish bitrate, so
 * bytes → seconds is a reasonable approximation. It IS an approximation: any
 * cost derived from it must be labelled as estimated wherever it is shown, and
 * the assumed bitrate is a column in `asr_pricing` rather than a constant here
 * so it can be corrected against real invoices without a deploy.
 */
export function estimateAudioSeconds(byteLength: number, bitrateKbps: number): number {
  const kbps = bitrateKbps > 0 ? bitrateKbps : 24;
  // bytes → bits → seconds
  return Math.max(0, (byteLength * 8) / (kbps * 1000));
}

export interface AsrUsage {
  hospitalId: string | null;
  provider: string;          // 'sarvam' | 'bhashini'
  model: string;
  /** Duration actually billed. */
  seconds: number;
  /** True when `seconds` came from a byte-length estimate rather than the provider. */
  estimated: boolean;
  latencyMs?: number;
  success?: boolean;
  errorMessage?: string;
}

/**
 * Record one transcription against the hospital that caused it.
 *
 * Writes `ai_usage_logs` + the `ai_cost_daily` rollup under ASR_FEATURE_KEY, so
 * ASR shows up in the same budget and dashboard queries as every other AI cost.
 *
 * The resolved duration is stored in `tokens_input` — a deliberate reuse. It
 * keeps the number inspectable without a schema change, and `tokens_input` is
 * meaningless for a per-minute-billed provider anyway. Read it as seconds for
 * rows where `feature_key = 'voice_asr_engine'`.
 */
export async function recordAsrUsage(sb: SupabaseClient, usage: AsrUsage): Promise<void> {
  if (!usage.hospitalId) return;   // unattributable — see resolveHospitalFromJwt

  try {
    // ASR rates are configured directly in RUPEES — unlike LLM providers, whose
    // published rate cards are USD-per-1K-tokens, these are set by an admin in
    // /platform in the currency Aumrti actually prices in. The USD column is
    // still populated (back-converted at the platform rate) so ASR and LLM cost
    // stay reconcilable against provider invoices in one currency.
    const [{ data: pricing }, rate] = await Promise.all([
      sb.from("asr_pricing").select("cost_per_minute_inr").eq("provider", usage.provider).maybeSingle(),
      getUsdToInr(sb),
    ]);

    const perMinuteInr = Number(pricing?.cost_per_minute_inr ?? 0);
    const costInr = (usage.seconds / 60) * perMinuteInr;
    const costUsd = rate > 0 ? costInr / rate : 0;
    const seconds = Math.round(usage.seconds);

    await sb.from("ai_usage_logs").insert({
      hospital_id: usage.hospitalId,
      feature_key: ASR_FEATURE_KEY,
      provider: usage.provider,
      // Suffix marks an estimated duration so a later reconciliation against
      // the provider's invoice can tell measured rows from inferred ones.
      model_name: usage.estimated ? `${usage.model} (est. duration)` : usage.model,
      tokens_input: seconds,     // seconds of audio — see the note above
      tokens_output: 0,
      estimated_cost_usd: costUsd,
      estimated_cost_inr: costInr,
      latency_ms: usage.latencyMs ?? null,
      success: usage.success ?? true,
      error_message: usage.errorMessage ?? null,
    });

    if (usage.success !== false) {
      await sb.rpc("upsert_ai_cost_daily", {
        p_hospital_id:       usage.hospitalId,
        p_date:              new Date().toISOString().split("T")[0],
        p_feature_key:       ASR_FEATURE_KEY,
        p_provider:          usage.provider,
        p_tokens_input:      seconds,
        p_tokens_output:     0,
        p_cache_read_tokens: 0,
        p_cache_hit:         false,
        p_cost_usd:          costUsd,
        p_cost_inr:          costInr,
      });
    }
  } catch (err) {
    console.error("ASR metering failed (non-fatal):", err instanceof Error ? err.message : String(err));
  }
}

/** Bitrate assumption for a provider, from asr_pricing. Falls back to webm/opus typical. */
export async function assumedBitrateKbps(sb: SupabaseClient, provider: string): Promise<number> {
  try {
    const { data } = await sb
      .from("asr_pricing")
      .select("assumed_bitrate_kbps")
      .eq("provider", provider)
      .maybeSingle();
    return Number(data?.assumed_bitrate_kbps ?? 24) || 24;
  } catch {
    return 24;
  }
}

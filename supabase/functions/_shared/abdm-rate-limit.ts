/**
 * _shared/abdm-rate-limit.ts
 *
 * Tumbling-window rate limiter backed by the abdm_rate_limits Postgres table.
 * Uses an atomic upsert RPC so concurrent edge-function invocations can't race.
 *
 * Example:
 *   const { allowed } = await checkRateLimit(sb, `abha_create:${patientId}`, 5, 60);
 *   if (!allowed) return json({ error: "Too many attempts" }, 429);
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type SupabaseLike = ReturnType<typeof createClient>;

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  /** Only present when allowed = false — seconds until the window resets */
  retryAfterSeconds?: number;
}

/**
 * Check (and increment) a rate-limit counter.
 *
 * @param sb          Service-role Supabase client.
 * @param key         Semantic key, e.g. "abha_create:{patient_id}".
 * @param maxCount    Maximum calls allowed within windowMinutes.
 * @param windowMinutes  Tumbling-window length.
 */
export async function checkRateLimit(
  sb: SupabaseLike,
  key: string,
  maxCount: number,
  windowMinutes: number,
): Promise<RateLimitResult> {
  const windowMs = windowMinutes * 60 * 1_000;
  const windowEpoch = Math.floor(Date.now() / windowMs);
  const windowedKey = `${key}:w${windowEpoch}`;

  try {
    const { data, error } = await (sb as any).rpc("abdm_rate_limit_increment", {
      p_key: windowedKey,
      p_window_start: new Date(windowEpoch * windowMs).toISOString(),
    });

    if (error) {
      // Fail open — never block a legitimate request due to a DB hiccup.
      console.warn("abdm-rate-limit: RPC failed, failing open:", error.message);
      return { allowed: true, count: 0 };
    }

    const count = Number(data) ?? 1;
    if (count > maxCount) {
      const windowEndMs = (windowEpoch + 1) * windowMs;
      const retryAfterSeconds = Math.ceil((windowEndMs - Date.now()) / 1_000);
      return { allowed: false, count, retryAfterSeconds };
    }

    return { allowed: true, count };
  } catch (err) {
    console.warn("abdm-rate-limit: unexpected error, failing open:", err);
    return { allowed: true, count: 0 };
  }
}

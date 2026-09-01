/**
 * _shared/api-rate-limit.ts
 *
 * Tumbling-window rate limiter for the PUBLIC API gateway, backed by the api_rate_limits table
 * and an atomic upsert RPC so concurrent edge-function invocations cannot race.
 *
 * Deliberately separate from _shared/abdm-rate-limit.ts, which it otherwise mirrors, for two
 * reasons:
 *
 *  1. Separate counter table. A burst of public API traffic must not contend with, or evict,
 *     the internal ABDM counters that gate a clinician's ABHA lookups.
 *
 *  2. Opposite failure policy. The ABDM limiter fails OPEN — a database hiccup must never block
 *     a clinician mid-workflow, and the caller is already authenticated staff. That reasoning
 *     does not transfer to a public endpoint: a database problem is precisely when an abusive
 *     caller should be shed rather than admitted. This limiter therefore defaults to failing
 *     CLOSED, and the policy is an explicit parameter so the choice is visible at every call
 *     site rather than buried in a catch block.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type SupabaseLike = ReturnType<typeof createClient>;

export type FailurePolicy = "closed" | "open";

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  /** Unix seconds at which the current window resets. */
  resetAt: number;
  /** Present only when allowed = false. */
  retryAfterSeconds?: number;
  /** True when the decision came from the failure policy rather than a real count. */
  degraded?: boolean;
}

/**
 * Check (and increment) a rate-limit counter.
 *
 * @param sb            Service-role Supabase client.
 * @param key           Semantic key, e.g. "key:{api_key_id}".
 * @param maxCount      Maximum calls allowed within the window.
 * @param windowSeconds Tumbling-window length in seconds.
 * @param onError       What to do if the counter itself is unavailable. Defaults to "closed".
 */
export async function checkApiRateLimit(
  sb: SupabaseLike,
  key: string,
  maxCount: number,
  windowSeconds = 60,
  onError: FailurePolicy = "closed",
): Promise<RateLimitResult> {
  const windowMs = windowSeconds * 1_000;
  const windowEpoch = Math.floor(Date.now() / windowMs);
  const windowStartMs = windowEpoch * windowMs;
  const resetAt = Math.floor((windowStartMs + windowMs) / 1000);

  // The window epoch is part of the key, so an expired window is simply a key nobody writes to
  // again. No sweep is needed for correctness — only to reclaim space.
  const windowedKey = `${key}:w${windowEpoch}`;

  try {
    const { data, error } = await (sb as any).rpc("api_rate_limit_increment", {
      p_key: windowedKey,
      p_window_start: new Date(windowStartMs).toISOString(),
    });

    if (error) throw new Error(error.message);

    const count = Number(data) || 0;
    const allowed = count <= maxCount;

    return {
      allowed,
      count,
      limit: maxCount,
      resetAt,
      ...(allowed ? {} : { retryAfterSeconds: Math.max(1, resetAt - Math.floor(Date.now() / 1000)) }),
    };
  } catch (err) {
    // Never log the key — it is derived from a credential id.
    console.warn(`api-rate-limit: counter unavailable, failing ${onError}:`, (err as Error).message);

    if (onError === "open") {
      return { allowed: true, count: 0, limit: maxCount, resetAt, degraded: true };
    }
    return {
      allowed: false,
      count: 0,
      limit: maxCount,
      resetAt,
      retryAfterSeconds: Math.max(1, resetAt - Math.floor(Date.now() / 1000)),
      degraded: true,
    };
  }
}

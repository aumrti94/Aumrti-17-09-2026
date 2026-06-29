/**
 * _shared/abdm-auth.ts — ABDM token retrieval and standard header builder.
 *
 * Import this in any edge function that needs to call the ABDM gateway:
 *
 *   import { getAbdmToken, abdmHeaders } from "../_shared/abdm-auth.ts";
 *
 * NHA docs ref: ABDM Integration Guide v3 — Section 4.2 Common Headers
 */

/**
 * Retrieves a valid ABDM access token for the given hospital.
 *
 * Delegates to the `abdm-gateway-token` edge function which handles
 * caching and refresh internally — callers never need to manage token
 * lifetime themselves.
 *
 * Returns `null` when no credentials are configured (sandbox-format-only
 * mode), so callers can gracefully degrade instead of throwing.
 *
 * @param hospitalId - UUID of the hospital whose credentials to use.
 * @param supabaseClient - A Supabase client instance created inside the
 *   calling edge function (service role key recommended).
 */
export async function getAbdmToken(
  hospitalId: string,
  supabaseClient: {
    functions: {
      invoke: (
        name: string,
        opts: { body: unknown },
      ) => Promise<{ data: unknown; error: unknown }>;
    };
  },
): Promise<string | null> {
  const { data, error } = await supabaseClient.functions.invoke(
    "abdm-gateway-token",
    { body: { hospital_id: hospitalId } },
  );

  if (error) {
    console.error("getAbdmToken: failed to invoke abdm-gateway-token", error);
    return null;
  }

  return (data as Record<string, unknown>)?.accessToken as string ?? null;
}

/**
 * Build the standard HTTP headers required for every ABDM gateway API call.
 *
 * Each call needs a fresh `REQUEST-ID` (UUID) and `TIMESTAMP` — both are
 * generated here so callers don't have to remember.
 *
 * @param token - Bearer token obtained from {@link getAbdmToken}.
 * @param isProduction - `true` for production gateway ("abdm"), `false` for
 *   sandbox ("sbx"). Read this from `hospital_abdm_config.is_production`.
 *
 * NHA docs ref: Section 3.2 — Mandatory Request Headers
 */
export function abdmHeaders(
  token: string,
  isProduction: boolean,
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
    "X-CM-ID": isProduction ? "abdm" : "sbx",
    "REQUEST-ID": crypto.randomUUID(),
    "TIMESTAMP": new Date().toISOString(),
  };
}

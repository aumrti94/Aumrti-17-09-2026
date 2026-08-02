// ────────────────────────────────────────────────────────────────────────────
// Platform Razorpay subscription credentials resolver.
//
// Single source of truth for "which Razorpay keys does the PLATFORM bill with".
// Reads the platform_billing_settings singleton (set from /platform → Payments)
// via the service role, and falls back to the historical edge secrets so a
// deployment that has not populated the row yet keeps working.
//
// Separate from patient-billing keys (those live per-hospital in
// api_configurations). This is Aumrti's own account for charging hospitals.
// ────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface RazorpaySubscriptionKeys {
  keyId: string | null;
  keySecret: string | null;
  webhookSecret: string | null;
  /** null when the row does not exist yet (env-only fallback in play). */
  gatewayEnabled: boolean | null;
  /** Configurable payment-failure access buffer (days); default 3. */
  accessGraceDays: number;
}

/**
 * Resolve the platform's Razorpay subscription keys.
 * @param db a SERVICE-ROLE Supabase client (RLS would otherwise hide the row).
 */
export async function getRazorpaySubscriptionKeys(
  db: SupabaseClient,
): Promise<RazorpaySubscriptionKeys> {
  let row: Record<string, unknown> | null = null;
  try {
    const { data } = await db
      .from("platform_billing_settings")
      .select(
        "razorpay_subscription_key_id, razorpay_subscription_key_secret, " +
        "razorpay_subscription_webhook_secret, payment_gateway_enabled, access_grace_days",
      )
      .eq("id", 1)
      .maybeSingle();
    row = data as Record<string, unknown> | null;
  } catch (_e) {
    // Table/columns not migrated yet — fall through to env vars.
    row = null;
  }

  const pick = (dbVal: unknown, envKey: string): string | null => {
    const v = typeof dbVal === "string" ? dbVal.trim() : "";
    if (v) return v;
    const e = Deno.env.get(envKey);
    return e && e.trim() ? e.trim() : null;
  };

  const graceRaw = row?.access_grace_days;
  const accessGraceDays =
    typeof graceRaw === "number" && Number.isFinite(graceRaw) ? graceRaw : 3;

  return {
    keyId:         pick(row?.razorpay_subscription_key_id, "RAZORPAY_SUBSCRIPTION_KEY_ID"),
    keySecret:     pick(row?.razorpay_subscription_key_secret, "RAZORPAY_SUBSCRIPTION_KEY_SECRET"),
    webhookSecret: pick(row?.razorpay_subscription_webhook_secret, "RAZORPAY_SUBSCRIPTION_WEBHOOK_SECRET"),
    gatewayEnabled: typeof row?.payment_gateway_enabled === "boolean"
      ? (row.payment_gateway_enabled as boolean)
      : null,
    accessGraceDays,
  };
}

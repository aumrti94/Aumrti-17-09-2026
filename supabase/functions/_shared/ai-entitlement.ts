// ============================================================
// Server-side AI entitlement guard — the authoritative twin of the browser gate
// in src/lib/aiEntitlement.ts (isAIFeatureAllowed) + src/hooks/useSubscriptionConfig.ts.
//
// WHY THIS EXISTS
// The client callAI() choke point checks the "AI Features" master switch and the
// per-feature toggles BEFORE spending a rupee — but that check runs in the browser
// and is trivially bypassed by any code that invokes an AI edge function directly
// (ai-executive-digest did exactly this). A hospital on an AI-OFF plan could still
// burn provider credits. This guard re-derives the SAME decision on the server so
// the master switch is enforced where the money is actually spent.
//
// RESOLUTION (must stay in lockstep with the client):
//   master (ai_suite on?)  = hospital_feature_overrides wins over plan_features;
//                            DEFAULT ON — blocked only by an explicit is_enabled=false.
//   per-feature (withheld?)= hospital_module_entitlements.actions[featureKey]
//                            ?? plan_features.actions[featureKey] ?? allowed;
//                            blocked only when the effective value is exactly `false`.
//
// FAIL-OPEN, deliberately: when the hospital can't be identified or a lookup errors,
// AI is ALLOWED — mirrors the fail-open stance of useSubscriptionConfig so a transient
// DB blip never locks paying hospitals out of AI. The hard DENY only fires on a
// definite "disabled" decision. Every AI edge function must read from an admin
// (service-role) client so RLS doesn't hide the entitlement rows.
// ============================================================

// The client is version-agnostic (functions import supabase-js @2 and @2.103.0);
// these files run in Deno and are not part of the app's tsc build, so `any` here is
// intentional — it keeps the guard usable from every function regardless of its
// supabase-js pin without coupling to a specific SupabaseClient type.
// deno-lint-ignore no-explicit-any
type AdminClient = any;

export interface AIEntitlementResult {
  allowed: boolean;
  /** Human-readable reason when allowed === false. Safe to surface to the caller. */
  reason?: string;
}

const MASTER_DISABLED_REASON = "AI features are disabled for this hospital's plan.";

/**
 * Whether an AI feature may run for a hospital, resolved from the DB server-side.
 * Pass a SERVICE-ROLE client so RLS doesn't hide the entitlement rows.
 *
 * @param admin      service-role Supabase client
 * @param hospitalId the hospital the AI call is billed to (fail-open when absent)
 * @param featureKey the AI feature key, e.g. "ai_digest" / "voice_scribe" (optional —
 *                   when absent, only the master switch is checked)
 */
export async function checkAIAllowed(
  admin: AdminClient,
  hospitalId: string | null | undefined,
  featureKey?: string | null,
): Promise<AIEntitlementResult> {
  // Can't identify the hospital → allow (mirrors client fail-open on missing id).
  if (!hospitalId) return { allowed: true };

  try {
    // 1. Which plan is this hospital on? No subscription row → treated as fully open
    //    (the client maps "no_subscription" to every module enabled).
    const { data: sub } = await admin
      .from("hospital_subscriptions")
      .select("plan_id")
      .eq("hospital_id", hospitalId)
      .maybeSingle();
    if (!sub?.plan_id) return { allowed: true };

    // 2. Plan-level ai_suite row: master default (is_enabled) + per-feature defaults (actions).
    const { data: planRow } = await admin
      .from("plan_features")
      .select("is_enabled, actions")
      .eq("plan_id", sub.plan_id)
      .eq("module_key", "ai_suite")
      .maybeSingle();

    // 3. Hospital-level master override (wins over the plan default when present).
    const { data: override } = await admin
      .from("hospital_feature_overrides")
      .select("is_enabled")
      .eq("hospital_id", hospitalId)
      .eq("module_key", "ai_suite")
      .maybeSingle();

    // Master: override value when set, else DEFAULT ON unless the plan explicitly says false.
    const masterOn = override ? override.is_enabled === true : planRow?.is_enabled !== false;
    if (!masterOn) return { allowed: false, reason: MASTER_DISABLED_REASON };

    // 4. Per-feature withhold: hospitalExplicit ?? planDefault ?? allowed.
    if (featureKey) {
      const { data: hospEnt } = await admin
        .from("hospital_module_entitlements")
        .select("actions")
        .eq("hospital_id", hospitalId)
        .eq("module_key", "ai_suite")
        .maybeSingle();

      const hospActions = (hospEnt?.actions ?? {}) as Record<string, boolean>;
      const planActions = (planRow?.actions ?? {}) as Record<string, boolean>;
      // ?? (not ||) so an explicit hospital `false` is respected and an explicit
      // hospital `true` overrides a plan `false` — matches resolveEntitlement().
      const effective = hospActions[featureKey] ?? planActions[featureKey];
      if (effective === false) {
        return { allowed: false, reason: `AI feature "${featureKey}" is disabled for this hospital.` };
      }
    }

    return { allowed: true };
  } catch (_err) {
    // Infra error → fail-open (never lock a paying hospital out of AI over a DB blip).
    return { allowed: true };
  }
}

/**
 * Convenience: resolve a hospital_id from the authenticated auth user, for functions
 * whose request body doesn't carry hospitalId (e.g. ai-executive-digest). Uses the
 * canonical public.users.auth_user_id → hospital_id mapping. Returns null when unknown.
 */
export async function resolveHospitalIdForUser(
  admin: AdminClient,
  authUserId: string | null | undefined,
): Promise<string | null> {
  if (!authUserId) return null;
  try {
    const { data } = await admin
      .from("users")
      .select("hospital_id")
      .eq("auth_user_id", authUserId)
      .maybeSingle();
    return (data?.hospital_id as string) ?? null;
  } catch {
    return null;
  }
}

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { ROUTE_TO_MODULE_KEY, CANONICAL_MODULE_KEYS } from "@/lib/moduleKeys";
// Re-exported for the many consumers that import these from this hook.
export { ROUTE_TO_MODULE_KEY, CANONICAL_MODULE_KEYS };

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface SubscriptionPlan {
  id: string;
  name: string;
  slug: string;
  price_monthly: number;
  price_yearly: number;
  max_beds: number | null;
  max_staff: number | null;
  storage_included_gb: number | null;
  trial_days: number;
  is_custom_price: boolean;
  badge_text: string | null;
  description: string | null;
}

export interface HospitalSubscription {
  id: string;
  hospital_id: string;
  plan_id: string;
  status: "trial" | "active" | "past_due" | "suspended" | "cancelled";
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  razorpay_subscription_id: string | null;
  discount_code_applied: string | null;
  discount_pct: number | null;
  /** Null with a non-zero discount_pct means the discount never expires. */
  discount_expires_at: string | null;
  /** Extra trial days granted by a referral code at signup. */
  trial_bonus_days: number | null;
  conversion_period_start_mode: "conversion_date" | "trial_end" | null;
}

export interface SubscriptionConfig {
  plan: SubscriptionPlan | null;
  subscription: HospitalSubscription | null;
  /** 'no_subscription' means the hospital has no row yet — treated as trial */
  status: HospitalSubscription["status"] | "no_subscription";
  trialDaysLeft: number | null;
  /** Trial expired OR cancelled */
  isExpired: boolean;
  /** Suspended or payment past due */
  isSuspended: boolean;
  /** Final resolved list of accessible module keys */
  enabledModules: string[];
  /** Override price if set by CEO, otherwise plan price */
  effectiveMonthlyPrice: number;
  effectiveYearlyPrice: number;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

// These are always accessible regardless of plan (core UX)
const ALWAYS_ENABLED = new Set(["settings", "inbox", "dashboard"]);

// ─────────────────────────────────────────────────────────────
// Fetcher — runs all 4 Supabase queries in parallel
// ─────────────────────────────────────────────────────────────

async function fetchSubscriptionConfig(hospitalId: string): Promise<Omit<SubscriptionConfig, "isLoading" | "error" | "refetch">> {
  const [subResult, overridesResult, pricingResult] = await Promise.all([
    (supabase as any)
      .from("hospital_subscriptions")
      .select(`
        id, hospital_id, plan_id, status,
        trial_ends_at, current_period_start, current_period_end,
        razorpay_subscription_id, discount_code_applied, discount_pct,
        discount_expires_at, trial_bonus_days, conversion_period_start_mode
      `)
      .eq("hospital_id", hospitalId)
      .maybeSingle(),

    (supabase as any)
      .from("hospital_feature_overrides")
      .select("module_key, is_enabled")
      .eq("hospital_id", hospitalId),

    (supabase as any)
      .from("hospital_pricing_overrides")
      .select("monthly_price, yearly_price, valid_until")
      .eq("hospital_id", hospitalId)
      .maybeSingle(),
  ]);

  if (subResult.error) throw subResult.error;

  const subscription = subResult.data as HospitalSubscription | null;

  // ── No subscription yet ── treat as trial with all modules open
  if (!subscription) {
    return {
      plan: null,
      subscription: null,
      status: "no_subscription",
      trialDaysLeft: 30,
      isExpired: false,
      isSuspended: false,
      enabledModules: CANONICAL_MODULE_KEYS, // fully permissive until CEO assigns a plan
      effectiveMonthlyPrice: 0,
      effectiveYearlyPrice: 0,
    };
  }

  // ── Fetch plan features for their plan ──
  const { data: planFeatures } = await (supabase as any)
    .from("plan_features")
    .select("module_key, is_enabled")
    .eq("plan_id", subscription.plan_id);

  // ── Fetch plan details ──
  const { data: planData } = await (supabase as any)
    .from("subscription_plans")
    .select("id, name, slug, price_monthly, price_yearly, max_beds, max_staff, storage_included_gb, trial_days, is_custom_price, badge_text, description")
    .eq("id", subscription.plan_id)
    .maybeSingle();

  const plan = planData as SubscriptionPlan | null;

  // ── Resolve enabled modules ──
  // Priority: hospital_feature_overrides > plan_features > ALWAYS_ENABLED
  const planMap = new Map<string, boolean>(
    (planFeatures || []).map((f: any) => [f.module_key as string, f.is_enabled as boolean])
  );
  const overrideMap = new Map<string, boolean>(
    (overridesResult.data || []).map((o: any) => [o.module_key as string, o.is_enabled as boolean])
  );

  const enabledModules: string[] = [];
  for (const key of CANONICAL_MODULE_KEYS) {
    if (ALWAYS_ENABLED.has(key)) {
      enabledModules.push(key);
      continue;
    }
    if (overrideMap.has(key)) {
      if (overrideMap.get(key)) enabledModules.push(key);
    } else if (planMap.size === 0) {
      // No plan_features rows → treat as fully open (legacy hospital)
      enabledModules.push(key);
    } else if (planMap.get(key) === true) {
      enabledModules.push(key);
    } else if (key === "ai_suite" && planMap.get(key) !== false) {
      // AI master defaults ON: enabled unless the plan explicitly disables it
      // (a plan predating this feature has no ai_suite row → AI stays on).
      enabledModules.push(key);
    }
  }

  // ── Resolve pricing ──
  let effectiveMonthlyPrice = plan?.price_monthly ?? 0;
  let effectiveYearlyPrice = plan?.price_yearly ?? 0;
  const pricing = pricingResult.data;
  if (pricing) {
    const validUntil = pricing.valid_until ? new Date(pricing.valid_until) : null;
    if (!validUntil || validUntil > new Date()) {
      if (pricing.monthly_price != null) effectiveMonthlyPrice = pricing.monthly_price;
      if (pricing.yearly_price != null) effectiveYearlyPrice = pricing.yearly_price;
    }
  }

  // ── Trial days left ──
  let trialDaysLeft: number | null = null;
  if (subscription.status === "trial" && subscription.trial_ends_at) {
    const msLeft = new Date(subscription.trial_ends_at).getTime() - Date.now();
    trialDaysLeft = Math.max(0, Math.ceil(msLeft / 86_400_000));
  }

  const isExpired =
    (subscription.status === "trial" && trialDaysLeft === 0) ||
    subscription.status === "cancelled";
  const isSuspended =
    subscription.status === "suspended" ||
    subscription.status === "past_due";

  return {
    plan,
    subscription,
    status: subscription.status,
    trialDaysLeft,
    isExpired,
    isSuspended,
    enabledModules,
    effectiveMonthlyPrice,
    effectiveYearlyPrice,
  };
}

// ─────────────────────────────────────────────────────────────
// Realtime entitlement channel — ONE shared, ref-counted channel per hospital.
// useSubscriptionConfig is called by dozens of components at once; creating a
// channel per instance made them all fight over the same topic and threw
// "cannot add postgres_changes callbacks after subscribe()". A module-level
// registry guarantees a single channel, added-then-subscribed exactly once, and
// torn down only when the last consumer unmounts.
// ─────────────────────────────────────────────────────────────

type EntitlementChannel = ReturnType<typeof supabase.channel>;
const entitlementChannels = new Map<string, { channel: EntitlementChannel; count: number }>();

function subscribeEntitlements(
  hospitalId: string,
  invalidate: () => void,
): () => void {
  let entry = entitlementChannels.get(hospitalId);
  if (!entry) {
    const channel = supabase
      .channel(`subscription-config-${hospitalId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "hospital_subscriptions", filter: `hospital_id=eq.${hospitalId}` }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "hospital_feature_overrides", filter: `hospital_id=eq.${hospitalId}` }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "hospital_pricing_overrides", filter: `hospital_id=eq.${hospitalId}` }, invalidate)
      .subscribe();
    entry = { channel, count: 0 };
    entitlementChannels.set(hospitalId, entry);
  }
  entry.count += 1;

  return () => {
    const e = entitlementChannels.get(hospitalId);
    if (!e) return;
    e.count -= 1;
    if (e.count <= 0) {
      supabase.removeChannel(e.channel);
      entitlementChannels.delete(hospitalId);
    }
  };
}

// ─────────────────────────────────────────────────────────────
// useSubscriptionConfig — main hook
// Uses TanStack Query so multiple components calling this hook
// share a single cached fetch per hospitalId (no duplicate RPCs).
// staleTime: 5 minutes — subscription data changes rarely.
// Fail-open: on DB error, all modules remain accessible.
// ─────────────────────────────────────────────────────────────

export function useSubscriptionConfig(): SubscriptionConfig {
  const { hospitalId } = useHospitalId();
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["subscription-config", hospitalId],
    queryFn: () => fetchSubscriptionConfig(hospitalId!),
    enabled: !!hospitalId,
    // Short stale window so a plan change propagates to entitlements/limits promptly
    // even if realtime isn't enabled on these tables. The realtime listener below
    // handles the instant, cross-session case.
    staleTime: 60 * 1000,           // 1 minute
    gcTime: 10 * 60 * 1000,         // 10 minutes
    refetchOnWindowFocus: true,     // re-check when returning to the tab
    retry: 2,
    // Fail-open: on error return all modules so hospital is never locked out
    // due to a transient DB issue
  });

  // Instantly refresh entitlements when the platform admin changes this hospital's
  // plan, feature overrides, or pricing — no waiting for the stale window. Without
  // this, a Starter→Clinics switch kept serving the old plan's module access.
  // Delegates to a single shared, ref-counted channel (see subscribeEntitlements).
  useEffect(() => {
    if (!hospitalId) return;
    return subscribeEntitlements(hospitalId, () =>
      queryClient.invalidateQueries({ queryKey: ["subscription-config", hospitalId] }),
    );
  }, [hospitalId, queryClient]);

  // The fail-open path above is otherwise silent — log it so it's at least
  // visible somewhere, since a hospital getting free module access during
  // an outage is a real (if rare) billing-integrity event.
  useEffect(() => {
    if (error && hospitalId) {
      (supabase as any)
        .from("entitlement_fail_open_events")
        .insert({
          hospital_id: hospitalId,
          error_message: error instanceof Error ? error.message : String(error),
        })
        .then(() => {})
        .catch(() => {});
    }
  }, [error, hospitalId]);

  if (!hospitalId || isLoading) {
    return {
      plan: null,
      subscription: null,
      status: "no_subscription",
      trialDaysLeft: null,
      isExpired: false,
      isSuspended: false,
      enabledModules: CANONICAL_MODULE_KEYS,
      effectiveMonthlyPrice: 0,
      effectiveYearlyPrice: 0,
      isLoading: true,
      error: null,
      refetch,
    };
  }

  if (error || !data) {
    return {
      plan: null,
      subscription: null,
      status: "no_subscription",
      trialDaysLeft: null,
      isExpired: false,
      isSuspended: false,
      enabledModules: CANONICAL_MODULE_KEYS, // fail-open
      effectiveMonthlyPrice: 0,
      effectiveYearlyPrice: 0,
      isLoading: false,
      error: error instanceof Error ? error.message : "Failed to load subscription",
      refetch,
    };
  }

  return { ...data, isLoading: false, error: null, refetch };
}

// ─────────────────────────────────────────────────────────────
// useModuleAccess — thin wrapper for per-module gate checks
// Usage: const canAccessOncology = useModuleAccess("oncology");
// Returns true while loading (optimistic) so UI doesn't flash locked.
// TanStack Query deduplicates — calling this in 50 components = 1 fetch.
// ─────────────────────────────────────────────────────────────

export function useModuleAccess(moduleKey: string): boolean {
  const { enabledModules, isLoading } = useSubscriptionConfig();
  if (isLoading) return true;
  return enabledModules.includes(moduleKey);
}

// ─────────────────────────────────────────────────────────────
// getModuleKeyFromRoute — utility for guards and nav
// Usage: getModuleKeyFromRoute("/oncology") → "oncology"
// ─────────────────────────────────────────────────────────────

export function getModuleKeyFromRoute(route: string): string | null {
  const base = route.split("?")[0];
  return ROUTE_TO_MODULE_KEY[base] ?? null;
}

// ─────────────────────────────────────────────────────────────
// getModuleKeyForPath — resolve the gateable module key for an arbitrary
// pathname (handles sub-routes and params via longest segment-prefix match).
// e.g. "/quality/events" → "quality", "/ipd/icu/123" → "ipd",
//      "/billing/closure" → "day_closure" (exact). Returns null for paths that
// aren't gateable modules (dashboard, schedule, settings/*, patients, …).
// Used by the central <ModuleGate> so EVERY route is enforced, not just the
// ones that remembered to wrap themselves.
// ─────────────────────────────────────────────────────────────

export function getModuleKeyForPath(pathname: string): string | null {
  const path = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  let bestKey: string | null = null;
  let bestLen = -1;
  for (const route of Object.keys(ROUTE_TO_MODULE_KEY)) {
    const base = route.split("?")[0];
    if (!base.startsWith("/")) continue;
    // Segment-aware match: exact, or pathname is a sub-path of base.
    if (path === base || path.startsWith(base + "/")) {
      if (base.length > bestLen) {
        bestLen = base.length;
        bestKey = ROUTE_TO_MODULE_KEY[route];
      }
    }
  }
  return bestKey;
}

// ─────────────────────────────────────────────────────────────
// isModuleKeyAllowed — shared subscription-level allow decision.
// Untracked keys (not in the plan catalog) and ALWAYS_ENABLED are always allowed.
// ─────────────────────────────────────────────────────────────

export function isModuleKeyAllowed(moduleKey: string, enabledModules: string[]): boolean {
  if (ALWAYS_ENABLED.has(moduleKey)) return true;
  const isTracked = CANONICAL_MODULE_KEYS.includes(moduleKey);
  return !isTracked || enabledModules.includes(moduleKey);
}

/**
 * subscriptionAccess — the single definition of "is this hospital's subscription
 * still entitled to WRITE?".
 *
 * Why this exists
 * ---------------
 * An expired trial was purely cosmetic. `useSubscriptionConfig` computed
 * `isExpired`/`isSuspended` correctly, but the only consumers were the red banner and
 * the Plan & Billing page — both display-only. The one enforcement point,
 * `<ModuleGate>`, reads `enabledModules`, which is derived from plan_features +
 * hospital_feature_overrides and never looks at `status`. So a hospital whose trial ran
 * out kept registering patients, running consultations and collecting cash exactly as
 * before, with nothing but a dismissable banner to say otherwise.
 *
 * This module is the rule; `src/lib/subscriptionLock.ts` + the DB trigger in migration
 * ...163_enforce_subscription_access.sql are the two places that enforce it. The SQL
 * function `public.subscription_access_blocked()` is a MIRROR of `resolveSubscriptionAccess`
 * — change both together or the client and the database will disagree about who may write.
 *
 * The lockout is READ-ONLY, not a lockout screen: a live hospital must never lose the
 * ability to read its own medical records over a billing dispute.
 */

/** Days after `trial_ends_at` during which writes still work (escalating banner only). */
export const SUBSCRIPTION_GRACE_DAYS = 3;

const DAY_MS = 86_400_000;

export type AccessBlockReason = "trial_expired" | "suspended" | "cancelled";

export interface SubscriptionAccess {
  /** True = every write must be refused. */
  blocked: boolean;
  reason: AccessBlockReason | null;
  /** When writes stop (trial only); null when already blocked or not applicable. */
  graceEndsAt: Date | null;
  /** True while the trial is over but the grace window has not closed yet. */
  inGrace: boolean;
}

/** Shape needed from a `hospital_subscriptions` row — a subset, so callers can pass theirs. */
export interface SubscriptionAccessInput {
  status: string;
  trial_ends_at?: string | null;
}

const ALLOWED: SubscriptionAccess = { blocked: false, reason: null, graceEndsAt: null, inGrace: false };

/**
 * PURE. Decide whether writes are allowed.
 *
 * Rules:
 *   trial      → blocked once now > trial_ends_at + SUBSCRIPTION_GRACE_DAYS
 *   suspended  → blocked immediately (suspension already followed a grace/dunning window)
 *   cancelled  → blocked immediately
 *   past_due   → ALLOWED; the dunning path (dunning-processor → trial-lifecycle-cron)
 *                suspends it after 7 days, and suspension blocks. Blocking here too would
 *                cut a hospital off on day 1 of a late payment.
 *   active     → allowed
 *   no row     → allowed (onboarding — matches the fail-open in useSubscriptionConfig)
 *
 * Deliberately date-driven rather than status-driven for trials: `trial-lifecycle-cron` is
 * what flips an expired trial to `suspended`, and it demonstrably has not always run. An
 * enforcement rule that depends on a cron having fired is not an enforcement rule.
 *
 * Fail-open everywhere: a missing row, an unparseable date or an unknown status all allow.
 */
export function resolveSubscriptionAccess(
  sub: SubscriptionAccessInput | null | undefined,
  now: Date = new Date(),
): SubscriptionAccess {
  if (!sub) return ALLOWED;

  const status = String(sub.status || "").toLowerCase();

  if (status === "suspended") return { blocked: true, reason: "suspended", graceEndsAt: null, inGrace: false };
  if (status === "cancelled") return { blocked: true, reason: "cancelled", graceEndsAt: null, inGrace: false };

  if (status === "trial") {
    if (!sub.trial_ends_at) return ALLOWED; // open-ended trial — never auto-blocks
    const endsAt = new Date(sub.trial_ends_at).getTime();
    if (!Number.isFinite(endsAt)) return ALLOWED;

    const graceEndsAt = new Date(endsAt + SUBSCRIPTION_GRACE_DAYS * DAY_MS);
    if (now.getTime() > graceEndsAt.getTime()) {
      return { blocked: true, reason: "trial_expired", graceEndsAt, inGrace: false };
    }
    return {
      blocked: false,
      reason: null,
      graceEndsAt,
      inGrace: now.getTime() > endsAt,
    };
  }

  return ALLOWED;
}

/** The one message shown wherever a write is refused. */
export const SUBSCRIPTION_BLOCKED_MESSAGE =
  "Your subscription is inactive — the system is read-only. Contact support to restore full access.";

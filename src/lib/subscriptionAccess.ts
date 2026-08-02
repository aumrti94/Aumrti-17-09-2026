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

/**
 * Default grace/buffer in days. The live value is configurable from
 * /platform → Payments (platform_billing_settings.access_grace_days) and is
 * threaded in via the `graceDays` argument; this constant is the fallback used
 * when the config has not loaded (and in the DB mirror's COALESCE).
 */
export const SUBSCRIPTION_GRACE_DAYS = 3;

const DAY_MS = 86_400_000;

export type AccessBlockReason = "trial_expired" | "suspended" | "cancelled" | "past_due";

export interface SubscriptionAccess {
  /** True = every write must be refused. */
  blocked: boolean;
  reason: AccessBlockReason | null;
  /** When writes stop (trial or past_due); null when already blocked or not applicable. */
  graceEndsAt: Date | null;
  /** True while past the due date/trial end but the buffer has not closed yet. */
  inGrace: boolean;
}

/** Shape needed from a `hospital_subscriptions` row — a subset, so callers can pass theirs. */
export interface SubscriptionAccessInput {
  status: string;
  trial_ends_at?: string | null;
  /** When the last renewal failed (status went past_due). Anchors the buffer. */
  past_due_since?: string | null;
}

const ALLOWED: SubscriptionAccess = { blocked: false, reason: null, graceEndsAt: null, inGrace: false };

/**
 * PURE. Decide whether writes are allowed.
 *
 * Rules (`graceDays` defaults to SUBSCRIPTION_GRACE_DAYS; the live value comes
 * from /platform → Payments):
 *   trial      → blocked once now > trial_ends_at + graceDays
 *   suspended  → blocked immediately (suspension already followed a grace/dunning window)
 *   cancelled  → blocked immediately
 *   past_due   → blocked once now > past_due_since + graceDays; a failed renewal
 *                keeps writing for the buffer, then goes read-only. No anchor
 *                (past_due_since null) → allowed until the webhook stamps it.
 *   active     → allowed
 *   no row     → allowed (onboarding — matches the fail-open in useSubscriptionConfig)
 *
 * Deliberately date-driven rather than status-driven: the crons that flip
 * trial/past_due to `suspended` demonstrably have not always run. An enforcement
 * rule that depends on a cron having fired is not an enforcement rule.
 *
 * Fail-open everywhere: a missing row, an unparseable date or an unknown status all allow.
 */
export function resolveSubscriptionAccess(
  sub: SubscriptionAccessInput | null | undefined,
  now: Date = new Date(),
  graceDays: number = SUBSCRIPTION_GRACE_DAYS,
): SubscriptionAccess {
  if (!sub) return ALLOWED;

  const status = String(sub.status || "").toLowerCase();
  const graceMs = (Number.isFinite(graceDays) ? graceDays : SUBSCRIPTION_GRACE_DAYS) * DAY_MS;

  if (status === "suspended") return { blocked: true, reason: "suspended", graceEndsAt: null, inGrace: false };
  if (status === "cancelled") return { blocked: true, reason: "cancelled", graceEndsAt: null, inGrace: false };

  if (status === "trial") {
    if (!sub.trial_ends_at) return ALLOWED; // open-ended trial — never auto-blocks
    const endsAt = new Date(sub.trial_ends_at).getTime();
    if (!Number.isFinite(endsAt)) return ALLOWED;

    const graceEndsAt = new Date(endsAt + graceMs);
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

  if (status === "past_due") {
    if (!sub.past_due_since) return ALLOWED; // no anchor yet — webhook stamps it
    const dueAt = new Date(sub.past_due_since).getTime();
    if (!Number.isFinite(dueAt)) return ALLOWED;

    const graceEndsAt = new Date(dueAt + graceMs);
    if (now.getTime() > graceEndsAt.getTime()) {
      return { blocked: true, reason: "past_due", graceEndsAt, inGrace: false };
    }
    return { blocked: false, reason: null, graceEndsAt, inGrace: true };
  }

  return ALLOWED;
}

/** The one message shown wherever a write is refused. */
export const SUBSCRIPTION_BLOCKED_MESSAGE =
  "Your subscription is inactive — the system is read-only. Contact support to restore full access.";

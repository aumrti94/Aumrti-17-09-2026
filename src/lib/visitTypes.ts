/**
 * OPD visit vocabularies — the three that exist, why they are three and not one, and the
 * mappings between them.
 *
 * THE DRIFT THIS ENDS. Four spellings of the same clinical idea are live in this codebase —
 * `followup`, `follow_up`, `revisit`, `review` — across three columns with three different
 * CHECK constraints. They were compared inline at ~40 call sites, so "is this a follow-up?"
 * had a different answer depending on which screen asked. Migration 20261015000002 already
 * defensively handles two spellings at once, which is the tell that someone hit this and
 * patched around it.
 *
 * WHY NOT ONE CONSTANT. The obvious fix — collapse everything to one vocabulary — would be
 * wrong, and 20261015000002 says so in its own comment: `visit_type` is **UI intent** and
 * `charged_tier` is **what actually billed**. Conflating them "would let a visit marked
 * 'followup' but billed at full fee still burn the allowance", silently mispricing the
 * patient's next visit. The distinction is load-bearing.
 *
 * So this module does what payerTypes.ts does: it centralises each vocabulary and the
 * predicates, rather than flattening them. One place to add a spelling, one predicate to
 * ask the question, and no inline string comparison anywhere else.
 */

// ── The three vocabularies, each pinned to its own CHECK constraint ──────────

/**
 * `opd_tokens.visit_type` — CHECK at 20260904000025.
 * UI intent, set by the receptionist. NOT a pricing input on its own.
 */
export const VISIT_TYPES = ["new", "revisit", "followup", "emergency"] as const;
export type VisitType = (typeof VISIT_TYPES)[number];

/**
 * `appointments.visit_purpose` / `opd_visits.visit_purpose` — CHECK at 20260908000006.
 * Finer-grained clinical reason for the visit.
 */
export const VISIT_PURPOSES = ["new", "revisit", "follow_up", "emergency", "procedure", "review"] as const;
export type VisitPurpose = (typeof VISIT_PURPOSES)[number];

/**
 * `opd_tokens.charged_tier` — CHECK at 20261015000002.
 * Which consultation rate the fee engine actually landed on. Drives episode and follow-up
 * allowance counting in consultationFee.ts, so it is the only one of the three that may be
 * counted for pricing.
 */
export const CHARGED_TIERS = ["new", "follow_up", "emergency"] as const;
export type ChargedTier = (typeof CHARGED_TIERS)[number];

/**
 * `appointments.visit_type` — only ever 'new' or 'follow_up' (see WalkInModal's booking
 * write). Narrower than `opd_tokens.visit_type`, and a different column despite the name.
 */
export const APPOINTMENT_VISIT_TYPES = ["new", "follow_up"] as const;
export type AppointmentVisitType = (typeof APPOINTMENT_VISIT_TYPES)[number];

// ── Predicates ──────────────────────────────────────────────────────────────

/**
 * Every spelling that means "this patient has been seen for this problem before".
 *
 * Deliberately spans all three vocabularies: callers ask the question without first having
 * to know which column their value came from, which is exactly the mistake that produced
 * the drift. Matching is case-insensitive and trimmed, like bundlesNursingIntoRoom.
 */
const RETURNING_VISIT_VALUES = new Set<string>([
  "revisit",
  "followup",
  "follow_up",
  "review",
]);

/** True when the value — in any of the three vocabularies — means a returning visit. */
export function isReturningVisit(value: string | null | undefined): boolean {
  if (!value) return false;
  return RETURNING_VISIT_VALUES.has(value.trim().toLowerCase());
}

/**
 * True when the visit should be considered for the FOLLOW-UP RATE.
 *
 * Narrower than isReturningVisit on purpose. A `revisit` is the same problem seen again and
 * may attract a revisit discount; a `follow_up`/`review` is the doctor's own scheduled
 * review and is what the follow-up fee and its visit cap are for. Collapsing the two would
 * hand the follow-up allowance to visits that were never meant to spend it.
 */
const FOLLOW_UP_VALUES = new Set<string>(["followup", "follow_up", "review"]);

export function isFollowUpVisit(value: string | null | undefined): boolean {
  if (!value) return false;
  return FOLLOW_UP_VALUES.has(value.trim().toLowerCase());
}

// ── Mappings ────────────────────────────────────────────────────────────────

/**
 * `charged_tier` → the `visit_type` that would have produced it.
 *
 * Used when re-pricing an existing token: the tier is what actually billed last time, and
 * priceConsultation takes UI-intent vocabulary. This was an inline ternary in
 * ConsultationWorkspace, which is how `follow_up` came to be compared against a column whose
 * CHECK only allows `followup`.
 */
export function chargedTierToVisitType(tier: string | null | undefined): VisitType {
  const t = (tier ?? "").trim().toLowerCase();
  if (t === "emergency") return "emergency";
  if (t === "follow_up") return "followup";
  return "new";
}

/** `visit_type` → the `appointments.visit_type` value to persist. */
export function visitTypeToAppointmentVisitType(visitType: string | null | undefined): AppointmentVisitType {
  return isReturningVisit(visitType) ? "follow_up" : "new";
}

/** `visit_purpose` → the `visit_type` to show on the queue. */
export function visitPurposeToVisitType(purpose: string | null | undefined): VisitType {
  const p = (purpose ?? "").trim().toLowerCase();
  if (p === "emergency") return "emergency";
  if (p === "revisit") return "revisit";
  if (isFollowUpVisit(p)) return "followup";
  return "new";
}

// ── Narrowing helpers for values arriving from the database ─────────────────

const inVocabulary = <T extends readonly string[]>(vocab: T, value: unknown): value is T[number] =>
  typeof value === "string" && (vocab as readonly string[]).includes(value);

/** Coerce an untrusted value to a valid visit_type, defaulting to 'new'. */
export function toVisitType(value: unknown): VisitType {
  return inVocabulary(VISIT_TYPES, value) ? value : "new";
}

/** Coerce an untrusted value to a valid visit_purpose, defaulting to 'new'. */
export function toVisitPurpose(value: unknown): VisitPurpose {
  return inVocabulary(VISIT_PURPOSES, value) ? value : "new";
}

/** Coerce an untrusted value to a valid charged_tier, defaulting to 'new'. */
export function toChargedTier(value: unknown): ChargedTier {
  return inVocabulary(CHARGED_TIERS, value) ? value : "new";
}

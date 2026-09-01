/**
 * consultationFee — the single source of truth for what an OPD consultation costs.
 *
 * WHY THIS EXISTS. Three separate engines used to price the same visit and they disagreed:
 *
 *   1. WalkInModal      — a 4-tier rate ladder plus follow-up / emergency / revisit rules.
 *   2. ConsultationWorkspace.handleComplete — its OWN 4-tier ladder with no follow-up logic
 *                         at all, so the amount POSTED to the bill could differ from the
 *                         amount COLLECTED at the desk minutes earlier.
 *   3. book_public_appointment (RPC) — reads users.consultation_fee, a column that does not
 *                         exist in any migration.
 *
 * Both TS ladders also had guard bugs that quietly produced a "global price" where a
 * doctor's own rate was configured:
 *   • `if (data?.[0]?.fee)` — a configured ₹0 is falsy, so it fell through to the next tier.
 *   • `if (fee === 500)` used as a "not found yet" sentinel — a doctor legitimately priced
 *     at exactly ₹500 fell through to the department and global tiers.
 * Both are fixed here by testing `!= null` and by tracking resolution with an explicit
 * `source` instead of a magic number.
 *
 * THE PRICING RULE (episode-anchored):
 *   • An EPISODE begins at the last full-fee ('new') consultation with that doctor — the
 *     anchor.
 *   • Inside `validityDays` of the anchor, the next `followUpMaxVisits` visits bill
 *     `followUpFee`.
 *   • When the allowance is spent, or the window expires, the visit bills the full fee and
 *     opens a NEW episode with a fresh allowance.
 *   • The window is measured from the ANCHOR, not from the most recent visit, so a string
 *     of follow-ups cannot silently extend it.
 *
 * Precedence is emergency → follow-up → revisit-discount → base. Emergency outranks
 * everything because it is a different service, not a discounted one.
 *
 * `computeConsultationFee` is deliberately PURE — no Supabase, no clock — so the rule above
 * is unit-testable without a database. See consultationFee.test.ts.
 */

import { supabase } from "@/integrations/supabase/client";

/** Last-resort fee when a hospital has configured no consultation rate anywhere. */
export const DEFAULT_CONSULTATION_FEE = 500;

/** Which tier of the rate ladder answered. Surfaced in the UI so "default" is visible. */
export type RateSource = "doctor" | "dept" | "global" | "default";

/** Which rate actually billed. Persisted to opd_tokens.charged_tier for episode counting. */
export type ChargedTier = "new" | "follow_up" | "emergency";

export interface ConsultationRate {
  /** Full consultation fee. */
  fee: number;
  /**
   * Configured follow-up fee, or null when the doctor/dept has none.
   * 0 and null are NOT interchangeable: 0 is a deliberate FREE follow-up and must bill ₹0,
   * whereas null means "no follow-up rate configured" and falls back to the full fee.
   */
  followUpFee: number | null;
  /** Days from the anchor consultation during which the follow-up rate applies. */
  followUpValidityDays: number;
  /** How many visits per episode may take the follow-up rate. null = unlimited. */
  followUpMaxVisits: number | null;
  /** Emergency rate; 0 means "not configured", in which case the base fee is used. */
  emergencyFee: number;
  source: RateSource;
}

export interface FeeEpisode {
  /** Date (YYYY-MM-DD) of the full-fee consultation this episode hangs off, if any. */
  anchorDate: string | null;
  /** opd_tokens.id of that anchor visit — persisted as revisit_of_token_id. */
  anchorTokenId: string | null;
  /** Doctor's display name on the anchor visit, for the "last visit" banner. */
  anchorDoctorName: string | null;
  /** Follow-up-priced visits already taken since the anchor. */
  followUpsUsed: number;
  /** Is `asOfDate` still inside validityDays of the anchor? */
  withinValidity: boolean;
  /** Has the allowance been spent? Always false when followUpMaxVisits is null. */
  capReached: boolean;
  /** Whole days between the anchor and asOfDate; null when there is no anchor. */
  daysSinceAnchor: number | null;
}

export interface RevisitRule {
  within_days: number;
  same_doctor: boolean;
  discount_type: "free" | "percent" | "fixed";
  amount: number;
}

export interface ComputedFee {
  fee: number;
  tier: ChargedTier;
  /** Human-readable justification, shown on the payment step so the desk can see why. */
  reason: string;
  /** Amount knocked off the base fee by an opd_revisit_rules rule, if any. */
  revisitDiscount: number;
  revisitDiscountNote: string;
}

export const NO_EPISODE: FeeEpisode = {
  anchorDate: null,
  anchorTokenId: null,
  anchorDoctorName: null,
  followUpsUsed: 0,
  withinValidity: false,
  capReached: false,
  daysSinceAnchor: null,
};

/** Local YYYY-MM-DD. Avoids toISOString(), which shifts a late-evening IST date back a day. */
export function toDateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Whole days between two YYYY-MM-DD keys, computed at UTC noon so DST cannot round wrong. */
export function daysBetween(fromKey: string, toKey: string): number {
  const a = Date.parse(`${fromKey}T12:00:00Z`);
  const b = Date.parse(`${toKey}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

const SELECT_RATE = "fee, follow_up_fee, validity_days, follow_up_max_visits, emergency_fee";

function toRate(row: Record<string, unknown>, source: RateSource): ConsultationRate {
  return {
    fee: Number(row.fee),
    // ?? not || — a stored 0 is a free follow-up and must survive.
    followUpFee: row.follow_up_fee == null ? null : Number(row.follow_up_fee),
    followUpValidityDays: Number(row.validity_days) || 7,
    followUpMaxVisits: row.follow_up_max_visits == null ? null : Number(row.follow_up_max_visits),
    emergencyFee: Number(row.emergency_fee) || 0,
    source,
  };
}

export const FALLBACK_RATE: ConsultationRate = {
  fee: DEFAULT_CONSULTATION_FEE,
  followUpFee: null,
  followUpValidityDays: 7,
  followUpMaxVisits: null,
  emergencyFee: 0,
  source: "default",
};

/**
 * Resolve the applicable rate: doctor → department → global → hardcoded default.
 *
 * A tier answers when it has a row with a NON-NULL fee. Testing `!= null` rather than
 * truthiness is the fix for a doctor configured at ₹0 falling through to the next tier.
 */
export async function resolveConsultationRate(opts: {
  hospitalId: string;
  doctorId?: string | null;
  departmentId?: string | null;
}): Promise<ConsultationRate> {
  const { hospitalId, doctorId, departmentId } = opts;
  if (!hospitalId) return FALLBACK_RATE;

  const base = () =>
    (supabase as any)
      .from("service_master")
      .select(SELECT_RATE)
      .eq("hospital_id", hospitalId)
      .eq("item_type", "consultation")
      .eq("is_active", true);

  if (doctorId) {
    const { data } = await base().eq("doctor_id", doctorId).limit(1);
    if (data?.[0]?.fee != null) return toRate(data[0], "doctor");
  }

  if (departmentId) {
    const { data } = await base().eq("department_id", departmentId).is("doctor_id", null).limit(1);
    if (data?.[0]?.fee != null) return toRate(data[0], "dept");
  }

  const { data } = await base().is("doctor_id", null).is("department_id", null).limit(1);
  if (data?.[0]?.fee != null) return toRate(data[0], "global");

  return FALLBACK_RATE;
}

/**
 * Find the patient's current fee episode with this doctor.
 *
 * Reads opd_tokens (where money is actually collected) rather than appointments — a booked
 * appointment that never arrived was never charged and must not burn the allowance or
 * re-anchor the episode. Cancelled and no-show tokens are excluded for the same reason.
 *
 * The lookback is derived from validityDays, replacing the old hardcoded 30-day ceiling
 * that silently disabled any validity window longer than a month.
 */
export async function findFeeEpisode(opts: {
  hospitalId: string;
  patientId: string;
  doctorId: string;
  validityDays: number;
  /** Defaults to today. Pass the appointment date to price a future booking. */
  asOfDate?: string;
  followUpMaxVisits?: number | null;
  /** Exclude a token being re-priced (e.g. today's own row). */
  excludeTokenId?: string | null;
}): Promise<FeeEpisode> {
  const {
    hospitalId, patientId, doctorId, validityDays,
    asOfDate = toDateKey(), followUpMaxVisits = null, excludeTokenId = null,
  } = opts;

  if (!hospitalId || !patientId || !doctorId) return NO_EPISODE;

  // Pull a little more history than the window so the anchor is still visible when the
  // patient is at the very edge of validity.
  const lookbackDays = Math.max(validityDays, 1) * 2 + 7;
  const from = new Date(Date.parse(`${asOfDate}T12:00:00Z`) - lookbackDays * 86400000);

  let query = (supabase as any)
    .from("opd_tokens")
    .select("id, visit_date, charged_tier, doctor:users!opd_tokens_doctor_id_fkey(full_name)")
    .eq("hospital_id", hospitalId)
    .eq("patient_id", patientId)
    .eq("doctor_id", doctorId)
    .gte("visit_date", toDateKey(from))
    .lt("visit_date", asOfDate)
    .not("status", "in", "(cancelled,no_show)")
    .order("visit_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (excludeTokenId) query = query.neq("id", excludeTokenId);

  const { data } = await query;
  const rows = (data || []) as {
    id: string;
    visit_date: string;
    charged_tier: string | null;
    doctor?: { full_name?: string | null } | null;
  }[];
  if (rows.length === 0) return NO_EPISODE;

  // Newest first: count follow-ups until the first non-follow-up visit, which IS the anchor.
  // An emergency visit is priced on its own and neither anchors an episode nor spends the
  // allowance, so it is skipped entirely.
  let followUpsUsed = 0;
  let anchorDate: string | null = null;
  let anchorTokenId: string | null = null;
  let anchorDoctorName: string | null = null;
  for (const row of rows) {
    if (row.charged_tier === "emergency") continue;
    if (row.charged_tier === "follow_up") {
      followUpsUsed++;
      continue;
    }
    anchorDate = row.visit_date;
    anchorTokenId = row.id;
    anchorDoctorName = row.doctor?.full_name ?? null;
    break;
  }

  if (!anchorDate) {
    // Only follow-ups on record and no anchor in range — the episode that spawned them has
    // aged out of the lookback, so treat this as a fresh consultation.
    return NO_EPISODE;
  }

  const daysSinceAnchor = daysBetween(anchorDate, asOfDate);
  return {
    anchorDate,
    anchorTokenId,
    anchorDoctorName,
    followUpsUsed,
    withinValidity: daysSinceAnchor >= 0 && daysSinceAnchor <= validityDays,
    capReached: followUpMaxVisits != null && followUpsUsed >= followUpMaxVisits,
    daysSinceAnchor,
  };
}

/**
 * Decide the final fee. Pure — no I/O, no clock.
 *
 * `visitType`/`visitPurpose` are the desk's manual selection. They can force a follow-up
 * when there is no history to evaluate, but they cannot override an expired window or a
 * spent allowance: a prior visit outside validity is a fresh consultation regardless of
 * what the dropdown says. That is the whole point of the doctor's setting.
 */
export function computeConsultationFee(opts: {
  rate: ConsultationRate;
  episode: FeeEpisode;
  visitType: "new" | "revisit" | "followup" | "emergency";
  visitPurpose?: "new" | "revisit" | "follow_up" | "review" | "procedure";
  revisitRules?: { enabled?: boolean; rules?: RevisitRule[] } | null;
}): ComputedFee {
  const { rate, episode, visitType, visitPurpose = "new", revisitRules = null } = opts;

  if (visitType === "emergency") {
    return {
      fee: rate.emergencyFee > 0 ? rate.emergencyFee : rate.fee,
      tier: "emergency",
      reason: rate.emergencyFee > 0 ? "Emergency rate" : "Emergency visit — no emergency rate configured, charging full fee",
      revisitDiscount: 0,
      revisitDiscountNote: "",
    };
  }

  const manualFollowUp =
    visitType === "followup" || visitPurpose === "follow_up" || visitPurpose === "review";

  if (rate.followUpFee !== null) {
    if (episode.anchorDate && episode.withinValidity && !episode.capReached) {
      const used = episode.followUpsUsed + 1;
      const of = rate.followUpMaxVisits == null ? "unlimited" : String(rate.followUpMaxVisits);
      return {
        fee: rate.followUpFee,
        tier: "follow_up",
        reason: `Follow-up rate — visit ${used} of ${of}, ${episode.daysSinceAnchor} of ${rate.followUpValidityDays} days since ${episode.anchorDate}`,
        revisitDiscount: 0,
        revisitDiscountNote: "",
      };
    }

    // No history to evaluate — trust the desk's manual selection.
    if (!episode.anchorDate && manualFollowUp) {
      return {
        fee: rate.followUpFee,
        tier: "follow_up",
        reason: "Follow-up rate — marked manually (no previous visit on record)",
        revisitDiscount: 0,
        revisitDiscountNote: "",
      };
    }
  }

  // Full fee from here. Say WHY, so a desk expecting the cheaper rate is not left guessing.
  let reason = "Full consultation fee";
  if (rate.followUpFee === null && manualFollowUp) {
    reason = "Full fee — no follow-up rate configured for this doctor";
  } else if (episode.anchorDate && episode.capReached) {
    const of = rate.followUpMaxVisits ?? 0;
    reason = `Full fee — follow-up allowance used (${episode.followUpsUsed} of ${of}); this visit starts a new validity period`;
  } else if (episode.anchorDate && !episode.withinValidity) {
    reason = `Full fee — last visit was ${episode.daysSinceAnchor} days ago, outside the ${rate.followUpValidityDays}-day validity`;
  }

  // Revisit-discount rules (hospital_settings 'opd_revisit_rules') layer on the base fee.
  // They are a separate, hospital-wide courtesy from the doctor's own follow-up rate, and
  // only apply when the desk has actually marked this a revisit.
  const wantsRevisitDiscount = ["revisit", "follow_up", "review"].includes(visitPurpose);
  if (
    revisitRules?.enabled &&
    Array.isArray(revisitRules.rules) &&
    episode.anchorDate &&
    episode.daysSinceAnchor != null &&
    wantsRevisitDiscount
  ) {
    for (const rule of revisitRules.rules) {
      if (episode.daysSinceAnchor > rule.within_days) continue;
      let discounted = rate.fee;
      let note = "";
      if (rule.discount_type === "free") {
        discounted = 0;
        note = `Revisit discount — free within ${rule.within_days} days`;
      } else if (rule.discount_type === "percent") {
        discounted = Math.round(rate.fee * (1 - rule.amount / 100));
        note = `Revisit discount — ${rule.amount}% off (within ${rule.within_days} days)`;
      } else if (rule.discount_type === "fixed") {
        discounted = Math.max(0, rate.fee - rule.amount);
        note = `Revisit discount — ₹${rule.amount} off (within ${rule.within_days} days)`;
      }
      return {
        fee: discounted,
        tier: "new",
        reason,
        revisitDiscount: rate.fee - discounted,
        revisitDiscountNote: note,
      };
    }
  }

  return { fee: rate.fee, tier: "new", reason, revisitDiscount: 0, revisitDiscountNote: "" };
}

/** Load the hospital's opd_revisit_rules blob, or null when unset. */
export async function fetchRevisitRules(
  hospitalId: string
): Promise<{ enabled?: boolean; rules?: RevisitRule[] } | null> {
  if (!hospitalId) return null;
  const { data } = await (supabase as any)
    .from("hospital_settings")
    .select("value")
    .eq("hospital_id", hospitalId)
    .eq("key", "opd_revisit_rules")
    .maybeSingle();
  return data?.value ?? null;
}

/**
 * One-shot convenience: resolve rate → find episode → compute fee.
 * Used by ConsultationWorkspace, where there is no interactive form to drive the steps.
 */
export async function priceConsultation(opts: {
  hospitalId: string;
  patientId: string;
  doctorId?: string | null;
  departmentId?: string | null;
  visitType?: "new" | "revisit" | "followup" | "emergency";
  visitPurpose?: "new" | "revisit" | "follow_up" | "review" | "procedure";
  asOfDate?: string;
  excludeTokenId?: string | null;
}): Promise<ComputedFee & { rate: ConsultationRate; episode: FeeEpisode }> {
  const rate = await resolveConsultationRate({
    hospitalId: opts.hospitalId,
    doctorId: opts.doctorId,
    departmentId: opts.departmentId,
  });

  const episode =
    opts.patientId && opts.doctorId
      ? await findFeeEpisode({
          hospitalId: opts.hospitalId,
          patientId: opts.patientId,
          doctorId: opts.doctorId,
          validityDays: rate.followUpValidityDays,
          followUpMaxVisits: rate.followUpMaxVisits,
          asOfDate: opts.asOfDate,
          excludeTokenId: opts.excludeTokenId,
        })
      : NO_EPISODE;

  const revisitRules = await fetchRevisitRules(opts.hospitalId);
  const computed = computeConsultationFee({
    rate,
    episode,
    visitType: opts.visitType ?? "new",
    visitPurpose: opts.visitPurpose,
    revisitRules,
  });

  return { ...computed, rate, episode };
}

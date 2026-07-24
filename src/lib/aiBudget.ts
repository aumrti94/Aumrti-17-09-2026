/**
 * AI budget status — pure, no I/O.
 *
 * The SQL mirror of this lives in the `hospital_ai_budget_status` view
 * (migration ...167). CHANGE BOTH TOGETHER, or the platform's over-budget
 * worklist and the hospital's own usage bar will disagree about who is over.
 *
 * Two invariants this file exists to protect:
 *
 *   1. SAFETY AI IS NEVER COUNTED. Drug-interaction, allergy, deterioration and
 *      critical-finding detection are excluded from the cap on every plan. A
 *      budget that could throttle those would be a patient-safety mechanism
 *      wearing a billing costume.
 *
 *   2. A NULL budget is "not metered", never "zero allowed". Every plan
 *      predating this feature has NULL, and they must never read as over.
 *
 * The cap is SOFT throughout: `state` drives a prompt, never a block. Nothing
 * downstream of this function may gate an AI call on its result.
 */

export type AiBudgetState = "ok" | "approaching" | "over";

export interface AiBudgetStatus {
  /** False when the plan has no budget set — display usage, never a cap. */
  budgeted: boolean;
  /** Spend counted against the cap (excludes safety class). */
  usedInr: number;
  /** Safety-class spend, shown for transparency, never counted. */
  safetyInr: number;
  budgetInr: number | null;
  /** Null when not budgeted. */
  pctUsed: number | null;
  state: AiBudgetState;
  /** Spend above the budget; 0 when within it or not budgeted. */
  overageInr: number;
}

/** Fraction of the budget at which we start nudging rather than staying quiet. */
export const APPROACHING_THRESHOLD = 0.8;

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === "string" ? parseFloat(v) : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const round4 = (n: number): number => Math.round((n + Number.EPSILON) * 10000) / 10000;

export function resolveAiBudgetStatus(params: {
  /** Month-to-date spend on non-safety features. */
  meteredCostInr: number | string | null | undefined;
  /** The plan's included budget. NULL = not metered. */
  budgetInr: number | string | null | undefined;
  /** Month-to-date spend on safety features, reported but never counted. */
  safetyCostInr?: number | string | null;
}): AiBudgetStatus {
  const usedInr = round4(num(params.meteredCostInr));
  const safetyInr = round4(num(params.safetyCostInr));

  const rawBudget = params.budgetInr;
  const budgetInr = rawBudget == null ? null : num(rawBudget);

  // Not metered: a plan with no budget (or a nonsensical <= 0 one) shows usage
  // and nothing else. Treating 0 as "nothing allowed" would put every legacy
  // hospital permanently over budget the moment this shipped.
  if (budgetInr == null || budgetInr <= 0) {
    return {
      budgeted: false,
      usedInr,
      safetyInr,
      budgetInr: null,
      pctUsed: null,
      state: "ok",
      overageInr: 0,
    };
  }

  const pctUsed = round4((usedInr / budgetInr) * 100);
  const overageInr = round4(Math.max(usedInr - budgetInr, 0));

  // State is derived from the ROUNDED percentage, not from a raw float
  // comparison. Comparing `usedInr >= budgetInr * 0.8` directly misses the
  // boundary: 24 * 0.8 is 19.200000000000003, so a hospital sitting exactly on
  // 80% read as "ok" and never got nudged. Deriving both the displayed number
  // and the state from one rounded value also guarantees the bar and the
  // message can never disagree.
  //
  // Strictly greater than 100%: landing exactly on the budget is within it.
  const state: AiBudgetState =
    pctUsed > 100 ? "over"
    : pctUsed >= APPROACHING_THRESHOLD * 100 ? "approaching"
    : "ok";

  return { budgeted: true, usedInr, safetyInr, budgetInr, pctUsed, state, overageInr };
}

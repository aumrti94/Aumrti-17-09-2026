/**
 * Encounter / document allowance — pure, no I/O.
 *
 * The SQL mirror is the `hospital_encounter_usage` view (migration ...168).
 * CHANGE BOTH TOGETHER, or a hospital's own usage line and the platform's
 * worklist will disagree about who has run out.
 *
 * Two layers, consumed in this order:
 *
 *   1. the plan's MONTHLY ALLOWANCE, which resets each cycle
 *   2. PREPAID CREDITS, which do not expire while the subscription is active
 *
 * The ordering is the design. Indian OPD volume swings with fever season,
 * camps and festivals; a pure monthly reset would bill a hospital for variance
 * it does not control — overage in a heavy month while allowance is wasted in a
 * quiet one. Credits absorb the spikes and quiet months never burn them.
 *
 * THIS FUNCTION NEVER RETURNS A BLOCKED STATE. `belowBuffer` escalates how
 * loudly the UI asks for a top-up; it does not gate anything. A doctor whose
 * dictation dies at patient 40 churns rather than tops up, and that outcome
 * costs far more than the credits would have.
 */

export type AllowanceState =
  | "not_metered"      // plan has no allowance configured
  | "ok"
  | "approaching"      // ≥80% of the monthly allowance used
  | "using_credits"    // allowance spent, drawing on prepaid credits
  | "negative";        // credits spent too — still permitted, prompt to top up

export interface EncounterAllowanceStatus {
  metered: boolean;
  used: number;
  included: number | null;
  /** Remaining monthly allowance, floored at 0. */
  allowanceLeft: number;
  /** Prepaid credits left. Can be negative — see the note above. */
  creditsLeft: number;
  /** True once the monthly allowance is exhausted and credits are in play. */
  drawingCredits: boolean;
  /** True once the balance has passed the tolerated negative buffer. */
  belowBuffer: boolean;
  /** Percent of the monthly allowance consumed. Null when not metered. */
  pctUsed: number | null;
  state: AllowanceState;
}

/** Fraction of the monthly allowance at which the UI starts mentioning it. */
export const APPROACHING_THRESHOLD = 0.8;

/** How far the credit balance may go negative before the prompt escalates. */
export const DEFAULT_NEGATIVE_BUFFER = 50;

const int = (v: number | string | null | undefined): number => {
  const n = typeof v === "string" ? parseFloat(v) : Number(v ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

const round4 = (n: number): number => Math.round((n + Number.EPSILON) * 10000) / 10000;

export function resolveEncounterAllowance(params: {
  /** Units consumed this billing month (e.g. voice_scribe call count). */
  used: number | string | null | undefined;
  /** The plan's monthly allowance. NULL = not metered. */
  included: number | string | null | undefined;
  /** Prepaid credit balance; may already be negative. */
  creditBalance?: number | string | null;
  negativeBuffer?: number;
}): EncounterAllowanceStatus {
  const used = Math.max(0, int(params.used));
  const creditBalance = int(params.creditBalance);
  const negativeBuffer = params.negativeBuffer ?? DEFAULT_NEGATIVE_BUFFER;

  const rawIncluded = params.included;
  const included = rawIncluded == null ? null : int(rawIncluded);

  // Not metered: a plan with no allowance shows usage and nothing else.
  // Treating 0 as "nothing included" would put every legacy hospital instantly
  // into a top-up prompt the moment this shipped.
  if (included == null || included <= 0) {
    return {
      metered: false,
      used,
      included: null,
      allowanceLeft: 0,
      creditsLeft: creditBalance,
      drawingCredits: false,
      belowBuffer: false,
      pctUsed: null,
      state: "not_metered",
    };
  }

  const allowanceLeft = Math.max(0, included - used);
  const overAllowance = Math.max(0, used - included);

  // Credits are only touched once the allowance is gone — the seasonality rule.
  const creditsLeft = creditBalance - overAllowance;
  const drawingCredits = overAllowance > 0;
  const belowBuffer = creditsLeft < -negativeBuffer;

  // Derived from the ROUNDED percentage rather than a raw float comparison:
  // `used >= included * 0.8` misses the boundary because e.g. 400 * 0.8 can
  // land fractionally above the integer it should equal. Same bug class that
  // was found in the AI budget resolver.
  const pctUsed = round4((used / included) * 100);

  let state: AllowanceState;
  if (belowBuffer) state = "negative";
  else if (drawingCredits) state = creditsLeft < 0 ? "negative" : "using_credits";
  else if (pctUsed >= APPROACHING_THRESHOLD * 100) state = "approaching";
  else state = "ok";

  return {
    metered: true,
    used,
    included,
    allowanceLeft,
    creditsLeft,
    drawingCredits,
    belowBuffer,
    pctUsed,
    state,
  };
}

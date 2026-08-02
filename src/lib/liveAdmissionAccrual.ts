/**
 * Live accrual for patients who are still admitted.
 *
 * THE PROBLEM THIS SOLVES. An inpatient's bill grows every day they stay — room and nursing
 * are per-day charges — but the bill row only changes when the discharge sweep actually runs
 * (opening the bill editor, or Recalculate IPD). So the billing queue showed a number that
 * was correct on the day someone last opened the bill and quietly understated the debt every
 * day after. Worse, the bill was filtered by `bill_date`, so a patient admitted on the 19th
 * disappeared from "Today" entirely on the 20th — while an admitted patient with no bill yet
 * stayed visible in every period. The same patient, opposite behaviour, purely because a
 * draft bill existed.
 *
 * WHAT THIS DOES NOT DO. It does not write anything. The figures here are a display-level
 * projection of charges the sweep has not posted yet; the bill's stored total remains the
 * only thing that is ever billed, and the queue labels the projected figure as accruing so
 * nobody reads it as a final amount. Keeping it read-only is the point: recomputing real
 * charges for every admitted patient on every page load would mean roughly a hundred
 * database round trips per patient.
 */

import type { BillingDateRange } from "@/lib/billingDateRange";
import { toLocalISODate } from "@/lib/billingDateRange";

const MS_PER_DAY = 86_400_000;

/**
 * Does this reporting window include today?
 *
 * A still-accruing bill belongs to any period that contains the present moment, and to no
 * period that does not: "Yesterday", or a custom range that closed last week, are historical
 * views and must not show a bill that is still growing, or the totals they report would
 * change every day after the fact.
 */
export function rangeContainsToday(range: BillingDateRange, now: Date = new Date()): boolean {
  const today = toLocalISODate(now);
  return range.start <= today && today <= range.end;
}

/**
 * Days of stay accrued so far.
 *
 * Deliberately the same arithmetic as the room-charge block in lib/ipdBilling.ts
 * (`max(1, ceil(elapsed / 1 day))`) — if the projection counted days differently from the
 * sweep, the queue's figure and the figure the sweep eventually writes would never agree.
 */
export function accruedStayDays(admittedAt: string | null | undefined, now: Date = new Date()): number {
  if (!admittedAt) return 0;
  const admitted = new Date(admittedAt).getTime();
  if (!Number.isFinite(admitted)) return 0;
  return Math.max(1, Math.ceil((now.getTime() - admitted) / MS_PER_DAY));
}

export interface AccrualInput {
  admittedAt: string | null | undefined;
  /** Day-count already charged on the bill's room line. 0 when nothing has been posted. */
  billedDays: number;
  /** Per-day room rate, ideally the rate the existing room line was billed at. */
  roomRate: number;
  /** Per-day nursing rate for the ward. 0 when nursing is bundled into the room rate. */
  nursingRate: number;
  now?: Date;
}

export interface Accrual {
  /** Days of stay so far. */
  accruedDays: number;
  /** Days of stay the bill has not been charged for yet. */
  unbilledDays: number;
  /** Money accrued but not yet posted to the bill. */
  unbilledAmount: number;
}

export function computeAccrual(input: AccrualInput): Accrual {
  const { admittedAt, billedDays, roomRate, nursingRate, now = new Date() } = input;

  const accruedDays = accruedStayDays(admittedAt, now);
  // Never negative: a bill charged further ahead than the stay has run (a corrected
  // discharge date, a manually edited quantity) is not an invitation to subtract money.
  const unbilledDays = Math.max(0, accruedDays - Math.max(0, billedDays));

  const perDay = Math.max(0, roomRate) + Math.max(0, nursingRate);
  return {
    accruedDays,
    unbilledDays,
    unbilledAmount: unbilledDays * perDay,
  };
}

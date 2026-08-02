/**
 * dayCareLateDischarge — the day care same-day rule, client side.
 *
 * The DB trigger enforce_daycare_same_day() rejects a discharge that lands on a later IST
 * calendar day than the admission unless the row carries a written reason and an owner
 * (20261009000183). Before that migration the rejection was absolute, so a day care patient
 * whose discharge was not clicked before midnight could never be discharged at all.
 *
 * These helpers let the UI ask the same question the trigger asks — BEFORE the round trip —
 * so the user is offered the two legitimate ways out (record the real discharge time, or
 * justify the late one) instead of a red toast with no next step.
 *
 * Everything here works in Asia/Kolkata, because that is the calendar day the rule is written
 * against. The browser's own zone is never used: a laptop left on GMT would otherwise disagree
 * with the trigger about which day it is.
 */

import { format } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

const IST = "Asia/Kolkata";

/** The IST calendar day ("YYYY-MM-DD") an instant falls on — the unit the trigger compares. */
export function istDateKey(value: string | Date): string {
  return format(toZonedTime(new Date(value), IST), "yyyy-MM-dd");
}

/** An instant as a `<input type="datetime-local">` value in IST ("YYYY-MM-DDTHH:mm"). */
export function toISTLocalInput(value: string | Date): string {
  return format(toZonedTime(new Date(value), IST), "yyyy-MM-dd'T'HH:mm");
}

/**
 * A `datetime-local` value read back as an instant, interpreting it as IST.
 *
 * `new Date("2026-07-24T20:30")` would interpret it in the BROWSER's zone; on a machine set
 * to anything but IST that silently shifts the clinical time. Returns null for an empty or
 * unparseable value so callers can block rather than send an Invalid Date.
 */
export function fromISTLocalInput(local: string): string | null {
  if (!local || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(local)) return null;
  const d = fromZonedTime(local, IST);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface DayCareDischargeTimeCheck {
  /** Discharge falls on a later IST day than admission — needs the audited override. */
  crossesDay: boolean;
  /** IST day of admission / of the proposed discharge, for the explanatory copy. */
  admittedDate: string | null;
  dischargeDate: string | null;
  /** Hard validation failure — the discharge cannot be recorded at this time at all. */
  error: string | null;
}

/**
 * PURE. Mirrors enforce_daycare_same_day() so the modal can decide what to ask for.
 *
 * A future discharge time is rejected here and NOT at the DB (the trigger has no opinion on
 * it): back-dating to the real discharge time is the point of the picker, forward-dating is
 * always a typo, and a stay that ends tomorrow is not a day care stay.
 */
export function checkDayCareDischargeTime(
  admittedAt: string | null | undefined,
  dischargeAt: string | null | undefined,
  now: string | Date = new Date()
): DayCareDischargeTimeCheck {
  const base = { crossesDay: false, admittedDate: null, dischargeDate: null };

  if (!admittedAt) {
    return { ...base, error: "This patient has not been admitted yet, so there is nothing to discharge." };
  }
  if (!dischargeAt) {
    return { ...base, error: "Enter a valid discharge date and time." };
  }

  const admittedMs = new Date(admittedAt).getTime();
  const dischargeMs = new Date(dischargeAt).getTime();
  if (!Number.isFinite(admittedMs) || !Number.isFinite(dischargeMs)) {
    return { ...base, error: "Enter a valid discharge date and time." };
  }

  const admittedDate = istDateKey(admittedAt);
  const dischargeDate = istDateKey(dischargeAt);

  if (dischargeMs < admittedMs) {
    return {
      crossesDay: false,
      admittedDate,
      dischargeDate,
      error: "Discharge time cannot be before the admission time.",
    };
  }

  // One minute of slack absorbs the gap between the value the field was seeded with and the
  // click that submits it, which would otherwise read as "in the future".
  const nowMs = new Date(now).getTime();
  if (Number.isFinite(nowMs) && dischargeMs > nowMs + 60_000) {
    return {
      crossesDay: false,
      admittedDate,
      dischargeDate,
      error: "Discharge time cannot be in the future.",
    };
  }

  return {
    crossesDay: dischargeDate !== admittedDate,
    admittedDate,
    dischargeDate,
    error: null,
  };
}

/** Reasons a day care stay legitimately crosses midnight. Free text stays available. */
export const LATE_DISCHARGE_REASONS = [
  "Extended recovery / observation after procedure",
  "Post-procedure complication managed overnight",
  "Procedure started late in the evening",
  "Discharge was completed but not recorded in the system",
  "Patient / attendant delayed leaving the hospital",
  "Waiting on transport or attendant arrival",
] as const;

/** Minimum a free-text justification must say before it is an audit record at all. */
export const MIN_LATE_REASON_LENGTH = 5;

/** PURE. Is this justification substantive enough to accept? */
export function isLateReasonAcceptable(reason: string): boolean {
  return reason.trim().length >= MIN_LATE_REASON_LENGTH;
}

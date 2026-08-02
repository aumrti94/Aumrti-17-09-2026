/**
 * dayCareBoard — pure helpers backing the Day Care board's three tabs.
 *
 * Extracted so the date-column rule is unit-testable: a booked patient has admitted_at
 * NULL and scheduled_at set (20261008000138), so the Scheduled tab MUST filter and sort on
 * scheduled_at. Filtering it on admitted_at — as the board did when every day care row was
 * force-created 'active' — returns nothing at all.
 */

export type DayCareTab = "scheduled" | "active" | "discharged" | "cancelled";

/**
 * PURE. Which timestamp column the board's date picker filters/sorts for a given tab.
 *
 * Scheduled/Cancelled → scheduled_at. Neither ever got an admitted_at: a booking has it NULL
 *   until the patient reports, and a cancelled booking never reported at all. Filtering
 *   these on admitted_at returns an empty board.
 * Active/Discharged → admitted_at (the real arrival time).
 */
export function dayCareDateColumn(tab: DayCareTab): "scheduled_at" | "admitted_at" {
  return tab === "scheduled" || tab === "cancelled" ? "scheduled_at" : "admitted_at";
}

/**
 * PURE. The admissions.status values backing each tab.
 *
 * Returns an array because the Cancelled tab holds two distinct outcomes — a booking that
 * was called off and a patient who never turned up. They are separate events (different fee
 * policy, and no-show rate is its own KPI) but both belong on the same "did not happen" list.
 */
export function dayCareStatusFilter(tab: DayCareTab): string[] {
  return tab === "cancelled" ? ["cancelled", "no_show"] : [tab];
}

/**
 * PURE. Scheduled lists soonest-first (a worklist — what's coming up next);
 * the rest list newest-first (a log — what happened most recently).
 */
export function dayCareSortAscending(tab: DayCareTab): boolean {
  return tab === "scheduled";
}

/**
 * PURE. The IST date window the board queries for a tab, given the picked date.
 *
 * Every tab but Active is a LOG of things that happened on a date, so both ends are pinned.
 *
 * Active is not a log — it is who is in the unit right now. Pinning its lower bound to the
 * picked date hid the case this whole flow exists for: a patient admitted yesterday and never
 * discharged is still active today, but showed up only if staff happened to page back to
 * yesterday. They vanished from Today and the stay stayed open indefinitely. So Active is
 * open-ended below: everyone still admitted, up to the end of the picked day.
 *
 * `from: null` means "no lower bound" — the caller omits the .gte().
 */
export function dayCareDateRange(
  tab: DayCareTab,
  isoDate: string
): { from: string | null; to: string } {
  return {
    from: tab === "active" ? null : `${isoDate}T00:00:00+05:30`,
    to: `${isoDate}T23:59:59+05:30`,
  };
}

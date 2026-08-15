/**
 * Shift timing maths.
 *
 * Lives outside SettingsShiftsPage so it can be unit-tested directly — the cross-midnight
 * case is the one that silently corrupts payroll, and it deserves a test that does not need
 * a browser.
 */

/**
 * Hours between two `HH:MM` times, wrapping past midnight.
 *
 * A night shift 22:00 → 06:00 is EIGHT hours. Subtracting naively gives −16, which would
 * store a negative `shift_master.duration_hours` and make every night-shift roster hour and
 * payroll calculation downstream wrong.
 *
 * Equal start and end is treated as a full 24h rather than 0, because a zero-length shift is
 * rejected at the form before it ever reaches here — see SettingsShiftsPage's validation.
 */
export function durationHours(start: string, end: string): number {
  const toMinutes = (t: string) => {
    const [h, m] = (t ?? "").split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const diff = toMinutes(end) - toMinutes(start);
  const wrapped = diff <= 0 ? diff + 24 * 60 : diff;
  return Math.round((wrapped / 60) * 100) / 100;
}

/**
 * Shared date-range resolution for the Billing page.
 *
 * Every Billing tab (Bills, Collections, Pending Payments, Revenue Leakage, and the
 * approval inboxes' history view) reads from ONE range picked at the page level, so the
 * numbers across tabs always describe the same period. Previously only the Bills tab had
 * a date filter and the rest silently showed "everything", which made the tabs disagree.
 */

export type BillingDatePreset = "today" | "yesterday" | "week" | "month" | "all" | "custom";

export interface BillingDateRange {
  /** Inclusive start, YYYY-MM-DD. */
  start: string;
  /** Inclusive end, YYYY-MM-DD. */
  end: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Local-calendar YYYY-MM-DD.
 *
 * `toISOString().slice(0,10)` is UTC: in IST (UTC+5:30) every moment before 05:30 local
 * resolves to the PREVIOUS day, so "Today" showed yesterday's bills during the early
 * shift. Date filters here are calendar-day filters, so they must use local dates.
 */
export function toLocalISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const BILLING_DATE_PRESETS: { key: BillingDatePreset; label: string }[] = [
  { key: "today",     label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week",      label: "Last 7 days" },
  { key: "month",     label: "Last 30 days" },
  { key: "all",       label: "All time" },
  { key: "custom",    label: "Custom" },
];

/**
 * The window "All time" resolves to.
 *
 * Expressed as a very wide range rather than as "no filter" so every consumer keeps working
 * unchanged — each tab already builds `.gte(start).lte(end)` around the shared range, and a
 * range wide enough to contain every conceivable bill_date is indistinguishable from no
 * filter at all. The end is deliberately in the future so a post-dated bill is still caught.
 *
 * Why the preset exists: every other option is a rolling or single-day window, so an unpaid
 * bill silently drops out of the queue once it ages past 30 days. Money owed does not expire
 * with the window it was billed in, and the person chasing it needs to be able to see all of
 * it at once.
 */
export const ALL_TIME_RANGE: BillingDateRange = { start: "1900-01-01", end: "2999-12-31" };

/** True when the range is the all-time window rather than a real reporting period. */
export function isAllTimeRange(range: BillingDateRange): boolean {
  return range.start === ALL_TIME_RANGE.start && range.end === ALL_TIME_RANGE.end;
}

/**
 * Resolve a preset (+ optional custom bounds) to a concrete inclusive range.
 *
 * For "custom": an empty `end` means "that one day only" — pick a From date and leave
 * To blank to see a single day. An end earlier than the start is swapped rather than
 * returning an empty window, which otherwise reads as "no data" for a simple typo.
 */
export function resolveBillingDateRange(
  preset: BillingDatePreset,
  customStart?: string,
  customEnd?: string,
  now: Date = new Date(),
): BillingDateRange {
  const today = toLocalISODate(now);

  if (preset === "all") return ALL_TIME_RANGE;

  if (preset === "custom") {
    const start = customStart || today;
    const end = customEnd || start; // blank "to" = single day
    return start <= end ? { start, end } : { start: end, end: start };
  }

  const startDate = new Date(now);
  switch (preset) {
    case "yesterday":
      startDate.setDate(startDate.getDate() - 1);
      // Yesterday is a single day — it must not run through to today.
      return { start: toLocalISODate(startDate), end: toLocalISODate(startDate) };
    case "week":
      startDate.setDate(startDate.getDate() - 6); // 7 days inclusive of today
      break;
    case "month":
      startDate.setDate(startDate.getDate() - 29); // 30 days inclusive of today
      break;
    default:
      break; // "today"
  }
  return { start: toLocalISODate(startDate), end: today };
}

/**
 * End-of-day timestamp for filtering `timestamptz` columns (created_at, paid_at, …).
 * A plain `.lte("created_at", end)` compares against midnight and drops everything
 * recorded during the final day.
 */
export function endOfDayISO(dateStr: string): string {
  return `${dateStr}T23:59:59.999`;
}

/** Human label for the active range, e.g. "Today" or "15 Jul – 20 Jul". */
export function describeBillingDateRange(range: BillingDateRange, now: Date = new Date()): string {
  if (isAllTimeRange(range)) return "All time";
  const today = toLocalISODate(now);
  const fmt = (s: string) =>
    new Date(`${s}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  if (range.start === range.end) return range.start === today ? "Today" : fmt(range.start);
  return `${fmt(range.start)} – ${fmt(range.end)}`;
}

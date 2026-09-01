/**
 * Splits an admission's stay into ward/bed segments across mid-stay transfers, so room and
 * nursing charges can be priced per segment instead of at one rate for the whole stay.
 *
 * BUSINESS RULE (confirmed): the day of transfer bills to the OLD ward; the new ward's
 * billing starts the next calendar day. No double-billing — total days across all segments
 * always equals the whole-stay day count, exactly like the pre-existing single-block formula.
 *
 * Pure and DB-free by design: both the real bill (lib/ipdBilling.ts) and the pre-bill
 * estimate ledger (IPDFinancialTab.tsx) batch-fetch the ward/bed rows a segment list touches
 * themselves, then price each segment — this module only computes the day-boundaries.
 */

export const MS_PER_DAY = 86_400_000;

export interface BedTransferRecord {
  from_ward_id: string | null;
  from_bed_id: string | null;
  to_ward_id: string;
  to_bed_id: string;
  transferred_at: string;
}

export interface BedSegment {
  wardId: string;
  bedId: string;
  /** Calendar date (UTC, YYYY-MM-DD), first billed day of this segment. */
  startDate: string;
  /** Calendar date (UTC, YYYY-MM-DD), last billed day of this segment (inclusive). */
  endDate: string;
  /** Bed-days billed to this ward/bed. Always >= 1. */
  days: number;
}

export interface ComputeBedSegmentsInput {
  admittedAt: string;
  dischargedAt: string | null | undefined;
  currentWardId: string;
  currentBedId: string;
  /** Need not be pre-sorted — sorted by transferred_at ascending internally. */
  transfers: BedTransferRecord[];
  now?: Date;
}

/**
 * Total days of stay. Byte-for-byte the formula this whole codebase already prices a stay
 * by (lib/ipdBilling.ts's room-charge block, lib/liveAdmissionAccrual.ts's accruedStayDays)
 * — extracted here so every caller shares one implementation and the zero-transfer case
 * (see computeBedSegments below) is provably identical to the pre-segment behavior.
 */
export function totalStayDays(
  admittedAt: string,
  dischargedAt: string | null | undefined,
  now: Date = new Date()
): number {
  const admitMs = new Date(admittedAt).getTime();
  const endMs = dischargedAt ? new Date(dischargedAt).getTime() : now.getTime();
  return Math.max(1, Math.ceil((endMs - admitMs) / MS_PER_DAY));
}

function calendarDayUTCms(iso: string): number {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function dayIndex(iso: string, admittedAt: string): number {
  return Math.round((calendarDayUTCms(iso) - calendarDayUTCms(admittedAt)) / MS_PER_DAY);
}

function dateAtDayIndex(admittedAt: string, idx: number): string {
  return new Date(calendarDayUTCms(admittedAt) + idx * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Splits a stay into ward/bed segments.
 *
 * Boundaries are built from each transfer's "split index" — dayIndex(transferred_at) + 1 —
 * which is what encodes "old ward keeps the transfer day, new ward starts the next day".
 * Each boundary is clamped to [previous boundary, totalDays], which handles every edge case
 * with no special-casing: a transfer on the admission day collapses that segment to exactly
 * 1 day; a transfer at/after discharge clamps to totalDays and produces a zero-length
 * (dropped) segment; two transfers on the same calendar day produce the same split index, so
 * the earlier one's segment collapses to zero and only the later transfer's ward survives for
 * that boundary; a corrupt/pre-admission timestamp clamps to the running floor and is
 * likewise dropped. The clamp is also what guarantees segment days always sum to totalDays.
 *
 * With zero transfers, this returns exactly one segment spanning the whole stay at
 * currentWardId/currentBedId — identical to the pre-segment single-block behavior.
 */
export function computeBedSegments(input: ComputeBedSegmentsInput): BedSegment[] {
  const { admittedAt, dischargedAt, currentWardId, currentBedId, now } = input;
  const totalDays = totalStayDays(admittedAt, dischargedAt, now);
  const transfers = [...input.transfers].sort(
    (a, b) => new Date(a.transferred_at).getTime() - new Date(b.transferred_at).getTime()
  );
  const n = transfers.length;

  const boundaries: number[] = [0];
  for (const t of transfers) {
    const prev = boundaries[boundaries.length - 1];
    const split = dayIndex(t.transferred_at, admittedAt) + 1;
    boundaries.push(Math.max(prev, Math.min(split, totalDays)));
  }
  boundaries.push(totalDays);

  // Slot k (0 <= k < n) is priced at what transfers[k] moved the patient FROM; the final
  // slot n is the admission's live ward/bed — authoritative for the still-open segment even
  // if it were ever to disagree with the last transfer's `to_*` (e.g. a manual DB correction).
  const slots: { wardId: string; bedId: string }[] = transfers.map((t) => ({
    wardId: t.from_ward_id || currentWardId,
    bedId: t.from_bed_id || currentBedId,
  }));
  slots.push({ wardId: currentWardId, bedId: currentBedId });

  const segments: BedSegment[] = [];
  for (let k = 0; k <= n; k++) {
    const start = boundaries[k];
    const end = boundaries[k + 1];
    const days = end - start;
    if (days <= 0) continue;
    segments.push({
      wardId: slots[k].wardId,
      bedId: slots[k].bedId,
      startDate: dateAtDayIndex(admittedAt, start),
      endDate: dateAtDayIndex(admittedAt, end - 1),
      days,
    });
  }
  return segments;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatOneDate(isoDate: string): string {
  const [, m, d] = isoDate.split("-").map(Number);
  return `${d} ${MONTH_ABBR[m - 1]}`;
}

/** e.g. formatSegmentDateRange("2026-08-26", "2026-08-28") -> "26 Aug – 28 Aug" */
export function formatSegmentDateRange(startDate: string, endDate: string): string {
  return startDate === endDate
    ? formatOneDate(startDate)
    : `${formatOneDate(startDate)} – ${formatOneDate(endDate)}`;
}

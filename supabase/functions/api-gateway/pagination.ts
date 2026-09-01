/**
 * Keyset ("cursor") pagination.
 *
 * Offset pagination silently skips rows when the underlying set changes mid-walk. In a live OPD
 * it is changing constantly, so an offset-paged nightly sync loses patients — invisibly, with no
 * error to investigate. Keyset pagination cannot do that: the cursor names an actual position in
 * a total order rather than a count of rows to discard.
 *
 * The sort column alone is not a total order (two patients register in the same millisecond), so
 * the primary key is always the tiebreaker and is part of the cursor.
 *
 * See docs/api/API_DESIGN_STANDARD.md §5.
 */

import { ApiError } from "./errors.ts";

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export interface Cursor {
  sortValue: string;
  id: string;
}

export function encodeCursor(sortValue: string, id: string): string {
  return btoa(`${sortValue}|${id}`).replace(/=+$/, "");
}

export function decodeCursor(raw: string): Cursor {
  try {
    // Re-pad: the padding is stripped on encode to keep cursors URL-clean.
    const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
    const decoded = atob(padded);
    const sep = decoded.lastIndexOf("|");
    if (sep < 0) throw new Error("no separator");
    const sortValue = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    if (!sortValue || !id) throw new Error("empty component");
    return { sortValue, id };
  } catch {
    throw new ApiError({
      type: "invalid_request_error",
      code: "invalid_cursor",
      message: "The starting_after cursor is not valid. Use the next_cursor from a previous response verbatim.",
      param: "starting_after",
    });
  }
}

export function parseLimit(raw: string | null): number {
  if (raw === null) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new ApiError({
      type: "invalid_request_error",
      code: "invalid_limit",
      message: `limit must be a positive integer up to ${MAX_LIMIT}.`,
      param: "limit",
    });
  }
  // Clamped rather than rejected: asking for more than the cap is a reasonable thing for a
  // client to try, and silently serving the cap is friendlier than a 400 they must special-case.
  return Math.min(n, MAX_LIMIT);
}

/**
 * The PostgREST filter expressing "strictly after this cursor" in the total order
 * (sortColumn ASC, id ASC).
 *
 * Reads as: sort value is greater, OR the sort value ties and the id is greater.
 */
export function keysetFilter(sortColumn: string, cursor: Cursor): string {
  return `${sortColumn}.gt.${cursor.sortValue},and(${sortColumn}.eq.${cursor.sortValue},id.gt.${cursor.id})`;
}

export interface Page<T> {
  data: T[];
  has_more: boolean;
  next_cursor: string | null;
}

/**
 * Build the response envelope from one over-fetched page.
 *
 * The caller queries `limit + 1` rows: the presence of the extra row is what proves there is a
 * next page. Counting the whole set instead would put a COUNT over a large tenant table on every
 * single list request.
 */
export function buildPage<T extends Record<string, any>>(
  rows: T[],
  limit: number,
  sortColumn: string,
): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];

  return {
    data,
    has_more: hasMore,
    next_cursor: hasMore && last ? encodeCursor(String(last[sortColumn]), String(last.id)) : null,
  };
}

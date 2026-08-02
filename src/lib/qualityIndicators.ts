/**
 * NABH quality-indicator presentation helpers.
 *
 * Pure functions only — no Supabase, no I/O. The indicator VALUES are computed
 * server-side by public.run_quality_indicator_collection(); this module only
 * formats and scores what has already been persisted.
 *
 * `attainment` and `bandStatus` are deliberate mirrors of the SQL functions
 * public.qi_attainment() and public.qi_band_status() (migration
 * 20261011000040_nabh_criteria_bootstrap.sql). If you change one, change both,
 * or the dashboard and the criterion scores will disagree.
 */

export type IndicatorDirection = "higher_is_better" | "lower_is_better" | "neutral";

export type ComplianceBand =
  | "compliant"
  | "partially_compliant"
  | "non_compliant"
  | "not_assessed";

export interface QualityIndicatorRow {
  indicator_code: string;
  indicator_name: string;
  category: string;
  nabh_chapter: string | null;
  numerator: number | null;
  denominator: number | null;
  value: number | null;
  unit: string;
  direction: IndicatorDirection;
  target: number | null;
  benchmark: number | null;
  period: string;
  period_start: string;
  auto_calculated: boolean;
  computed_at: string | null;
  notes: string | null;
}

/**
 * How close a value sits to its target, as 0–100.
 *
 * Returns null when the question is unanswerable rather than guessing: no value,
 * no target, or a 'neutral' indicator (a volume metric has no good direction, so
 * it must never contribute to a compliance score).
 */
export function attainment(
  value: number | null | undefined,
  target: number | null | undefined,
  direction: IndicatorDirection,
): number | null {
  if (value == null || target == null) return null;
  if (direction === "neutral") return null;

  if (direction === "higher_is_better") {
    if (target === 0) return null;
    return clamp(round2((100 * value) / target));
  }

  // lower_is_better: at or under target is full marks. A zero value is perfect
  // even when the target is zero (e.g. sentinel events), which is why this
  // check precedes the division.
  if (value <= target) return 100;
  if (value === 0) return 100;
  return Math.max(0, round2((100 * target) / value));
}

/** Same 80/50 bands the NABH dashboard has always used. */
export function bandStatus(pct: number | null | undefined): ComplianceBand {
  if (pct == null || Number.isNaN(pct)) return "not_assessed";
  if (pct >= 80) return "compliant";
  if (pct >= 50) return "partially_compliant";
  return "non_compliant";
}

/**
 * Whether an indicator is currently meeting its target.
 * null means "cannot say" — render it as neutral, not as a failure.
 */
export function isOnTarget(
  value: number | null | undefined,
  target: number | null | undefined,
  direction: IndicatorDirection,
): boolean | null {
  if (value == null || target == null || direction === "neutral") return null;
  return direction === "higher_is_better" ? value >= target : value <= target;
}

/**
 * Format a persisted value for display.
 *
 * A null value is an em-dash, never "NaN" or "0". The previous tab rendered
 * Number(null).toFixed(), which printed NaN whenever a value was missing.
 */
export function formatIndicatorValue(
  value: number | null | undefined,
  unit: string,
): string {
  if (value == null || Number.isNaN(value)) return "—";

  switch (unit) {
    case "%":
      return `${round1(value)}`;
    case "min":
    case "count":
      return `${Math.round(value)}`;
    case "score":
      // NPS is legitimately negative; keep the sign.
      return `${Math.round(value)}`;
    case "/1000":
    case "/100":
    case "ratio":
      return `${round2(value)}`;
    default:
      // hrs, days, kg
      return `${round1(value)}`;
  }
}

/** "12 / 4,318 patient-days" — the arithmetic behind the number. */
export function formatFraction(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
  denominatorLabel?: string | null,
): string | null {
  if (numerator == null || denominator == null || denominator === 0) return null;
  const num = formatCount(numerator);
  const den = formatCount(denominator);
  return denominatorLabel ? `${num} / ${den} ${denominatorLabel}` : `${num} / ${den}`;
}

export interface IndicatorDelta {
  absolute: number;
  /** Direction-aware: true when the movement is an improvement. */
  improved: boolean | null;
}

/**
 * Change between the two most recent periods of a series.
 *
 * `series` is expected oldest-first. Returns null when there is nothing to
 * compare against, so callers do not render an arrow for a single data point.
 */
export function deltaVsPrevious(
  series: Array<{ period_start: string; value: number | null }>,
  direction: IndicatorDirection,
): IndicatorDelta | null {
  const points = series
    .filter((p) => p.value != null)
    .slice()
    .sort((a, b) => a.period_start.localeCompare(b.period_start));

  if (points.length < 2) return null;

  const current = points[points.length - 1].value as number;
  const previous = points[points.length - 2].value as number;
  const absolute = round2(current - previous);

  if (absolute === 0 || direction === "neutral") {
    return { absolute, improved: null };
  }
  return {
    absolute,
    improved: direction === "higher_is_better" ? absolute > 0 : absolute < 0,
  };
}

/** Target chip glyph: "≥ 80%" vs "≤ 2%". */
export function targetPrefix(direction: IndicatorDirection): string {
  if (direction === "higher_is_better") return "≥";
  if (direction === "lower_is_better") return "≤";
  return "";
}

// ─── internals ──────────────────────────────────────────────────────────────
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number) => Math.min(100, Math.max(0, n));
const formatCount = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString("en-IN") : round1(n).toLocaleString("en-IN");

// ─────────────────────────────────────────────────────────────────────────────
// Reference-range resolution — the one place that decides which interval a result
// is judged against.
//
// lab_test_master has carried male_normal_min/max and female_normal_min/max since
// 20260910000001, and SettingsLabTestsPage renders the fields for Hb/RBC/PCV — but
// nothing ever READ them. Both flag sites used normal_min/normal_max only, so a
// hospital that carefully entered male and female haemoglobin ranges got exactly
// the same flags as one that left them blank.
//
// That matters clinically: with a merged 12.0-17.5 g/dL band a male at 12.5 g/dL
// is anaemic and reads Normal. Sex-specific intervals are not cosmetic precision,
// they are the difference between catching and missing an anaemia.
//
// NABL / ISO 15189 also requires the reference interval to be PRINTED on the
// report, so investigationPrint asks this same function — a report showing the
// female range next to a male patient's result is a report-content finding.
// ─────────────────────────────────────────────────────────────────────────────

/** The subset of lab_test_master this module needs. */
export interface ReferenceRangeSource {
  normal_min?: number | null;
  normal_max?: number | null;
  male_normal_min?: number | null;
  male_normal_max?: number | null;
  female_normal_min?: number | null;
  female_normal_max?: number | null;
}

export interface ResolvedRange {
  min: number | null;
  max: number | null;
  /**
   * Which interval was actually used. 'male'/'female' means a sex-specific range
   * applied; 'default' means the sex-unknown fallback. Surfaced so the printed
   * report can say "(male reference range)" rather than leaving it ambiguous.
   */
  source: "male" | "female" | "default";
}

function num(v: number | null | undefined): number | null {
  return v == null || Number.isNaN(Number(v)) ? null : Number(v);
}

function normaliseGender(gender: string | null | undefined): "male" | "female" | null {
  const g = (gender || "").trim().toLowerCase();
  if (g === "male" || g === "m") return "male";
  if (g === "female" || g === "f") return "female";
  // 'other', 'transgender', 'unknown', '' — no sex-specific interval is defensible,
  // so fall back rather than guess. Guessing here would put a wrong range on a report.
  return null;
}

/**
 * Resolve the reference interval for a test against a patient's recorded sex.
 *
 * A sex-specific interval is used only when the patient's sex is known AND at least
 * one bound is configured for it. A half-configured sex range (min set, max blank)
 * is honoured for the bound that exists and falls back for the other — that is what
 * a lab means by "> 40" on a one-sided analyte like HDL.
 */
export function resolveReferenceRange(
  test: ReferenceRangeSource | null | undefined,
  gender?: string | null,
): ResolvedRange {
  if (!test) return { min: null, max: null, source: "default" };

  const defMin = num(test.normal_min);
  const defMax = num(test.normal_max);
  const sex = normaliseGender(gender);

  if (sex === "male") {
    const min = num(test.male_normal_min);
    const max = num(test.male_normal_max);
    if (min != null || max != null) {
      return { min: min ?? defMin, max: max ?? defMax, source: "male" };
    }
  }

  if (sex === "female") {
    const min = num(test.female_normal_min);
    const max = num(test.female_normal_max);
    if (min != null || max != null) {
      return { min: min ?? defMin, max: max ?? defMax, source: "female" };
    }
  }

  return { min: defMin, max: defMax, source: "default" };
}

/** Result flags, in the order LabResultWorkspace stores them. */
export type ResultFlag = "CL" | "CH" | "L" | "H" | "N";

export interface FlagSource extends ReferenceRangeSource {
  critical_low?: number | null;
  critical_high?: number | null;
}

/**
 * Flag a numeric result.
 *
 * Critical is evaluated BEFORE high/low, because a panic value must never be
 * downgraded to a plain H by an overlapping normal bound — Troponin I, where the
 * 99th-percentile URL is both the upper reference limit and the alert threshold,
 * is exactly that overlap.
 *
 * Critical bounds are deliberately NOT sex-specific: a potassium of 6.8 is a
 * telephone call regardless of who it belongs to, and no Indian lab varies panic
 * thresholds by sex.
 */
export function flagResult(
  test: FlagSource | null | undefined,
  value: number | null | undefined,
  gender?: string | null,
): ResultFlag | null {
  if (!test || value == null || Number.isNaN(Number(value))) return null;
  const v = Number(value);

  const critLow = num(test.critical_low);
  const critHigh = num(test.critical_high);
  if (critLow != null && v < critLow) return "CL";
  if (critHigh != null && v > critHigh) return "CH";

  const { min, max } = resolveReferenceRange(test, gender);
  if (min != null && v < min) return "L";
  if (max != null && v > max) return "H";
  return "N";
}

/**
 * The reference range as printed on a report, e.g. "13-17" or ">= 40".
 * Returns null for qualitative tests so the caller can omit the column entirely
 * rather than print an empty range.
 */
export function formatReferenceRange(
  test: ReferenceRangeSource | null | undefined,
  gender?: string | null,
): string | null {
  const { min, max } = resolveReferenceRange(test, gender);
  if (min != null && max != null) return `${min}-${max}`;
  if (min != null) return `>= ${min}`;
  if (max != null) return `<= ${max}`;
  return null;
}

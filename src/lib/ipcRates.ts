// ─── IPC / NABH HIC rate collection ───────────────────────────────────────────
//
// The dashboard used to recompute CLABSI/CAUTI/VAP/SSI in the browser, which was
// wrong in two ways: device-days were summed over each device's entire lifetime
// rather than the slice inside the reporting period, and the underlying rows were
// truncated by a .limit(500).
//
// The database already ships the correct computation — qi_collect_hic_device and
// qi_collect_hic in 20261011000030_quality_indicator_collectors.sql. They clip
// device-days to the period with
//   LEAST(COALESCE(removed_at, p_to), p_to) - GREATEST(inserted_at, p_from)
// and they are the same functions the QI/NABH engine reports from, so using them
// here is what makes the dashboard agree with the accreditation numbers.
//
// Both return TABLE(indicator_code text, numerator numeric, denominator numeric)
// and deliberately leave the multiplier to the caller.

import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/errorMessage";

export interface Rate {
  /** null when the denominator is zero — "no exposure", which is not the same as a rate of 0. */
  value: number | null;
  numerator: number;
  denominator: number | null;
}

export interface HicRates {
  clabsi: Rate;
  cauti: Rate;
  vap: Rate;
  ssi: Rate;
  hai: Rate;
  handHygiene: Rate;
  bundleCompliance: Rate;
}

export interface HicRatesResult {
  rates: HicRates | null;
  error: string | null;
  /** true when the collectors are absent (older database) and the caller should fall back. */
  unsupported: boolean;
}

const EMPTY_RATE: Rate = { value: null, numerator: 0, denominator: null };

interface CollectorRow {
  indicator_code: string;
  numerator: number | string | null;
  denominator: number | string | null;
}

function toRate(rows: CollectorRow[], code: string, multiplier: number): Rate {
  const row = rows.find(r => r.indicator_code === code);
  if (!row) return { ...EMPTY_RATE };

  const numerator = Number(row.numerator ?? 0);
  // The collectors wrap every denominator in NULLIF(x, 0), so null means
  // "nothing was exposed in this window" — render an em dash, never 0.00.
  const denominator = row.denominator == null ? null : Number(row.denominator);
  if (denominator == null || denominator === 0) return { value: null, numerator, denominator: null };

  return {
    value: Math.round((numerator / denominator) * multiplier * 100) / 100,
    numerator,
    denominator,
  };
}

/** PostgREST reports a missing function as PGRST202; Postgres uses 42883. */
function isMissingFunction(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = (error as { message?: string } | null)?.message ?? "";
  return code === "PGRST202" || code === "42883"
    || /could not find the function|does not exist|schema cache/i.test(message);
}

/**
 * Fetch the HIC indicator set for one hospital over [from, to).
 *
 * `to` is EXCLUSIVE — the SQL filters with `< p_to` and `onset_date < p_to::date`.
 * Callers working from an inclusive end date must pass the following day.
 */
export async function fetchHicRates(hospitalId: string, from: Date, to: Date): Promise<HicRatesResult> {
  const args = {
    p_hospital_id: hospitalId,
    p_from: from.toISOString(),
    // Clamp to now. The collector clips with LEAST(COALESCE(removed_at, p_to), p_to),
    // so a still-inserted device would otherwise be credited with device-days all the
    // way to a future p_to — inflating the denominator and understating every rate
    // for any period whose end has not yet arrived (MTD, "last 3M", today).
    p_to: new Date(Math.min(to.getTime(), Date.now())).toISOString(),
  };

  try {
    // `as any`: src/integrations/supabase/types.ts was generated 2026-07-19 and
    // predates the quality-indicator collectors, so these RPCs are not in Database.
    const [deviceRes, hicRes] = await Promise.all([
      (supabase as any).rpc("qi_collect_hic_device", args),
      (supabase as any).rpc("qi_collect_hic", args),
    ]);

    if (isMissingFunction(deviceRes.error) || isMissingFunction(hicRes.error)) {
      return { rates: null, error: null, unsupported: true };
    }
    const failure = deviceRes.error ?? hicRes.error;
    if (failure) {
      return { rates: null, error: getErrorMessage(failure), unsupported: false };
    }

    const deviceRows: CollectorRow[] = deviceRes.data ?? [];
    const hicRows: CollectorRow[] = hicRes.data ?? [];

    return {
      rates: {
        clabsi: toRate(deviceRows, "hic.clabsi_per1000", 1000),
        cauti: toRate(deviceRows, "hic.cauti_per1000", 1000),
        vap: toRate(deviceRows, "hic.vap_per1000", 1000),
        ssi: toRate(hicRows, "hic.ssi_pct", 100),
        hai: toRate(hicRows, "hic.hai_per1000", 1000),
        handHygiene: toRate(hicRows, "hic.hand_hygiene_pct", 100),
        bundleCompliance: toRate(hicRows, "hic.bundle_compliance_pct", 100),
      },
      error: null,
      unsupported: false,
    };
  } catch (e) {
    return { rates: null, error: getErrorMessage(e), unsupported: false };
  }
}

// ─── NABH targets ─────────────────────────────────────────────────────────────
// Source of truth is quality_indicator_definitions, seeded by
// 20261011000020_quality_indicator_catalogue.sql:296-317. Mirrored here so the
// dashboard flags "EXCEEDED" on the same thresholds the QI engine grades against —
// the page previously hardcoded CAUTI 1.5 and VAP 2.0, which are stricter than the
// catalogue and produced breaches that /quality did not agree with.
// (Per-hospital overrides in quality_indicator_overrides are not yet read here.)
export const HIC_TARGETS = {
  clabsi: 1.5,
  cauti: 2,
  vap: 2.5,
  ssi: 2,
} as const;

// ─── Client-side fallback ─────────────────────────────────────────────────────
// Only used when the collectors are missing (unsupported === true). Unlike the
// old implementation this clips each device's contribution to the period.

export interface DeviceWindow {
  device_type: string;
  device_inserted_at: string;
  device_removed_at: string | null;
}

/** Device-days of `type` accrued strictly inside [periodStart, periodEnd). */
export function deviceDaysInPeriod(
  devices: DeviceWindow[],
  type: string,
  periodStart: Date,
  periodEnd: Date,
): number {
  const endMs = periodEnd.getTime();
  const startMs = periodStart.getTime();

  return devices.reduce((sum, d) => {
    if (d.device_type !== type) return sum;
    const inserted = new Date(d.device_inserted_at).getTime();
    const removed = d.device_removed_at ? new Date(d.device_removed_at).getTime() : endMs;
    const overlap = Math.min(removed, endMs) - Math.max(inserted, startMs);
    return overlap > 0 ? sum + overlap / 86_400_000 : sum;
  }, 0);
}

/** Build a Rate the same shape the collectors produce, so the UI needs no branching. */
export function makeRate(numerator: number, denominator: number, multiplier: number): Rate {
  if (!(denominator > 0)) return { value: null, numerator, denominator: null };
  return {
    value: Math.round((numerator / denominator) * multiplier * 100) / 100,
    numerator,
    denominator,
  };
}

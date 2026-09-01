/**
 * Medication adherence maths for chronic care plans.
 *
 * Split out of MedicationAdherenceTab.tsx so that file exports only a
 * component — a file mixing component and non-component exports silently
 * disables Fast Refresh for it (same reason useHospitalContext.ts is split
 * out of HospitalContext.tsx).
 */

export interface AdherenceRow {
  id: string;
  drug_name: string;
  scheduled_date: string;
  dispensed_at: string | null;
  adherence_status: string;
}

/** Rolling window used for the adherence figure shown on a care plan. */
export const ADHERENCE_WINDOW_DAYS = 30;

export const toISODate = (d: Date) => d.toISOString().split("T")[0];

/**
 * Adherence % over the supplied rows, counting only doses that were actually
 * due. Future-dated doses are excluded — otherwise scheduling 30 days ahead
 * would instantly report 3% adherence.
 *
 * Returns null when nothing is due yet, so callers can distinguish
 * "no data" from "0% adherence".
 */
export function adherencePercent(rows: AdherenceRow[]): number | null {
  const today = toISODate(new Date());
  const due = rows.filter(r => r.scheduled_date <= today);
  if (due.length === 0) return null;
  const taken = due.filter(r => r.adherence_status === "taken").length;
  return Math.round((taken / due.length) * 100);
}

/** Banding used for the badge beside the adherence figure. */
export function adherenceBand(pct: number): "good" | "suboptimal" | "poor" {
  if (pct >= 80) return "good";
  if (pct >= 50) return "suboptimal";
  return "poor";
}

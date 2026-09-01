import { supabase } from "@/integrations/supabase/client";

/**
 * Shared home care plan helpers.
 *
 * Extracted from HomeCareActivePlansTab so the Discharge → Home Care handoff
 * schedules visits with exactly the same cadence rules as a manually created
 * plan — one implementation, not two that drift apart.
 */

export type HomeCareFrequency = "daily" | "alternate_days" | "weekly" | "twice_daily";

export const HOME_CARE_FREQUENCIES: HomeCareFrequency[] = [
  "daily",
  "alternate_days",
  "weekly",
  "twice_daily",
];

/** Days between consecutive scheduled visits for a given frequency. */
export function visitStepDays(frequency: string): number {
  switch (frequency) {
    case "alternate_days": return 2;
    case "weekly":         return 7;
    case "twice_daily":    return 1;
    case "daily":
    default:               return 1;
  }
}

/** Hard ceiling so a bad end date cannot generate thousands of rows. */
const MAX_VISITS = 180;

/** Default plan window when the clinician leaves the end date blank. */
const DEFAULT_WINDOW_DAYS = 30;

const toISODate = (d: Date) => d.toISOString().split("T")[0];

/**
 * Build the scheduled visit rows for a plan. Pure — no DB access — so it can
 * be unit tested and reused by any caller that needs a preview of the schedule.
 */
export function buildVisitSchedule(params: {
  hospitalId: string;
  planId: string;
  patientId: string;
  startDate: string;
  endDate?: string | null;
  frequency: string;
}) {
  const { hospitalId, planId, patientId, startDate, endDate, frequency } = params;
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return [];

  const end = endDate
    ? new Date(endDate)
    : new Date(start.getTime() + DEFAULT_WINDOW_DAYS * 86400000);
  if (Number.isNaN(end.getTime()) || end < start) return [];

  const step = visitStepDays(frequency);
  const visits: {
    hospital_id: string;
    plan_id: string;
    patient_id: string;
    scheduled_date: string;
    status: string;
  }[] = [];

  const cur = new Date(start);
  while (cur <= end && visits.length < MAX_VISITS) {
    visits.push({
      hospital_id: hospitalId,
      plan_id: planId,
      patient_id: patientId,
      scheduled_date: toISODate(cur),
      status: "scheduled",
    });
    cur.setDate(cur.getDate() + step);
  }
  return visits;
}

/**
 * Generate and persist the visit schedule for a newly created plan.
 * Returns the number of visits written, or throws so the caller can surface it.
 */
export async function generateVisits(params: {
  hospitalId: string;
  planId: string;
  patientId: string;
  startDate: string;
  endDate?: string | null;
  frequency: string;
}): Promise<number> {
  const visits = buildVisitSchedule(params);
  if (visits.length === 0) return 0;

  const { error } = await (supabase as any).from("home_care_visits").insert(visits);
  if (error) throw new Error(error.message);
  return visits.length;
}

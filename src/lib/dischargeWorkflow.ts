import { supabase } from "@/integrations/supabase/client";

/**
 * Discharge workflow initiation.
 *
 * `admissions.discharge_ordered_at` is the flag that means "the discharge
 * workflow is running": it starts the TAT clock, drives the daily stale-workflow
 * reset in IPDOverviewTab, and gates the billing/pharmacy auto-syncs there.
 *
 * It used to be written only as a side effect of DischargeTATTimer mounting
 * after medical clearance, so the "Initiate Discharge" button couldn't actually
 * start anything — it only scrolled to the card. Both entry points now call
 * this.
 *
 * Idempotent: an admission whose workflow is already running keeps its original
 * ordered-at, so the TAT clock is never silently restarted and the team is never
 * paged twice.
 */

export const DISCHARGE_INITIATED_EVENT = "discharge-workflow-initiated";

export interface DischargeInitiationResult {
  startedAt: string;
  alreadyStarted: boolean;
}

const TEAM_ALERTS = [
  "Discharge initiated — Billing: please finalise the IPD bill immediately.",
  "Discharge initiated — Pharmacy: clear all pending dispenses and check medication returns.",
  "Discharge initiated — Nursing: prepare discharge paperwork, patient education, and verify insurance documents.",
];

export async function initiateDischargeWorkflow(
  admissionId: string,
  hospitalId: string | null,
): Promise<DischargeInitiationResult> {
  const { data } = await (supabase as any)
    .from("admissions")
    .select("discharge_ordered_at")
    .eq("id", admissionId)
    .maybeSingle();

  const existing = data?.discharge_ordered_at as string | null | undefined;
  if (existing) return { startedAt: existing, alreadyStarted: true };

  const now = new Date().toISOString();
  const { error } = await (supabase as any)
    .from("admissions")
    .update({ discharge_ordered_at: now })
    .eq("id", admissionId);
  if (error) throw new Error(error.message);

  // Parallel team notifications — fire once, when the order is first created.
  // Deliberately non-blocking: a failed page must not block the discharge.
  if (hospitalId) {
    Promise.all(
      TEAM_ALERTS.map((alert_message) =>
        supabase.from("clinical_alerts").insert({
          hospital_id: hospitalId,
          alert_type: "discharge_initiated",
          severity: "low",
          alert_message,
        } as any),
      ),
    ).then(() => {}, () => {});
  }

  return { startedAt: now, alreadyStarted: false };
}

/** Tell any mounted TAT timer for this admission to pick up the new start time. */
export function announceDischargeInitiated(admissionId: string, startedAt: string) {
  window.dispatchEvent(
    new CustomEvent(DISCHARGE_INITIATED_EVENT, { detail: { admissionId, startedAt } }),
  );
}

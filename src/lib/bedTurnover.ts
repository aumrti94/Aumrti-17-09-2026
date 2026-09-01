import { supabase } from "@/integrations/supabase/client";

export type BedTurnoverTrigger = "discharge" | "transfer";

export interface CreateBedTurnoverTaskOpts {
  hospitalId: string;
  wardId: string | null | undefined;
  bedId: string;
  triggeredBy: BedTurnoverTrigger;
  /** admission_id the vacancy came from — housekeeping_tasks.trigger_ref_id. */
  triggerRefId: string;
}

export interface BedTurnoverResult {
  ok: boolean;
  bedNumber: string | null;
  error?: string;
}

/** validate_housekeeping_task() raising on an unknown triggered_by value. */
function isInvalidTriggerError(error: any): boolean {
  return String(error?.message || "").toLowerCase().includes("invalid triggered_by");
}

/**
 * Marks a vacated bed "cleaning" and opens the housekeeping bed_turnover task that a
 * discharge always has: the bed cannot be reassigned until Housekeeping completes it, at
 * which point TasksTab.tsx flips it back to "available" itself.
 *
 * Shared by DischargeSummaryGenerator.tsx and BedTransferModal.tsx — a mid-stay transfer
 * vacates the old bed exactly the way a discharge does.
 *
 * THE ORDER HERE IS THE WHOLE POINT. The task is inserted FIRST and the bed is only moved to
 * "cleaning" once that row exists. A bed sitting in "cleaning" with no task behind it is a
 * dead end — nothing in the app can ever return it to "available", because the only code that
 * does so is the completion handler for a task that was never created. That is exactly what
 * happened when the insert was fired blind after the status update: the ward lost a bed with
 * no visible cause and no way back short of editing the database. On failure the bed is
 * released to "available" instead, which is recoverable and honest: the patient really has
 * left it, and the caller surfaces a warning telling staff to have it cleaned manually.
 */
export async function createBedTurnoverTask(opts: CreateBedTurnoverTaskOpts): Promise<BedTurnoverResult> {
  const { hospitalId, wardId, bedId, triggeredBy, triggerRefId } = opts;

  const { data: bedData } = await supabase.from("beds").select("bed_number").eq("id", bedId).maybeSingle();
  const bedNumber = bedData?.bed_number ?? null;

  const taskRow = (trigger: string) => ({
    hospital_id: hospitalId,
    task_type: "bed_turnover",
    ward_id: wardId || null,
    bed_id: bedId,
    room_number: bedNumber,
    triggered_by: trigger,
    trigger_ref_id: triggerRefId,
    priority: "high",
    status: "pending",
    checklist: [
      { item: "Remove soiled linen", done: false },
      { item: "Clean mattress with disinfectant", done: false },
      { item: "Fit fresh linen", done: false },
      { item: "Clean bedside table", done: false },
      { item: "Mop floor", done: false },
      { item: "Supervisor inspection", done: false },
    ],
  });

  let { error } = await (supabase as any).from("housekeeping_tasks").insert(taskRow(triggeredBy));

  // A database that has not had migration 20261106000002 applied still runs this code, and
  // its validate_housekeeping_task() rejects triggered_by='transfer' outright — which would
  // mean no cleaning task at all for a transfer. 'manual' is accepted by every version, so
  // fall back to it and let the task exist; the only thing lost is the TRANSFER badge.
  // Same tolerate-the-older-schema approach as lib/wardNursingRate.ts.
  if (error && triggeredBy === "transfer" && isInvalidTriggerError(error)) {
    ({ error } = await (supabase as any).from("housekeeping_tasks").insert(taskRow("manual")));
  }

  if (error) {
    // No task landed — do NOT strand the bed in "cleaning". Release it so it stays usable.
    await supabase.from("beds").update({ status: "available" as any }).eq("id", bedId);
    console.error("bed_turnover task insert failed — bed released without a cleaning task:", error.message);
    return { ok: false, bedNumber, error: error.message };
  }

  await supabase.from("beds").update({ status: "cleaning" as any }).eq("id", bedId);
  return { ok: true, bedNumber };
}

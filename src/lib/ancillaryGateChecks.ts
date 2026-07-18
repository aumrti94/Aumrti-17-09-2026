/**
 * ancillaryGateChecks — "may this service proceed?" for one lab order / radiology order /
 * pharmacy dispense.
 *
 * These are the I/O wrappers the three block points call. Each resolves the order's own
 * context (is it an admission? what priority? which charge lines belong to it?) and hands the
 * decision to evaluateAncillaryGate, which is pure and unit-tested.
 *
 * Kept in its own module so the block points — labSamples.ts, the radiology workspace, the
 * dispensing workspace — do not have to import the billing engine just to ask a question.
 *
 * ON THE OVERRIDE. Nothing is persisted on the order. The gate guards a single action
 * (collect the sample / start the study / hand over the drugs), and an override is recorded
 * and then immediately spent on that action, so there is no state to carry. The audit trail
 * is a clinical_alerts row written by recordAncillaryOverride before the action proceeds.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  AncillaryClearance,
  IpdAncillaryService,
  checkAncillaryClearance,
} from "@/lib/ipdAncillaryGate";

/** Cleared with nothing to check — used when the order cannot be resolved. */
const CLEARED_UNKNOWN: AncillaryClearance = {
  cleared: true,
  reason: "no_charge_found",
  unpaidAmount: 0,
  overrideAvailable: false,
};

/** May this lab order's samples be collected? */
export async function checkLabOrderClearance(
  orderId: string,
  role?: string | null
): Promise<AncillaryClearance> {
  const { data: order } = await (supabase as any)
    .from("lab_orders")
    .select("hospital_id, admission_id, priority")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return CLEARED_UNKNOWN;

  const { data: items } = await (supabase as any)
    .from("lab_order_items")
    .select("id")
    .eq("lab_order_id", orderId);

  return checkAncillaryClearance(order.hospital_id, {
    service: "lab",
    admissionId: order.admission_id,
    priority: order.priority,
    role,
    dedupeKeys: (items || []).map((i: any) => `lab:${i.id}`),
  });
}

/** May this radiology study be started? */
export async function checkRadiologyOrderClearance(
  orderId: string,
  role?: string | null
): Promise<AncillaryClearance> {
  const { data: order } = await (supabase as any)
    .from("radiology_orders")
    .select("hospital_id, admission_id, priority")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return CLEARED_UNKNOWN;

  return checkAncillaryClearance(order.hospital_id, {
    service: "radiology",
    admissionId: order.admission_id,
    priority: order.priority,
    role,
    dedupeKeys: [`radiology:${orderId}`],
  });
}

/** May these drugs be handed over? */
export async function checkPharmacyDispenseClearance(
  dispensingId: string,
  role?: string | null
): Promise<AncillaryClearance> {
  const { data: disp } = await (supabase as any)
    .from("pharmacy_dispensing")
    .select("hospital_id, admission_id")
    .eq("id", dispensingId)
    .maybeSingle();
  if (!disp) return CLEARED_UNKNOWN;

  const { data: items } = await (supabase as any)
    .from("pharmacy_dispensing_items")
    .select("id")
    .eq("dispensing_id", dispensingId);

  return checkAncillaryClearance(disp.hospital_id, {
    service: "pharmacy",
    admissionId: disp.admission_id,
    // pharmacy_dispensing has no priority column. Urgency auto-bypass is therefore
    // inapplicable here, which the Settings copy states rather than inventing a field.
    priority: null,
    role,
    dedupeKeys: (items || []).map((i: any) => `pharmacy:dispense-item:${i.id}`),
  });
}

/**
 * Write the audit row for a payment-gate override, BEFORE the service proceeds.
 *
 * Author AND reason, or it isn't an audit trail — callers must not offer an override without
 * capturing why. Returns false if the row could not be written, and the caller should then
 * refuse the override rather than proceed unaudited.
 */
export async function recordAncillaryOverride(opts: {
  hospitalId: string;
  service: IpdAncillaryService;
  patientId?: string | null;
  reason: string;
  overriddenBy: string;
  detail?: string;
}): Promise<boolean> {
  if (!opts.reason.trim() || !opts.overriddenBy) return false;

  const { error } = await (supabase as any).from("clinical_alerts").insert({
    hospital_id: opts.hospitalId,
    alert_type: "ipd_ancillary_payment_override",
    severity: "medium",
    alert_message:
      `Payment gate overridden for ${opts.service}${opts.detail ? ` (${opts.detail})` : ""}. ` +
      `Reason: ${opts.reason.trim()}`,
    patient_id: opts.patientId ?? null,
    acknowledged_by: opts.overriddenBy,
  });

  return !error;
}

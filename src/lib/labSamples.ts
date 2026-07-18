// Shared lab sample lifecycle operations.
// Lab module completion plan, Phase 5 — extracted from LabResultWorkspace's
// handleMarkCollected/Received/Processing so the result workspace, the lab-side
// Collection workstation, and (Phase 9) the ward collection worklist all drive the
// same lab_samples / lab_order_items / lab_orders transitions through one code path.
import { supabase } from "@/integrations/supabase/client";
import { checkLabOrderClearance } from "@/lib/ancillaryGateChecks";

export const SAMPLE_REJECTION_REASONS = [
  "Hemolyzed",
  "Clotted",
  "Insufficient quantity (QNS)",
  "Wrong tube / container",
  "Unlabeled / mislabeled",
  "Lipemic",
  "Delayed transport",
  "Other",
] as const;

/**
 * Barcode for an order's collection labels: prefer the order's accession number
 * (Phase 3 — the ID analyzers echo back); legacy orders fall back to LAB-<uhid>-<id8>.
 */
export async function resolveOrderBarcode(orderId: string, uhid?: string | null): Promise<string> {
  const { data } = await (supabase as any)
    .from("lab_orders")
    .select("accession_number")
    .eq("id", orderId)
    .maybeSingle();
  return (
    data?.accession_number ||
    `LAB-${(uhid || "NOID").replace(/\s/g, "")}-${orderId.slice(0, 8).toUpperCase()}`
  );
}

/** Thrown when a pre-paid hospital's lab order has not been paid for yet. */
export class LabPaymentPendingError extends Error {
  readonly unpaidAmount: number;
  readonly overrideAvailable: boolean;
  constructor(unpaidAmount: number, overrideAvailable: boolean) {
    super("Payment is pending for this lab order — the sample cannot be collected yet.");
    this.name = "LabPaymentPendingError";
    this.unpaidAmount = unpaidAmount;
    this.overrideAvailable = overrideAvailable;
  }
}

/**
 * Mark all of an order's pending samples collected (+ items + order). Returns the label barcode.
 *
 * Sample collection is THE block point for lab: it is the first irreversible step, and it is
 * the chokepoint both callers (the Collection workstation and the result workspace) already
 * share — so the gate lives here rather than in either UI. Result ENTRY is deliberately never
 * gated: by then the sample is drawn and the work is done, and blocking would strand it.
 *
 * Pass `overridden: true` only after recordAncillaryOverride has written the audit row.
 */
export async function collectOrderSamples(opts: {
  orderId: string;
  userId: string;
  uhid?: string | null;
  role?: string | null;
  overridden?: boolean;
}): Promise<string> {
  if (!opts.overridden) {
    const clearance = await checkLabOrderClearance(opts.orderId, opts.role);
    if (!clearance.cleared) {
      throw new LabPaymentPendingError(clearance.unpaidAmount, clearance.overrideAvailable);
    }
  }

  const now = new Date().toISOString();
  const barcode = await resolveOrderBarcode(opts.orderId, opts.uhid);

  await supabase.from("lab_order_items").update({
    status: "sample_collected",
    sample_collected_at: now,
    sample_collected_by: opts.userId,
  }).eq("lab_order_id", opts.orderId).in("status", ["ordered"]);

  await (supabase as any).from("lab_orders").update({
    status: "sample_collected",
    barcode,
    sample_collected_at: now,
  }).eq("id", opts.orderId).eq("status", "ordered");

  await supabase.from("lab_samples").update({
    status: "collected",
    collected_at: now,
    collected_by: opts.userId,
  }).eq("lab_order_id", opts.orderId).eq("status", "pending");

  return barcode;
}

/** Mark an order's collected samples as received at the lab. */
export async function receiveOrderSamples(opts: { orderId: string; userId: string }): Promise<void> {
  await supabase.from("lab_samples").update({
    status: "received",
    received_at: new Date().toISOString(),
    received_by: opts.userId,
  }).eq("lab_order_id", opts.orderId).eq("status", "collected");
}

/** Move an order's received samples into processing (+ items + order). */
export async function startOrderProcessing(opts: { orderId: string; userId: string }): Promise<void> {
  await supabase.from("lab_samples").update({
    status: "processing",
  }).eq("lab_order_id", opts.orderId).eq("status", "received");

  await supabase.from("lab_order_items").update({
    status: "in_process",
  }).eq("lab_order_id", opts.orderId).in("status", ["ordered", "sample_collected"]);

  await supabase.from("lab_orders").update({ status: "in_process" }).eq("id", opts.orderId);
}

/**
 * Reject a single sample (hemolyzed/clotted/QNS/...) and create a linked recollection
 * sample in 'pending' so the collection worklist immediately shows the redraw.
 * The parent order's items are reset from 'sample_collected' back to 'ordered' only if
 * the order now has NO other viable (non-rejected) sample.
 */
export async function rejectSample(opts: {
  sampleId: string;
  userId: string;
  reason: string;
}): Promise<{ recollectionSampleId: string | null }> {
  const now = new Date().toISOString();

  const { data: sample } = await (supabase as any)
    .from("lab_samples")
    .select("id, hospital_id, lab_order_id, sample_type, barcode")
    .eq("id", opts.sampleId)
    .maybeSingle();
  if (!sample) throw new Error("Sample not found");

  const { error: rejErr } = await (supabase as any).from("lab_samples").update({
    status: "rejected",
    rejection_reason: opts.reason,
    rejected_at: now,
    rejected_by: opts.userId,
  }).eq("id", opts.sampleId);
  if (rejErr) throw rejErr;

  // Linked recollection sample — same type, fresh barcode suffix, back to 'pending'
  const { data: recollection, error: recErr } = await (supabase as any)
    .from("lab_samples")
    .insert({
      hospital_id: sample.hospital_id,
      lab_order_id: sample.lab_order_id,
      sample_type: sample.sample_type,
      barcode: `${sample.barcode || "RC"}-R${Date.now().toString(36).slice(-4).toUpperCase()}`,
      status: "pending",
      recollected_from_sample_id: sample.id,
    })
    .select("id")
    .maybeSingle();
  if (recErr) throw recErr;

  // If no other viable sample remains, wind the order + items back to awaiting collection
  const { data: viable } = await (supabase as any)
    .from("lab_samples")
    .select("id")
    .eq("lab_order_id", sample.lab_order_id)
    .in("status", ["collected", "received", "processing"])
    .limit(1);
  if (!viable?.length) {
    await supabase.from("lab_order_items").update({ status: "ordered" })
      .eq("lab_order_id", sample.lab_order_id).eq("status", "sample_collected");
    await supabase.from("lab_orders").update({ status: "ordered" })
      .eq("id", sample.lab_order_id).eq("status", "sample_collected");
  }

  return { recollectionSampleId: recollection?.id ?? null };
}

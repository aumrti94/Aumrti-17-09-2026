import { supabase } from "@/integrations/supabase/client";
import { calcGST } from "@/lib/currency";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { recalculateBillTotalsSafe } from "@/lib/billTotals";
import { autoPostJournalEntry } from "@/lib/accounting";
import { getModuleDefaultRate } from "@/lib/serviceRates";

export interface PostChargeOpts {
  hospitalId: string;
  patientId: string;
  admissionId?: string | null;      // set → IPD track (advance_covered)
  encounterId?: string | null;
  description: string;
  itemType: string;                  // e.g. "lab_test" | "radiology" | "dialysis" | "procedure"
  quantity?: number;
  unitPrice?: number;                // override; else fetched from service_master
  sourceModule: "lab" | "radiology" | "ot" | "dialysis" | "physio" | "blood_bank" | "nursing" | "pharmacy";
  sourceId: string;                  // FK to originating record
  dedupeKey?: string;                // defaults to `${sourceModule}:${sourceId}`
  orderedBy?: string;
}

export interface PostChargeResult {
  success: boolean;
  billItemId?: string;
  billId?: string;
  amount?: number;
  paymentStatus?: "pending_payment" | "advance_covered";
  error?: string;
}

/**
 * Point-of-Care Charge Capture: creates a bill line item at ORDER time.
 * OPD → payment_status = pending_payment (must pay at cash counter before service)
 * IPD → payment_status = advance_covered (debited from advance balance)
 */
export async function postCharge(opts: PostChargeOpts): Promise<PostChargeResult> {
  const {
    hospitalId, patientId, admissionId, encounterId,
    description, itemType, quantity = 1, unitPrice,
    sourceModule, sourceId, orderedBy,
  } = opts;

  const dedupeKey = opts.dedupeKey || `${sourceModule}:${sourceId}`;
  const isIPD = !!admissionId;
  const paymentStatus: "pending_payment" | "advance_covered" = isIPD ? "advance_covered" : "pending_payment";

  try {
    // 1. Idempotency check — skip if already posted
    const { data: existing } = await (supabase as any)
      .from("bill_line_items")
      .select("id, bill_id, total_amount")
      .eq("hospital_id", hospitalId)
      .eq("source_dedupe_key", dedupeKey)
      .maybeSingle();

    if (existing) {
      return { success: true, billItemId: existing.id, billId: existing.bill_id, amount: existing.total_amount, paymentStatus };
    }

    // 2. Resolve unit price
    let resolvedRate = unitPrice;
    let gstPct = 0;
    if (!resolvedRate) {
      const { data: svc } = await (supabase as any)
        .from("service_master")
        .select("fee, gst_percent, gst_applicable")
        .eq("hospital_id", hospitalId)
        .eq("item_type", itemType)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      resolvedRate = svc?.fee ? Number(svc.fee) : 0;
      gstPct = svc?.gst_applicable ? Number(svc.gst_percent) || 0 : 0;
      // Last resort: the module's configured default rate (service_rates) so
      // specialized modules bill the configured amount instead of ₹0.
      if (!resolvedRate) {
        const r = await getModuleDefaultRate(hospitalId, itemType, 0);
        resolvedRate = r.rate;
        if (!gstPct) gstPct = r.gst;
      }
    }

    const taxable = resolvedRate * quantity;
    const gstAmount = calcGST(taxable, gstPct);
    const totalAmount = taxable + gstAmount;

    // 3. Find or create bill
    let billId: string;

    if (isIPD && admissionId) {
      // Look for existing draft IPD bill for this admission
      const { data: ipdBill } = await (supabase as any)
        .from("bills")
        .select("id")
        .eq("hospital_id", hospitalId)
        .eq("admission_id", admissionId)
        .eq("bill_type", "ipd")
        .in("bill_status", ["draft", "final"])
        .limit(1)
        .maybeSingle();

      if (ipdBill) {
        billId = ipdBill.id;
      } else {
        const billNumber = await generateBillNumber(hospitalId, "IPD");
        const { data: newBill, error: be } = await (supabase as any)
          .from("bills")
          .insert({
            hospital_id: hospitalId,
            patient_id: patientId,
            admission_id: admissionId,
            bill_number: billNumber,
            bill_type: "ipd",
            bill_date: new Date().toISOString().split("T")[0],
            bill_status: "draft",
            payment_status: "unpaid",
            subtotal: 0, gst_amount: 0, total_amount: 0, patient_payable: 0, balance_due: 0,
          })
          .select("id")
          .maybeSingle();
        if (be || !newBill) return { success: false, error: be?.message || "IPD bill creation failed" };
        billId = newBill.id;
      }
    } else {
      // OPD: find or create bill for this encounter
      let opdBill: any = null;
      if (encounterId) {
        const { data } = await (supabase as any)
          .from("bills")
          .select("id")
          .eq("hospital_id", hospitalId)
          .eq("patient_id", patientId)
          .eq("encounter_id", encounterId)
          .eq("bill_type", "opd")
          .limit(1)
          .maybeSingle();
        opdBill = data;
      }

      if (opdBill) {
        billId = opdBill.id;
      } else {
        const prefix = sourceModule === "lab" ? "LAB" : sourceModule === "radiology" ? "RAD" : "OPD";
        const billNumber = await generateBillNumber(hospitalId, prefix);
        const { data: newBill, error: be } = await (supabase as any)
          .from("bills")
          .insert({
            hospital_id: hospitalId,
            patient_id: patientId,
            encounter_id: encounterId || null,
            bill_number: billNumber,
            bill_type: "opd",
            bill_date: new Date().toISOString().split("T")[0],
            bill_status: "final",
            payment_status: "unpaid",
            subtotal: 0, gst_amount: 0, total_amount: 0, patient_payable: 0, balance_due: 0,
          })
          .select("id")
          .maybeSingle();
        if (be || !newBill) return { success: false, error: be?.message || "OPD bill creation failed" };
        billId = newBill.id;
      }
    }

    // 4. Insert line item with payment_status
    const { data: li, error: lie } = await (supabase as any)
      .from("bill_line_items")
      .insert({
        hospital_id: hospitalId,
        bill_id: billId,
        description,
        item_type: itemType,
        quantity,
        unit_rate: resolvedRate,
        taxable_amount: taxable,
        gst_percent: gstPct,
        gst_amount: gstAmount,
        total_amount: totalAmount,
        source_module: sourceModule,
        source_record_id: sourceId,
        source_dedupe_key: dedupeKey,
        ordered_by: orderedBy || null,
        service_date: new Date().toISOString().split("T")[0],
        payment_status: paymentStatus,
      })
      .select("id")
      .maybeSingle();

    if (lie || !li) return { success: false, error: lie?.message || "Line item insert failed" };

    // 5. Recalculate bill totals
    await recalculateBillTotalsSafe(billId);

    // 6. IPD: debit the advance balance
    if (isIPD && admissionId && totalAmount > 0) {
      await (supabase as any).from("ipd_advances").insert({
        hospital_id: hospitalId,
        admission_id: admissionId,
        patient_id: patientId,
        amount: totalAmount,
        transaction_type: "service_debit",
        description: `Service: ${description}`,
        collected_by: orderedBy || null,
      });
    }

    // 7. Journal entry (non-blocking)
    if (orderedBy) {
      try {
        await autoPostJournalEntry({
          triggerEvent: `charge_posted_${sourceModule}`,
          sourceModule,
          sourceId: billId,
          amount: totalAmount,
          description: `Charge: ${description}`,
          hospitalId,
          postedBy: orderedBy,
        });
      } catch { /* non-blocking */ }
    }

    return { success: true, billItemId: li.id, billId, amount: totalAmount, paymentStatus };
  } catch (err: any) {
    console.error("postCharge error:", err);
    return { success: false, error: err?.message || "Unknown error" };
  }
}

/**
 * Mark a pending_payment line item (or all items on a bill) as paid.
 * Call this from the cash counter when payment is confirmed.
 */
export async function markItemPaid(opts: {
  billItemId?: string;
  billId?: string;
  collectedBy: string;
}): Promise<boolean> {
  const now = new Date().toISOString();
  try {
    if (opts.billItemId) {
      await (supabase as any)
        .from("bill_line_items")
        .update({ payment_status: "paid", payment_collected_at: now, payment_collected_by: opts.collectedBy })
        .eq("id", opts.billItemId);
    } else if (opts.billId) {
      await (supabase as any)
        .from("bill_line_items")
        .update({ payment_status: "paid", payment_collected_at: now, payment_collected_by: opts.collectedBy })
        .eq("bill_id", opts.billId)
        .eq("payment_status", "pending_payment");
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Lookup service rate from service_master by itemType name match.
 */
export async function lookupServiceRate(hospitalId: string, itemType: string, nameLike?: string): Promise<number> {
  const q = (supabase as any)
    .from("service_master")
    .select("fee")
    .eq("hospital_id", hospitalId)
    .eq("item_type", itemType)
    .eq("is_active", true)
    .limit(1);
  if (nameLike) q.ilike("name", `%${nameLike}%`);
  const { data } = await q.maybeSingle();
  return data?.fee ? Number(data.fee) : 0;
}

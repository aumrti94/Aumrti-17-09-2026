import { supabase } from "@/integrations/supabase/client";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { autoPostJournalEntry } from "@/lib/accounting";
import { recalculateBillTotalsSafe } from "@/lib/billTotals";
import { roundCurrency, calcGST } from "@/lib/currency";

/**
 * Auto-bill OPD lab/radiology charges when results are finalized.
 * Skips IPD patients (handled by discharge auto-pull).
 * Idempotent: returns null silently if the order is already billed.
 */
export async function autoBillOpdInvestigation(opts: {
  hospitalId: string;
  patientId: string;
  encounterId?: string | null;
  admissionId?: string | null;
  orderedBy: string;
  lineItems: {
    description: string;
    itemType: "lab_test" | "radiology";
    unitRate: number;
    quantity?: number;
    gstPercent?: number;
    gstAmount?: number;
  }[];
  billPrefix: string; // 'LAB' or 'RAD'
  sourceModule: string; // 'lab' or 'radiology'
  sourceId: string; // lab_orders.id or radiology_orders.id
}): Promise<{ billId: string; total: number } | null> {
  if (opts.admissionId) return null;
  if (!opts.lineItems.length) return null;

  // Determine which table holds the order record
  const orderTable = opts.sourceModule === "lab" ? "lab_orders" : "radiology_orders";
  // bill_type matches sourceModule: "lab" | "radiology"
  const billType = opts.sourceModule === "lab" ? "lab" : "radiology";

  try {
    // ── Idempotency guard ──────────────────────────────────────────────────────
    // If the order row already has billing_status = 'billed', a prior run
    // already created the bill. Return null — nothing to do.
    const { data: orderRow } = await (supabase as any)
      .from(orderTable)
      .select("billing_status")
      .eq("id", opts.sourceId)
      .maybeSingle();

    if (orderRow?.billing_status === "billed") return null;

    // ── Calculate line item totals ─────────────────────────────────────────────
    let subtotal = 0;
    let totalGst = 0;
    const lineItemPayloads: any[] = [];

    for (const item of opts.lineItems) {
      const qty = item.quantity ?? 1;
      const taxable = roundCurrency(item.unitRate * qty);
      const gst = item.gstAmount != null
        ? roundCurrency(item.gstAmount)
        : calcGST(taxable, item.gstPercent ?? 0);
      subtotal = roundCurrency(subtotal + taxable);
      totalGst = roundCurrency(totalGst + gst);

      lineItemPayloads.push({
        hospital_id: opts.hospitalId,
        description: item.description,
        // DB CHECK constraint: 'lab' not 'lab_test'
        item_type: item.itemType === "lab_test" ? "lab" : "radiology",
        unit_rate: item.unitRate,
        quantity: qty,
        taxable_amount: taxable,
        gst_percent: item.gstPercent ?? 0,
        gst_amount: gst,
        total_amount: roundCurrency(taxable + gst),
        service_date: new Date().toISOString().split("T")[0],
        source_module: opts.sourceModule,
        source_record_id: opts.sourceId,
        ordered_by: opts.orderedBy,
      });
    }

    const grandTotal = roundCurrency(subtotal + totalGst);

    // ── Open-bill lookup ───────────────────────────────────────────────────────
    // Append to an existing unpaid/partial bill of the same type for this
    // encounter, so repeated result entries don't create multiple bill headers.
    let existingBill: any = null;
    if (opts.encounterId) {
      const { data } = await (supabase as any)
        .from("bills")
        .select("id")
        .eq("hospital_id", opts.hospitalId)
        .eq("patient_id", opts.patientId)
        .eq("encounter_id", opts.encounterId)
        .eq("bill_type", billType)
        .in("payment_status", ["unpaid", "partial"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      existingBill = data;
    }

    let billId: string;

    if (existingBill) {
      billId = existingBill.id;

      for (const lp of lineItemPayloads) {
        await (supabase as any).from("bill_line_items").insert({ ...lp, bill_id: billId });
      }

      const result = await recalculateBillTotalsSafe(billId);
      if (!result.ok) {
        console.error("Investigation bill recalculation failed:", result.error);
      }
    } else {
      // ── Create new bill ────────────────────────────────────────────────────
      const billNumber = await generateBillNumber(opts.hospitalId, opts.billPrefix);

      const { data: newBill, error: billErr } = await (supabase as any)
        .from("bills")
        .insert({
          hospital_id: opts.hospitalId,
          patient_id: opts.patientId,
          encounter_id: opts.encounterId ?? null,
          bill_number: billNumber,
          bill_type: billType,
          bill_date: new Date().toISOString().split("T")[0],
          bill_status: "final",
          payment_status: "unpaid",
          subtotal,
          gst_amount: totalGst,
          total_amount: grandTotal,
          patient_payable: grandTotal,
          balance_due: grandTotal,
        })
        .select("id")
        .maybeSingle();

      if (billErr || !newBill) {
        console.error("Auto-bill creation failed:", billErr?.message);
        return null;
      }

      billId = newBill.id;

      for (const lp of lineItemPayloads) {
        await (supabase as any).from("bill_line_items").insert({ ...lp, bill_id: billId });
      }

      // Non-blocking journal entry for revenue recognition
      try {
        const triggerEvent = billType === "lab" ? "bill_finalized_lab" : "bill_finalized_radiology";
        await autoPostJournalEntry({
          triggerEvent,
          sourceModule: opts.sourceModule,
          sourceId: billId,
          amount: grandTotal,
          description: `${opts.billPrefix} charges — Bill ${billNumber}`,
          hospitalId: opts.hospitalId,
          postedBy: opts.orderedBy,
        });
      } catch (e) {
        console.error("Journal auto-post error (non-blocking):", e);
      }
    }

    // ── Mark order as billed ───────────────────────────────────────────────────
    await (supabase as any)
      .from(orderTable)
      .update({ billing_status: "billed" })
      .eq("id", opts.sourceId);

    return { billId, total: grandTotal };
  } catch (err) {
    console.error("Auto-bill OPD investigation error:", err);
    return null;
  }
}

/**
 * Look up service rate for a lab test or radiology study.
 * Priority: the module's own master table (the canonical fee, editable from
 * Settings → Services & Fees) → service_master.fee → hard default.
 *
 * NOTE: service_master stores the fee in the `fee` column (there is no `rate`
 * column). Earlier code selected `rate`, which always returned null and made
 * configured fees silently ignored — that is fixed here.
 */
export async function getInvestigationRate(
  hospitalId: string,
  name: string,
  type: "lab" | "radiology"
): Promise<{ rate: number; gstPercent: number; isDefaultRate?: boolean }> {
  // 1) Canonical source: the module's own master table.
  if (type === "lab") {
    const { data: lt } = await (supabase as any)
      .from("lab_test_master")
      .select("fee")
      .eq("hospital_id", hospitalId)
      .ilike("test_name", `%${name}%`)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (lt?.fee != null) return { rate: Number(lt.fee), gstPercent: 0 };
  } else {
    const { data: rs } = await (supabase as any)
      .from("radiology_study_master")
      .select("fee")
      .eq("hospital_id", hospitalId)
      .ilike("study_name", `%${name}%`)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (rs?.fee != null) return { rate: Number(rs.fee), gstPercent: 0 };
  }

  // 2) Secondary: a matching service_master row (item_type lab/radiology).
  const { data: svc } = await (supabase as any)
    .from("service_master")
    .select("fee, gst_percent, gst_applicable")
    .eq("hospital_id", hospitalId)
    .eq("item_type", type)
    .ilike("name", `%${name}%`)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (svc?.fee != null) {
    return { rate: Number(svc.fee), gstPercent: svc.gst_applicable ? Number(svc.gst_percent) || 0 : 0 };
  }

  // 3) Hard default — avoids ₹0 bills. isDefaultRate lets callers visibly mark the
  //    bill line (Phase 4) instead of silently charging a made-up figure.
  return { rate: type === "lab" ? 200 : 500, gstPercent: 0, isDefaultRate: true };
}

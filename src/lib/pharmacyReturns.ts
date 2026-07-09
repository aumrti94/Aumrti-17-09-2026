import { supabase } from "@/integrations/supabase/client";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { autoPostJournalEntry } from "@/lib/accounting";
import { applyReturnCreditToBill } from "@/lib/pharmacyReturnCredit";

export type StockAction = "returned_to_stock" | "quarantined" | "destroyed";

export const STOCK_ACTIONS: { value: StockAction; label: string; cls: string }[] = [
  { value: "returned_to_stock", label: "Return to stock",   cls: "bg-emerald-100 text-emerald-700 border-emerald-300" },
  { value: "quarantined",       label: "Quarantine",         cls: "bg-amber-100 text-amber-700 border-amber-300" },
  { value: "destroyed",         label: "Destroy / Dispose",  cls: "bg-red-100 text-red-700 border-red-300" },
];

export interface PharmacyReturnLine {
  dispensingItemId: string;
  dispensingId: string | null;
  drugId?: string | null;
  drugSchedule?: string | null;
  drugName: string;
  batchId: string | null;
  batchNumber?: string | null;
  quantity: number;
  unitPrice: number;
  gstPercent: number;
  isNdps: boolean;
  reason: string;
  stockAction: StockAction;
}

export interface PharmacyReturnContext {
  hospitalId: string;
  patientId: string | null;
  patientName?: string | null;
  admissionId: string | null;
  billId: string | null;
  billPaymentStatus?: string | null;
  userId: string | null;
  ndpsPharmacistId?: string | null;
  ndpsSeniorId?: string | null;
  requiresInsuranceAmendment?: boolean;
  insuranceAmendmentNotes?: string | null;
}

export interface PharmacyReturnResult {
  creditNoteId: string | null;
  creditNoteNumber: string | null;
  totalRefund: number;
  billAdjusted: boolean;
  refundPayableCreated: boolean;
}

/**
 * Single implementation shared by PharmacyReturnsTab (single-item, hospital-wide
 * return list) and DrugReturnModal (admission-scoped, NDPS-aware batch return),
 * so both produce identical downstream effects: stock disposition, NDPS register
 * entry, credit note + bill adjustment, journal reversal, refund payable, and
 * pharmacy_return_audit — previously only a subset of these ran depending on
 * which screen processed the return.
 */
export async function processPharmacyReturn(
  ctx: PharmacyReturnContext,
  lines: PharmacyReturnLine[]
): Promise<PharmacyReturnResult> {
  const now = new Date().toISOString();
  let totalBase = 0;
  let totalGst = 0;
  const creditLinePayloads: Array<{
    dispensingItemId: string;
    drugName: string;
    quantity: number;
    unitPrice: number;
    gstPercent: number;
    gstCredit: number;
    lineTotal: number;
  }> = [];

  for (const line of lines) {
    const base = line.quantity * line.unitPrice;
    const gst = parseFloat((base * (line.gstPercent / 100)).toFixed(2));
    const lineTotal = parseFloat((base + gst).toFixed(2));
    totalBase += base;
    totalGst += gst;

    const returnConfirmedBy =
      line.isNdps && ctx.ndpsPharmacistId ? ctx.ndpsPharmacistId : ctx.userId;

    // 1. Mark dispensing item as returned
    await (supabase as any)
      .from("pharmacy_dispensing_items")
      .update({
        return_quantity: line.quantity,
        return_reason: line.reason,
        return_status: "confirmed",
        returned_at: now,
        returned_by: ctx.userId,
        return_confirmed_by: returnConfirmedBy,
        ...(line.isNdps && ctx.ndpsSeniorId ? { ndps_return_senior_id: ctx.ndpsSeniorId } : {}),
      })
      .eq("id", line.dispensingItemId);

    // 2. Stock disposition (3-way)
    if (line.batchId) {
      if (line.stockAction === "returned_to_stock") {
        const { data: batchRow } = await (supabase as any)
          .from("drug_batches")
          .select("quantity_available")
          .eq("id", line.batchId)
          .maybeSingle();
        if (batchRow) {
          await (supabase as any)
            .from("drug_batches")
            .update({ quantity_available: (batchRow.quantity_available || 0) + line.quantity })
            .eq("id", line.batchId);
        }
      } else {
        await (supabase as any)
          .from("drug_batches")
          .update({ status: line.stockAction })
          .eq("id", line.batchId);
      }
    }

    // 3. NDPS/Schedule-H1 return register entry (immutable — trigger prevents mutation).
    // Schedule H1 drugs (antibiotics/habit-forming, Rule 65) need register logging too,
    // but — unlike NDPS/Schedule X — never require the dual-pharmacist sign-off, so this
    // condition is intentionally broader than the dual-confirm UI trigger elsewhere.
    if ((line.isNdps || line.drugSchedule === "H1") && line.drugId) {
      const { data: lastNdps } = await (supabase as any)
        .from("ndps_register")
        .select("balance_after")
        .eq("drug_id", line.drugId)
        .eq("hospital_id", ctx.hospitalId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const newBalance = Number(lastNdps?.balance_after ?? 0) + line.quantity;

      await (supabase as any).from("ndps_register").insert({
        hospital_id: ctx.hospitalId,
        drug_id: line.drugId,
        drug_name: line.drugName,
        drug_schedule: line.drugSchedule || "X",
        transaction_type: "return",
        quantity: line.quantity,
        balance_after: newBalance,
        patient_name: ctx.patientName || null,
        pharmacist_id: ctx.ndpsPharmacistId || ctx.userId,
        second_pharmacist_id: ctx.ndpsSeniorId || null,
        remarks: `Return: ${line.reason}. Dispensing item ${line.dispensingItemId}`,
      });
    }

    creditLinePayloads.push({
      dispensingItemId: line.dispensingItemId,
      drugName: line.drugName,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      gstPercent: line.gstPercent,
      gstCredit: gst,
      lineTotal,
    });
  }

  const totalRefund = parseFloat((totalBase + totalGst).toFixed(2));

  let creditNoteId: string | null = null;
  let creditNoteNumber: string | null = null;
  let billAdjusted = false;
  let refundPayableCreated = false;

  if (totalRefund > 0) {
    creditNoteNumber = await generateBillNumber(ctx.hospitalId, "CN");

    const { data: cn, error: cnErr } = await (supabase as any)
      .from("credit_notes")
      .insert({
        hospital_id: ctx.hospitalId,
        credit_note_number: creditNoteNumber,
        patient_id: ctx.patientId,
        admission_id: ctx.admissionId,
        original_bill_id: ctx.billId,
        dispensing_id: lines[0]?.dispensingId ?? null,
        credit_amount: parseFloat(totalBase.toFixed(2)),
        gst_credit: parseFloat(totalGst.toFixed(2)),
        total_credit: totalRefund,
        return_reason: [...new Set(lines.map((l) => l.reason))].join(", "),
        requires_insurance_amendment: ctx.requiresInsuranceAmendment ?? false,
        insurance_amendment_notes: ctx.insuranceAmendmentNotes ?? null,
        status: "approved",
        created_by: ctx.userId,
        approved_by: ctx.userId,
        approved_at: now,
      })
      .select("id")
      .maybeSingle();

    if (!cnErr && cn) {
      creditNoteId = cn.id;

      await (supabase as any).from("credit_note_items").insert(
        creditLinePayloads.map((p) => ({
          hospital_id: ctx.hospitalId,
          credit_note_id: cn.id,
          dispensing_item_id: p.dispensingItemId,
          drug_name: p.drugName,
          return_quantity: p.quantity,
          unit_rate: p.unitPrice,
          gst_percent: p.gstPercent,
          gst_credit: p.gstCredit,
          line_credit: p.lineTotal,
        }))
      );

      let creditResult: { overpaid: boolean; overpaidAmount: number } = { overpaid: false, overpaidAmount: 0 };
      if (ctx.billId) {
        creditResult = await applyReturnCreditToBill(
          ctx.billId,
          ctx.hospitalId,
          cn.id,
          creditLinePayloads.map((p) => ({
            drugName: p.drugName,
            quantity: p.quantity,
            unitRate: p.unitPrice,
            gstPercent: p.gstPercent,
            gstAmount: p.gstCredit,
            lineTotal: p.lineTotal,
          })),
          totalBase,
          totalGst,
          totalRefund
        );
        billAdjusted = true;
      }

      await autoPostJournalEntry({
        triggerEvent: "credit_note_pharmacy",
        sourceModule: "pharmacy",
        sourceId: cn.id,
        amount: totalRefund,
        description: `Drug Return Credit Note ${creditNoteNumber}${ctx.patientName ? ` — ${ctx.patientName}` : ""}`,
        hospitalId: ctx.hospitalId,
        postedBy: ctx.userId,
      });

      // A refund is owed whenever the return pushed the bill into actual
      // overpayment (checked against the post-credit bill state, not the
      // pre-return payment_status) — a "partial" bill can become overpaid by
      // a large enough return credit just as easily as a "paid" one.
      if (creditResult.overpaid) {
        await (supabase as any).from("refund_payables").insert({
          hospital_id: ctx.hospitalId,
          patient_id: ctx.patientId,
          admission_id: ctx.admissionId,
          credit_note_id: cn.id,
          amount: creditResult.overpaidAmount,
          status: "pending_approval",
          requested_by: ctx.userId,
          notes: `Drug return: ${creditNoteNumber}. Requires billing supervisor approval.`,
        });
        refundPayableCreated = true;
      }
    } else {
      console.warn("Credit note creation failed:", cnErr?.message);
    }
  }

  // pharmacy_return_audit — one row per line, now written regardless of which
  // screen (PharmacyReturnsTab or DrugReturnModal) processed the return.
  await (supabase as any).from("pharmacy_return_audit").insert(
    lines.map((line, i) => ({
      hospital_id: ctx.hospitalId,
      dispensing_item_id: line.dispensingItemId,
      patient_id: ctx.patientId,
      admission_id: ctx.admissionId,
      bill_id: billAdjusted ? ctx.billId : null,
      credit_note_id: creditNoteId,
      drug_name: line.drugName,
      batch_number: line.batchNumber || null,
      quantity_returned: line.quantity,
      unit_price: line.unitPrice,
      total_refund: creditLinePayloads[i]?.lineTotal ?? 0,
      return_reason: line.reason,
      stock_action: line.stockAction,
      bill_adjusted: billAdjusted,
      bill_adjustment_at: billAdjusted ? now : null,
      created_by: ctx.userId,
    }))
  );

  return { creditNoteId, creditNoteNumber, totalRefund, billAdjusted, refundPayableCreated };
}

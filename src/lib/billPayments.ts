import { supabase } from "@/integrations/supabase/client";
import { autoPostJournalEntry } from "@/lib/accounting";
import { logAudit } from "@/lib/auditLog";
import { sendWhatsApp } from "@/lib/whatsapp-send";
import { checkBillWritable } from "@/lib/lockedDay";
import { releasePackageOrders } from "@/lib/packageOrders";

export interface PaymentRow {
  mode: string;
  amount: number;
  reference?: string | null;
}

export interface RecordBillPaymentOpts {
  hospitalId: string;
  billId: string;
  billNumber: string;
  patientId?: string | null;
  admissionId?: string | null;
  rows: PaymentRow[];
  collectedBy: string | null;
  /** Caller computes these — formulas differ (e.g. IPD advance-aware vs flat OPD). */
  newPaidAmount: number;
  newBalanceDue: number;
  newPaymentStatus: "paid" | "partial" | "unpaid";
  sendReceipt?: boolean;
}

export interface RecordBillPaymentResult {
  ok: boolean;
  totalCollected: number;
  error?: string;
}

/**
 * The one real write path for "a payment was collected against a bill":
 * bill_payments row(s), GL posting per payment, bills.paid_amount/balance_due/
 * payment_status update, billing_cleared sync, optional WhatsApp receipt, audit log.
 * Extracted from PaymentsTab.handleCollect so PendingCollectionsPanel and
 * CollectionsTab stop hand-rolling their own (previously broken) versions of this.
 */
export async function recordBillPayment(opts: RecordBillPaymentOpts): Promise<RecordBillPaymentResult> {
  const rows = opts.rows.filter((r) => r.amount > 0);
  const totalCollected = rows.reduce((s, r) => s + r.amount, 0);
  if (totalCollected <= 0) {
    return { ok: false, totalCollected: 0, error: "Nothing to collect" };
  }

  // ── Pre-flight guards (run BEFORE inserting any payment row) ──
  // Historically the payment row was inserted first and the bills update second,
  // so a rejected/blocked update left an orphan payment behind — and nothing
  // stopped collecting more than the balance due. Both are checked up front now
  // against the authoritative DB state so no orphan row can be created.
  const { data: bill, error: billErr } = await supabase
    .from("bills")
    .select("bill_date, balance_due, payment_status, bill_status, admission_id")
    .eq("id", opts.billId)
    .maybeSingle();
  if (billErr) return { ok: false, totalCollected, error: billErr.message };
  if (!bill) return { ok: false, totalCollected, error: "Bill not found" };

  const currentBalance = Number((bill as any).balance_due) || 0;
  if (currentBalance <= 0) {
    return { ok: false, totalCollected, error: "This bill is already fully paid — nothing left to collect." };
  }
  if (totalCollected > currentBalance + 0.01) {
    return {
      ok: false,
      totalCollected,
      error: `Amount exceeds the balance due (₹${currentBalance.toLocaleString("en-IN")}).`,
    };
  }

  // Bills dated on a locked cash-closure day are frozen: collecting against them
  // is refused until the day is reopened (Billing → Day Closure → Reopen Day).
  // An open admission's draft bill is exempt — it keeps its admission-day date
  // for the whole stay, so the patient would otherwise become uncollectable the
  // moment the admission day closes. See src/lib/lockedDay.ts.
  const lockError = await checkBillWritable(opts.hospitalId, {
    billDate: (bill as any).bill_date ?? null,
    billStatus: (bill as any).bill_status ?? null,
    admissionId: (bill as any).admission_id ?? null,
  });
  if (lockError) return { ok: false, totalCollected, error: lockError };

  for (const row of rows) {
    const { error } = await supabase.from("bill_payments").insert({
      hospital_id: opts.hospitalId,
      bill_id: opts.billId,
      payment_mode: row.mode,
      amount: row.amount,
      transaction_id: row.reference || null,
      received_by: opts.collectedBy,
    });
    if (error) return { ok: false, totalCollected, error: error.message };
  }

  for (const row of rows) {
    await autoPostJournalEntry({
      triggerEvent: `bill_payment_${row.mode}`,
      sourceModule: "billing",
      sourceId: opts.billId,
      amount: row.amount,
      description: `Payment - Bill ${opts.billNumber} - ${row.mode}`,
      hospitalId: opts.hospitalId,
      postedBy: opts.collectedBy || "",
    });
  }

  const { error: updateError } = await supabase
    .from("bills")
    .update({
      paid_amount: opts.newPaidAmount,
      balance_due: opts.newBalanceDue,
      payment_status: opts.newPaymentStatus,
    })
    .eq("id", opts.billId);
  if (updateError) return { ok: false, totalCollected, error: updateError.message };

  if (opts.newPaymentStatus === "paid" && opts.admissionId) {
    await supabase.from("admissions").update({ billing_cleared: true }).eq("id", opts.admissionId);
  }

  // A health package's lab/radiology orders are created at booking but held as "unbilled", so
  // neither worklist shows them while the package is unpaid. Settling the bill is what puts the
  // tests in front of the lab and the studies in front of the radiographer.
  //
  // Deliberately after the bills update and never fatal: the money has already been taken, so a
  // failure here must not fail the payment. releasePackageOrders swallows its own errors and is
  // idempotent, so a retry or a later payment still releases them.
  if (opts.newPaymentStatus === "paid") {
    const released = await releasePackageOrders(opts.billId);
    if (released.lab > 0 || released.radiology > 0) {
      console.info(
        `Package paid — released ${released.lab} lab and ${released.radiology} radiology order(s) to the worklists.`
      );
    }
  }

  if (opts.sendReceipt && opts.patientId) {
    const { data: patient } = await supabase
      .from("patients")
      .select("phone, full_name")
      .eq("id", opts.patientId)
      .maybeSingle();
    if (patient?.phone) {
      const receiptMsg = `✅ Payment Received\n\nPatient: ${patient.full_name}\nBill #: ${opts.billNumber}\nAmount Paid: ₹${totalCollected.toLocaleString("en-IN")}\nMode: ${rows.map((r) => r.mode).join(", ").toUpperCase()}\nDate: ${new Date().toLocaleDateString("en-IN")}\nBalance: ₹${opts.newBalanceDue.toLocaleString("en-IN")}\n\nThank you!`;
      const cleanPhone = patient.phone.replace(/\D/g, "");
      const fullPhone = cleanPhone.startsWith("91") ? cleanPhone : `91${cleanPhone}`;
      await sendWhatsApp({ hospitalId: opts.hospitalId, phone: fullPhone, message: receiptMsg });
    }
  }

  logAudit({
    action: "created",
    module: "billing",
    entityType: "payment",
    entityId: opts.billId,
    details: { amount: totalCollected, modes: rows.map((r) => r.mode) },
  });

  return { ok: true, totalCollected };
}

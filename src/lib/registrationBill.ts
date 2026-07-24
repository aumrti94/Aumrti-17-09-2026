import { supabase } from "@/integrations/supabase/client";
import { getRateWithGst, SERVICE_RATE_CODES } from "@/lib/serviceRates";
import { roundCurrency } from "@/lib/currency";
import { recordServiceCharge } from "@/lib/serviceBilling";
import { recordBillPayment } from "@/lib/billPayments";

/**
 * Optional per-hospital patient registration fee.
 *
 * The amount is configured in Settings → Services & Fees → Default Rates under the
 * `registration_fee` code (see SERVICE_RATE_CODES.REGISTRATION_FEE). A rate of 0 —
 * the seeded default — means the hospital does not charge a registration fee, so the
 * fee step is skipped entirely. Hospitals that charge set a non-zero amount.
 *
 * When collected, it is posted as an ordinary `bills` row with bill_type
 * 'registration' (REG-YYYYMMDD-#### series, see migration 20261009000172), reusing
 * the same bills / bill_line_items / bill_payments path every other fee uses.
 */

/** Resolve the configured registration fee + GST% for a hospital. Returns 0/0 when unset. */
export async function getRegistrationFee(
  hospitalId: string,
): Promise<{ rate: number; gst: number }> {
  return getRateWithGst(hospitalId, SERVICE_RATE_CODES.REGISTRATION_FEE, 0, 0);
}

export interface CreateRegistrationBillOpts {
  hospitalId: string;
  patientId: string;
  /** GST-inclusive fee shown to the front desk (from getRegistrationFee). */
  amount: number;
  gstPercent: number;
  mode: string; // cash | upi | card
  reference?: string | null;
  collectedBy: string | null;
}

export interface RegistrationBillResult {
  ok: boolean;
  billNumber?: string;
  error?: string;
}

/**
 * Create a paid registration-fee bill and record the payment.
 * The fee is treated as GST-inclusive (matches the OPD consultation flow).
 */
export async function createAndPayRegistrationBill(
  opts: CreateRegistrationBillOpts,
): Promise<RegistrationBillResult> {
  const fee = roundCurrency(opts.amount);
  if (fee <= 0) return { ok: false, error: "Registration fee is not configured." };

  const gstPct = opts.gstPercent > 0 ? opts.gstPercent : 0;
  const taxable = gstPct > 0 ? roundCurrency(fee / (1 + gstPct / 100)) : fee;
  const gstAmt = roundCurrency(fee - taxable);
  const today = new Date().toISOString().split("T")[0];

  // Create the bill. bill_number is omitted: the bills BEFORE INSERT trigger
  // (migration 20261008000161) mints it inside this transaction, so a failed
  // insert cannot burn a number. bill_type 'registration' puts it on the REG series.
  const { data: bill, error: billErr } = await supabase
    .from("bills")
    .insert({
      hospital_id: opts.hospitalId,
      patient_id: opts.patientId,
      bill_type: "registration",
      bill_date: today,
      subtotal: taxable,
      gst_amount: gstAmt,
      total_amount: fee,
      patient_payable: fee,
      paid_amount: 0,
      balance_due: fee,
      payment_status: "unpaid",
      bill_status: "final",
      created_by: opts.collectedBy,
    } as any)
    .select("id, bill_number")
    .maybeSingle();
  if (billErr) return { ok: false, error: billErr.message };
  if (!bill) return { ok: false, error: "Could not create registration bill." };
  const billNumber = (bill as any).bill_number as string;

  await supabase.from("bill_line_items").insert({
    hospital_id: opts.hospitalId,
    bill_id: (bill as any).id,
    description: "Registration Fee",
    item_type: "registration",
    unit_rate: fee,
    quantity: 1,
    taxable_amount: taxable,
    gst_percent: gstPct,
    gst_amount: gstAmt,
    total_amount: fee,
    source_module: "patient_registration",
    source_dedupe_key: `reg_fee:${(bill as any).id}`,
  } as any);

  // Mirror into service_charges for reporting parity (never throws).
  recordServiceCharge({
    hospitalId: opts.hospitalId,
    patientId: opts.patientId,
    serviceModule: "patient_registration",
    serviceName: "Registration Fee",
    unitRate: fee,
    gstPercent: gstPct,
    gstAmount: gstAmt,
    totalAmount: fee,
    billId: (bill as any).id,
    performedBy: opts.collectedBy || undefined,
  });

  // Record the payment through the single canonical writer:
  // bill_payments row + GL posting + bills paid/balance/status update + audit.
  const pay = await recordBillPayment({
    hospitalId: opts.hospitalId,
    billId: (bill as any).id,
    billNumber,
    patientId: opts.patientId,
    rows: [{ mode: opts.mode, amount: fee, reference: opts.reference || null }],
    collectedBy: opts.collectedBy,
    newPaidAmount: fee,
    newBalanceDue: 0,
    newPaymentStatus: "paid",
  });
  if (!pay.ok) return { ok: false, billNumber, error: pay.error };

  return { ok: true, billNumber };
}

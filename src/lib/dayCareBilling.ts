/**
 * dayCareBilling — posts the day care procedure charges onto the admission's bill.
 *
 * This is the piece that was missing entirely: day_care_procedures.standard_rate was read
 * only by the Settings CRUD page and as a display string in the admission modal, and never
 * written to bill_line_items. The rate was configured, shown at booking, ticked off as
 * "cleared" at discharge — and never turned into money.
 *
 * A booking now carries N procedures (migration 20261008000158), so this posts ONE LINE ITEM
 * PER PROCEDURE rather than one per admission. Separate lines, not a merged total: the
 * patient's bill has to name what they were charged for, insurers itemise per procedure, and
 * a single blended line cannot be partially disputed or refunded.
 *
 * Deliberately a thin wrapper over autoChargeService (the canonical path for 18 modules)
 * rather than a bespoke insert: it already resolves/creates the bill via
 * findOrCreateAdmissionBill, inserts the line item, recalculates totals, records into
 * service_charges for the leakage dashboard, and posts the GL entry.
 */

import {
  MODULE_DAY_CARE,
  ServiceBillingResult,
  autoChargeService,
} from "@/lib/serviceBilling";
import { DayCareProcedureSelection, normalizeQuantity } from "@/lib/dayCareProcedures";

export interface ChargeDayCareProceduresOpts {
  hospitalId: string;
  patientId: string;
  admissionId: string;
  procedures: DayCareProcedureSelection[];
  performedBy?: string | null;
  /** YYYY-MM-DD. Defaults to today — the date of supply, which is the GST invoice date. */
  serviceDate?: string;
}

/**
 * Charge every procedure on the booking.
 *
 * Sequential, not Promise.all: the first call creates the admission's bill, and concurrent
 * calls would each race findOrCreateAdmissionBill and split one booking across two bills.
 *
 * A failure mid-way is NOT swallowed — it rethrows, and the caller warns. Earlier lines stay
 * posted (they are real charges, correctly on the bill); the operator finishes the rest in
 * Billing. Rolling them back would be the worse outcome: silently unbilled work.
 */
export async function chargeDayCareProcedures(
  opts: ChargeDayCareProceduresOpts
): Promise<ServiceBillingResult[]> {
  const { hospitalId, patientId, admissionId, procedures, performedBy, serviceDate } = opts;

  const results: ServiceBillingResult[] = [];
  for (const procedure of procedures) {
    const result = await autoChargeService({
      hospitalId,
      patientId,
      admissionId,
      serviceName: `Day Care: ${procedure.procedureName}`,
      serviceModule: MODULE_DAY_CARE,
      quantity: normalizeQuantity(procedure.quantity),
      // Pass the rate explicitly so autoChargeService skips its service_master name-match
      // lookup, which would return 0 for anything but an exact first-word hit. A rate of 0
      // falls through to the unbilled path — correct: it surfaces on the leakage dashboard
      // rather than silently billing ₹0. This is the rate frozen at booking, not a fresh
      // read of the price master — the patient pays what they were quoted.
      unitRate: Number(procedure.rate) || 0,
      // A healthcare procedure is GST-exempt (Notification 12/2017-CT(Rate)); GST here is law,
      // not hospital-configurable pricing. Matches the item_type='procedure' mirror written by
      // 20261008000139.
      gstPercent: 0,
      performedBy,
      serviceDate,
      // NO sourceTable/sourceId: day_care_procedures is a price MASTER, not a per-patient
      // service record. Marking it billed would poison it for every other patient.
      // Idempotency comes from admissions.day_care_billed_at instead — see markDayCareBilled.
    });
    if (result) results.push(result);
  }
  return results;
}

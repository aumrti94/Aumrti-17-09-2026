/**
 * dayCareBilling — posts the day care procedure charge onto the admission's bill.
 *
 * This is the piece that was missing entirely: day_care_procedures.standard_rate was read
 * only by the Settings CRUD page and as a display string in the admission modal, and never
 * written to bill_line_items. The rate was configured, shown at booking, ticked off as
 * "cleared" at discharge — and never turned into money.
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

export interface ChargeDayCareProcedureOpts {
  hospitalId: string;
  patientId: string;
  admissionId: string;
  procedure: { id: string; procedure_name: string; standard_rate: number };
  performedBy?: string | null;
  /** YYYY-MM-DD. Defaults to today — the date of supply, which is the GST invoice date. */
  serviceDate?: string;
}

export async function chargeDayCareProcedure(
  opts: ChargeDayCareProcedureOpts
): Promise<ServiceBillingResult | null> {
  const { hospitalId, patientId, admissionId, procedure, performedBy, serviceDate } = opts;

  return autoChargeService({
    hospitalId,
    patientId,
    admissionId,
    serviceName: `Day Care: ${procedure.procedure_name}`,
    serviceModule: MODULE_DAY_CARE,
    quantity: 1,
    // Pass the rate explicitly so autoChargeService skips its service_master name-match
    // lookup, which would return 0 for anything but an exact first-word hit. A rate of 0
    // falls through to the unbilled path — correct: it surfaces on the leakage dashboard
    // rather than silently billing ₹0.
    unitRate: Number(procedure.standard_rate) || 0,
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
}

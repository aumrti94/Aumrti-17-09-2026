/**
 * Revenue leakage scan — the decision half, extracted from the Deno wrapper.
 *
 * WHY. `scanHospital` lived entirely inside
 * `supabase/functions/daily-leakage-scan/index.ts`, a Deno edge function. Business logic
 * trapped in a Deno wrapper cannot be unit tested from this project at all — no vitest run
 * can import it — so the grace windows, the fallback rates and the OT billed-check had never
 * been asserted, despite the function already carrying two comments about defects that
 * reached production there (a stale `source_module='surgery'` filter that flagged every
 * completed OT case as leakage, and undefined top-level counts that made every scan report
 * "0 items across 0 modules").
 *
 * The split follows the house precedent from `billTotals.ts`: queries stay in the caller,
 * the maths moves here. The edge function fetches rows and calls `buildLeakageReport`; a
 * future "scan now" path in the UI can fetch the same rows and call the same function, which
 * is what makes the two paths *provably* identical rather than intended to be.
 */

export type LeakageCategory = "lab" | "radiology" | "pharmacy" | "ot";

export interface LeakageItem {
  category: LeakageCategory;
  description: string;
  entity_id: string;
  estimated_amount: number;
}

export interface LeakageReport {
  items: LeakageItem[];
  lab_count: number;
  radiology_count: number;
  pharmacy_count: number;
  ot_count: number;
  total_items: number;
  estimated_amount: number;
}

/**
 * Fallback rates used when the source row carries no price of its own.
 *
 * These are estimates for an alert, never a billed amount — nothing in this file writes a
 * bill line. The figure exists so a CFO sees "~₹47,000 at risk" rather than "17 items".
 */
export const LAB_FALLBACK_RATE = 200;
export const RAD_FALLBACK_RATE = 500;
export const OT_FALLBACK_RATE = 15000;

/**
 * Grace windows. A service is not leakage the moment it is performed — billing legitimately
 * lags the ward. Lab, radiology and pharmacy get 12 hours; an OT case gets 24, because its
 * billing depends on the surgeon's notes and the implant list.
 */
export const ANCILLARY_GRACE_HOURS = 12;
export const OT_GRACE_HOURS = 24;

export interface LeakageCutoffs {
  /** Anything created before this is past its grace window. */
  ancillary: string;
  ot: string;
}

/**
 * Cutoff timestamps for a given "now".
 *
 * Takes `now` rather than reading the clock so the boundary is testable. The edge function
 * computed these inline from `Date.now()`, which is why 11h59m vs 12h01m had never been
 * asserted — there was no way to ask the question without waiting twelve hours.
 */
export function leakageCutoffs(now: Date | number = Date.now()): LeakageCutoffs {
  const ms = typeof now === "number" ? now : now.getTime();
  return {
    ancillary: new Date(ms - ANCILLARY_GRACE_HOURS * 60 * 60 * 1000).toISOString(),
    ot: new Date(ms - OT_GRACE_HOURS * 60 * 60 * 1000).toISOString(),
  };
}

/**
 * True when a timestamp is old enough to count as leakage.
 *
 * Strictly older than the cutoff — a service exactly at the boundary is still inside its
 * grace window. Matches the `.lt()` the queries use, so the client-side and query-side
 * answers cannot drift.
 */
export function isPastGraceWindow(createdAt: string | null | undefined, cutoff: string): boolean {
  if (!createdAt) return false;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return false;
  return t < Date.parse(cutoff);
}

// ── Row shapes, as fetched ───────────────────────────────────────────────────

export interface LabOrderRow {
  id: string;
  created_at?: string | null;
}

export interface RadiologyOrderRow {
  id: string;
  study_name?: string | null;
  created_at?: string | null;
}

export interface PharmacyDispenseRow {
  id: string;
  pharmacy_dispensing_items?:
    | { drug_name?: string | null; unit_price?: number | string | null; quantity_dispensed?: number | string | null }[]
    | null;
}

export interface OtCaseRow {
  id: string;
  surgery_name?: string | null;
  admission_id?: string | null;
}

export interface LeakageScanInput {
  labOrders?: LabOrderRow[] | null;
  radiologyOrders?: RadiologyOrderRow[] | null;
  pharmacyDispenses?: PharmacyDispenseRow[] | null;
  otCases?: OtCaseRow[] | null;
  /** Admission ids that already carry an OT bill line. */
  billedOtAdmissionIds?: Iterable<string> | null;
  /** Overridable so a hospital's configured OT rate can replace the fallback. */
  otRate?: number;
}

/**
 * Coerce a fetched value, falling back when it is ABSENT as well as when it is unparseable.
 *
 * `Number(null)` is 0, which is finite — so a `Number.isFinite` guard alone silently accepts
 * a missing quantity as zero and prices the whole dispense at ₹0, hiding it from the report
 * that exists to surface it.
 */
const num = (v: unknown, fallback = 0): number => {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Which admissions already have OT billing.
 *
 * The edge function carries a comment about this exact logic: it filtered
 * `source_module = 'surgery'`, a value the real OT billing path
 * (`serviceBilling.chargeOTCase`) never writes — it writes `'ot'`. Nothing matched, so
 * **every completed OT case was reported as leakage regardless of its actual billing
 * status**, which is a scanner that cries wolf until it is ignored.
 */
export const OT_BILLING_SOURCE_MODULE = "ot";

export function billedOtAdmissions(
  otLineItems: { bill_id?: string | null; source_module?: string | null }[] | null | undefined,
  billIdToAdmission: Map<string, string> | Record<string, string>,
): Set<string> {
  const lookup =
    billIdToAdmission instanceof Map ? billIdToAdmission : new Map(Object.entries(billIdToAdmission ?? {}));
  const out = new Set<string>();
  for (const li of otLineItems ?? []) {
    if (!li?.bill_id) continue;
    // Guard the source_module here too rather than relying on the query's filter alone —
    // the query filter is what silently went stale.
    if (li.source_module && li.source_module !== OT_BILLING_SOURCE_MODULE) continue;
    const admissionId = lookup.get(li.bill_id);
    if (admissionId) out.add(admissionId);
  }
  return out;
}

/** Turn fetched rows into the leakage report. Pure — no clock, no queries. */
export function buildLeakageReport(input: LeakageScanInput): LeakageReport {
  const items: LeakageItem[] = [];

  for (const lo of input.labOrders ?? []) {
    if (!lo?.id) continue;
    items.push({
      category: "lab",
      description: "Lab Order — unbilled",
      entity_id: lo.id,
      estimated_amount: LAB_FALLBACK_RATE,
    });
  }

  for (const ro of input.radiologyOrders ?? []) {
    if (!ro?.id) continue;
    items.push({
      category: "radiology",
      description: `Radiology: ${ro.study_name || "Study"}`,
      entity_id: ro.id,
      estimated_amount: RAD_FALLBACK_RATE,
    });
  }

  for (const pd of input.pharmacyDispenses ?? []) {
    if (!pd?.id) continue;
    for (const di of pd.pharmacy_dispensing_items ?? []) {
      items.push({
        category: "pharmacy",
        description: `Pharmacy IP: ${di?.drug_name || "Drug"}`,
        entity_id: pd.id,
        // Quantity defaults to 1, not 0: a dispense with no recorded quantity is a data
        // problem, and estimating it at ₹0 would hide it from the very report meant to
        // surface it.
        estimated_amount: num(di?.unit_price, 0) * num(di?.quantity_dispensed, 1),
      });
    }
  }

  const billedAdmissions = new Set(input.billedOtAdmissionIds ?? []);
  const otRate = input.otRate ?? OT_FALLBACK_RATE;

  for (const ot of input.otCases ?? []) {
    if (!ot?.id) continue;
    if (ot.admission_id && billedAdmissions.has(ot.admission_id)) continue;
    items.push({
      category: "ot",
      description: `OT: ${ot.surgery_name || "Surgery"}`,
      entity_id: ot.id,
      estimated_amount: otRate,
    });
  }

  const count = (c: LeakageCategory) => items.filter((i) => i.category === c).length;

  return {
    items,
    lab_count: count("lab"),
    radiology_count: count("radiology"),
    pharmacy_count: count("pharmacy"),
    ot_count: count("ot"),
    total_items: items.length,
    estimated_amount: items.reduce((s, i) => s + i.estimated_amount, 0),
  };
}

/**
 * How many modules are leaking. Drives the "N modules" figure in the alert and the toast.
 *
 * The edge function used to return `undefined` for this at the top level, so a successful
 * scan always reported "Found 0 unbilled items across 0 modules" — indistinguishable from a
 * clean scan, which is the defect shape this whole plan is organised around.
 */
export function modulesWithLeaks(report: LeakageReport): number {
  return [report.lab_count, report.radiology_count, report.pharmacy_count, report.ot_count].filter((c) => c > 0)
    .length;
}

/** Severity for the raised `clinical_alerts` row. */
export function leakageSeverity(estimatedAmount: number): "critical" | "high" {
  return estimatedAmount >= 50000 ? "critical" : "high";
}

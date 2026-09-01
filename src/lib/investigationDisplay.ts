/**
 * Shared presentation rules for investigation results (lab + radiology).
 *
 * These maps and predicates were duplicated in IPD's InvestigationsTab, PatientTimelineDrawer
 * and several components under src/components/lab. Duplicating them meant the same CH flag
 * could render red in one screen and plain in another — for a critical value that is a
 * patient-safety inconsistency, not a cosmetic one. Single source of truth lives here.
 */

/** result_flag values written by LabResultWorkspace.calcFlag. */
export type ResultFlag = "N" | "H" | "L" | "CH" | "CL" | "A";

export const FLAG_STYLE: Record<string, string> = {
  H: "text-amber-700 font-semibold",
  L: "text-blue-700 font-semibold",
  CH: "text-red-700 font-bold",
  CL: "text-indigo-700 font-bold",
  A: "text-purple-700 font-semibold",
};

export const FLAG_LABEL: Record<string, string> = {
  H: "↑ H",
  L: "↓ L",
  CH: "↑↑ Critical",
  CL: "↓↓ Critical",
  A: "Abnormal",
};

/** A critical value the doctor must not be allowed to skim past. */
export function isCriticalFlag(flag: string | null | undefined): boolean {
  return flag === "CH" || flag === "CL";
}

export function isAbnormalFlag(flag: string | null | undefined): boolean {
  return !!flag && flag !== "N";
}

/* ── "Is this result actually readable by the doctor yet?" ──
   Deliberately strict: a result is only shown as available once the lab or the radiologist
   has released it. A half-entered value that has not been validated must still read as
   pending, or a doctor could act on a number nobody has signed off. */

/** lab_order_items.status values that mean a released, readable result. */
export const LAB_RELEASED_ITEM_STATUSES = ["reported", "validated"];

/** lab_orders.status values that mean the whole order has been released. */
export const LAB_RELEASED_ORDER_STATUSES = ["completed"];

/** radiology_orders.status values that mean a report exists to read. */
export const RAD_DONE_STATUSES = ["reported", "validated"];

/** pathology_cases.status values that mean the case has been signed out. */
export const PATHOLOGY_RELEASED_STATUSES = ["signed_off", "amended"];

/** external_lab_referrals.status meaning the outside lab's report has come back. */
export const EXTERNAL_RELEASED_STATUSES = ["completed"];

export function isLabItemReleased(item: { status?: string | null }): boolean {
  return LAB_RELEASED_ITEM_STATUSES.includes(item.status || "");
}

export function isLabOrderReleased(order: { status?: string | null }): boolean {
  return LAB_RELEASED_ORDER_STATUSES.includes(order.status || "");
}

export function isRadReportReleased(
  order: { status?: string | null },
  report?: { is_signed?: boolean | null } | null,
): boolean {
  return RAD_DONE_STATUSES.includes(order.status || "") || !!report?.is_signed;
}

export function isPathologyReleased(kase: { status?: string | null }): boolean {
  return PATHOLOGY_RELEASED_STATUSES.includes(kase.status || "");
}

export function isExternalReportReceived(
  referral: { status?: string | null; report_received_at?: string | null },
): boolean {
  return !!referral.report_received_at || EXTERNAL_RELEASED_STATUSES.includes(referral.status || "");
}

/** A pathology case re-issued after sign-off — the doctor must read it again. */
export function isAmended(kase: { status?: string | null }): boolean {
  return kase.status === "amended";
}

/* ── Formatting ── */

/** DD/MM/YYYY-style Indian date, matching the rest of the clinical screens. */
export function formatIndianDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatIndianDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "in progress" / "sample collected" — statuses are snake_case in the DB. */
export function humaniseStatus(status: string | null | undefined): string {
  return (status || "—").replace(/_/g, " ");
}

/**
 * Group an array by a derived key, preserving insertion order of the keys.
 * Used to group lab items by category so an ordered profile reads as one block
 * rather than a dozen loose rows.
 */
export function groupBy<T>(rows: T[], keyOf: (row: T) => string): Record<string, T[]> {
  return rows.reduce<Record<string, T[]>>((acc, row) => {
    const k = keyOf(row);
    (acc[k] ||= []).push(row);
    return acc;
  }, {});
}

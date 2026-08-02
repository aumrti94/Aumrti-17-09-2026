/**
 * Payer classifications used across admission billing.
 *
 * These are `admissions.payer_type` values. The lists live here rather than inline at
 * each call site so a new scheme is added in one place — the pre-auth prompt and the
 * nursing-charge rule were already drifting apart on which spellings they recognised.
 */

/**
 * Payers whose claims go through a TPA/scheme and therefore need a pre-authorization.
 * Kept exactly as it was when inlined in IPDWorkspace so hoisting it changes no behaviour.
 */
export const INSURANCE_PAYER_TYPES = [
  "tpa", "pmjay", "cghs", "esi", "state_scheme", "corporate",
];

/**
 * Payers under which nursing care is BUNDLED INTO ROOM RENT and must not appear as a
 * separate line on the bill.
 *
 * CGHS 2025 Annexure-III: "Nursing care charges are bundled in the ward charges and
 * therefore not payable separately or billable to the patient" — room rent is defined as
 * a consolidated charge that includes duty medical officer and nursing care, and ICU is
 * an inclusive package where "no additional charges are permissible for items included
 * in ICU care". IRDAI's standard non-payable list says the same from the insurer side:
 * private/special nursing is non-payable, and a service charge that also covers nursing
 * is treated as part of room charge.
 *
 * Billing nursing separately to these payers does not earn revenue — the TPA deducts it,
 * leaving a write-off or a patient dispute. So the daily nursing accrual is suppressed
 * for them. (Special/private-duty nursing, added manually, is a genuine cash item and is
 * NOT suppressed — it is simply not claimable.)
 *
 * Both `esi`/`esic` and `cghs`/`echs` spellings are listed because existing data uses a
 * mix: the pre-auth check wrote "esi", while BillEditor's finalize check reads the
 * patient_category values "cghs"/"echs".
 */
export const BUNDLED_NURSING_PAYER_TYPES = new Set([
  "tpa", "insurance", "pmjay", "cghs", "echs", "esi", "esic", "state_scheme", "corporate",
]);

/** True when this payer bundles nursing into the room rent. Null/cash/self-pay → false. */
export function bundlesNursingIntoRoom(payerType: string | null | undefined): boolean {
  if (!payerType) return false;
  return BUNDLED_NURSING_PAYER_TYPES.has(payerType.trim().toLowerCase());
}

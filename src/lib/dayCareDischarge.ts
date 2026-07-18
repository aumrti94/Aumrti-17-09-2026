/**
 * dayCareDischarge — is this day care stay financially dischargeable?
 *
 * Replaces DayCareDischargeModal's "Bill finalised and payment cleared" checklist item,
 * which was a self-attestation: a user could tick it on a bill that did not exist, and
 * nothing ever queried `bills`.
 */

export interface DayCareBillSnapshot {
  bill_status: string | null;
  payment_status: string | null;
  balance_due: number | null;
}

export interface DayCareDischargeReadiness {
  billExists: boolean;
  paymentCleared: boolean;
  /** Human-readable blockers. Empty = financially fit to discharge. */
  blocking: string[];
}

/** Payers that settle after discharge, so a balance at the door is expected and fine. */
const PAYER_SETTLED_LATER = ["insurance", "pmjay", "cghs", "echs"];

/**
 * PURE.
 *
 * A payer-covered stay legitimately leaves with a balance outstanding — the TPA settles the
 * claim later, and holding the patient would be wrong. Only self-pay must be square at the
 * door, because after they walk out there is no way to collect.
 */
export function evaluateDayCareDischargeReadiness(
  bill: DayCareBillSnapshot | null,
  payerType: string
): DayCareDischargeReadiness {
  const blocking: string[] = [];

  if (!bill) {
    return {
      billExists: false,
      paymentCleared: false,
      blocking: ["No bill has been raised for this procedure."],
    };
  }

  const payer = (payerType || "self_pay").toLowerCase();
  const settlesLater = PAYER_SETTLED_LATER.includes(payer);

  // Clamp: an over-collected bill (negative balance) is not an amount owing.
  const rawBalance = Number(bill.balance_due);
  const balance = Number.isFinite(rawBalance) ? Math.max(0, rawBalance) : 0;

  const paymentCleared = settlesLater || balance <= 0;

  if (!paymentCleared) {
    blocking.push(`₹${Math.round(balance).toLocaleString("en-IN")} is still due from the patient.`);
  }

  return { billExists: true, paymentCleared, blocking };
}

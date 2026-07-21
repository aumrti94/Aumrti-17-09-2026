/**
 * depositHoldings — money already collected against a booking that has no bill yet.
 *
 * A day care patient pays the full deposit at booking, but the bill is only created when
 * they are admitted (that is when the procedure is actually delivered). Between those two
 * moments the cash is real and in the till, yet Billing → Bills read "0 bills, ₹0 collected"
 * because it only ever queried `bills`. The money was visible in Day Closure and nowhere
 * else, so the two screens disagreed about the same day's takings.
 *
 * This surfaces those advances as rows in the bill queue. They are NOT bills — they are
 * labelled as deposits and cannot be opened or edited — they exist so that collected cash is
 * never invisible on the screen whose job is to account for it.
 *
 * DOUBLE-COUNTING is the whole risk here. On admission the bill is created AND the advance
 * is mirrored into bill_payments, so the same ₹51,500 would then be counted twice: once via
 * the bill's paid_amount and once via this holding. `admissionsWithBills` is the guard — a
 * booking drops out of this list the instant a bill exists for it.
 */

/** Net advance balance per admission, read from the ipd_advance_balances VIEW. */
export type AdvanceBalanceMap = Map<string, number>;

/**
 * A raw ipd_advances row. Used ONLY for when/how the money came in — never to compute the
 * balance. The balance has exactly one definition (the ipd_advance_balances view) and
 * re-implementing its netting here is how the two would silently drift apart.
 */
export interface AdvanceEvent {
  admission_id: string;
  transaction_type: string;
  payment_mode: string | null;
  created_at: string;
}

export interface DepositBooking {
  admissionId: string;
  admissionNumber: string;
  patientId: string;
  patientName: string;
  uhid: string;
  /** "Catrat, Endoscopy" — what the deposit is against. */
  procedureLabel: string;
  /** Agreed estimate for the booking; 0 when counselling recorded none. */
  estimate: number;
  /** IST date the procedure is booked for. */
  scheduledDate: string;
}

export interface DepositHolding extends DepositBooking {
  /** Net ₹ held. Always > 0 — a zero or refunded-out booking is not a holding. */
  collected: number;
  /** Still to collect against the estimate. 0 when fully deposited or no estimate. */
  outstanding: number;
  /** YYYY-MM-DD the most recent deposit came in — the date this money belongs to. */
  collectedOn: string;
  /** Distinct tender types seen, e.g. ["upi"]. */
  paymentModes: string[];
}

/** Coerce to a finite non-negative number. */
function money(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** IST calendar date of a timestamp — day closure and cash books run on IST, not UTC. */
export function istDate(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * PURE. Build the holdings to show in the bill queue.
 *
 * A booking qualifies only if ALL of these hold:
 *   - it has no bill yet (else the bill already accounts for the money)
 *   - its net advance balance is > 0 (a fully refunded booking holds nothing)
 *   - it received a deposit inside the requested date window
 */
export function buildDepositHoldings(input: {
  bookings: DepositBooking[];
  balances: AdvanceBalanceMap;
  advances: AdvanceEvent[];
  admissionsWithBills: Set<string>;
  /** Inclusive YYYY-MM-DD window on the COLLECTION date. Omit for no date filter. */
  from?: string;
  to?: string;
}): DepositHolding[] {
  const { bookings, balances, advances, admissionsWithBills, from, to } = input;

  // Deposits only: a refund is money leaving, and dating a holding by a refund would file
  // today's row under the day the money went back out.
  const deposits = advances.filter(a => a.transaction_type === "deposit");

  const byAdmission = new Map<string, AdvanceEvent[]>();
  for (const d of deposits) {
    const list = byAdmission.get(d.admission_id);
    if (list) list.push(d);
    else byAdmission.set(d.admission_id, [d]);
  }

  const holdings: DepositHolding[] = [];

  for (const booking of bookings) {
    if (admissionsWithBills.has(booking.admissionId)) continue;

    const collected = money(balances.get(booking.admissionId));
    if (collected <= 0) continue;

    const events = byAdmission.get(booking.admissionId) || [];
    const dates = events.map(e => istDate(e.created_at)).filter(Boolean).sort();
    if (dates.length === 0) continue;

    const collectedOn = dates[dates.length - 1];
    if (from && collectedOn < from) continue;
    if (to && collectedOn > to) continue;

    holdings.push({
      ...booking,
      collected,
      outstanding: Math.max(0, money(booking.estimate) - collected),
      collectedOn,
      paymentModes: [...new Set(events.map(e => e.payment_mode || "cash"))],
    });
  }

  // Newest money first, matching how the bill list is ordered.
  return holdings.sort((a, b) => b.collectedOn.localeCompare(a.collectedOn));
}

/** PURE. Total cash held across all holdings — added to the queue's "collected" figure. */
export function totalHeld(holdings: DepositHolding[]): number {
  return holdings.reduce((sum, h) => sum + money(h.collected), 0);
}

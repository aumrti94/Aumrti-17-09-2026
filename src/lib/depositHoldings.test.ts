import { describe, it, expect } from "vitest";
import {
  AdvanceEvent,
  DepositBooking,
  buildDepositHoldings,
  istDate,
  totalHeld,
} from "./depositHoldings";

const booking: DepositBooking = {
  admissionId: "a1",
  admissionNumber: "DC-20260721-0003",
  patientId: "pt1",
  patientName: "Yeswanth",
  uhid: "UHID-20260622-0001",
  procedureLabel: "Catrat, Endoscopy",
  estimate: 51500,
  scheduledDate: "2026-07-21",
};

/** 11:22 IST on 21 Jul 2026. */
const depositEvent: AdvanceEvent = {
  admission_id: "a1",
  transaction_type: "deposit",
  payment_mode: "upi",
  created_at: "2026-07-21T05:52:45.880Z",
};

const base = {
  bookings: [booking],
  balances: new Map([["a1", 51500]]),
  advances: [depositEvent],
  admissionsWithBills: new Set<string>(),
};

describe("istDate", () => {
  it("uses IST, not UTC — a late-evening deposit belongs to that IST day", () => {
    // 19:00 UTC on 20 Jul = 00:30 IST on 21 Jul.
    expect(istDate("2026-07-20T19:00:00Z")).toBe("2026-07-21");
  });
  it("returns empty for junk rather than throwing in the middle of the bill queue", () => {
    expect(istDate("not-a-date")).toBe("");
  });
});

describe("buildDepositHoldings", () => {
  it("surfaces a deposit collected against a booking with no bill", () => {
    const [held] = buildDepositHoldings(base);
    expect(held.collected).toBe(51500);
    expect(held.outstanding).toBe(0);
    expect(held.collectedOn).toBe("2026-07-21");
    expect(held.paymentModes).toEqual(["upi"]);
  });

  it("DROPS the booking once a bill exists — otherwise the same money is counted twice", () => {
    expect(buildDepositHoldings({
      ...base,
      admissionsWithBills: new Set(["a1"]),
    })).toEqual([]);
  });

  it("drops a booking whose deposit was fully refunded back out", () => {
    expect(buildDepositHoldings({
      ...base,
      balances: new Map([["a1", 0]]),
    })).toEqual([]);
  });

  it("never shows a negative holding as money in hand", () => {
    expect(buildDepositHoldings({
      ...base,
      balances: new Map([["a1", -500]]),
    })).toEqual([]);
  });

  it("reports the shortfall when only part of the estimate was collected", () => {
    const [held] = buildDepositHoldings({ ...base, balances: new Map([["a1", 20000]]) });
    expect(held.collected).toBe(20000);
    expect(held.outstanding).toBe(31500);
  });

  it("shows no shortfall when no estimate was recorded", () => {
    const [held] = buildDepositHoldings({
      ...base,
      bookings: [{ ...booking, estimate: 0 }],
    });
    expect(held.outstanding).toBe(0);
  });

  it("takes the balance from the view, NOT by re-adding the advance rows", () => {
    // Two deposit events but a view balance that already nets a refund out.
    const [held] = buildDepositHoldings({
      ...base,
      advances: [depositEvent, { ...depositEvent, created_at: "2026-07-21T06:00:00Z" }],
      balances: new Map([["a1", 30000]]),
    });
    expect(held.collected).toBe(30000);
  });

  it("dates the holding by the LATEST deposit", () => {
    const [held] = buildDepositHoldings({
      ...base,
      advances: [
        { ...depositEvent, created_at: "2026-07-19T05:00:00Z" },
        { ...depositEvent, created_at: "2026-07-21T05:00:00Z" },
      ],
    });
    expect(held.collectedOn).toBe("2026-07-21");
  });

  it("ignores refund rows when dating the holding — money out is not a collection date", () => {
    const [held] = buildDepositHoldings({
      ...base,
      advances: [
        depositEvent,
        { ...depositEvent, transaction_type: "refund", created_at: "2026-07-25T05:00:00Z" },
      ],
    });
    expect(held.collectedOn).toBe("2026-07-21");
  });

  it("skips a booking whose balance came from something other than a deposit", () => {
    expect(buildDepositHoldings({
      ...base,
      advances: [{ ...depositEvent, transaction_type: "adjustment" }],
    })).toEqual([]);
  });

  it("filters to the requested collection window", () => {
    expect(buildDepositHoldings({ ...base, from: "2026-07-21", to: "2026-07-21" })).toHaveLength(1);
    expect(buildDepositHoldings({ ...base, from: "2026-07-22", to: "2026-07-22" })).toEqual([]);
    expect(buildDepositHoldings({ ...base, from: "2026-07-19", to: "2026-07-20" })).toEqual([]);
  });

  it("dedupes payment modes", () => {
    const [held] = buildDepositHoldings({
      ...base,
      advances: [depositEvent, { ...depositEvent, payment_mode: "upi" }, { ...depositEvent, payment_mode: "cash" }],
    });
    expect(held.paymentModes).toEqual(["upi", "cash"]);
  });

  it("orders newest money first", () => {
    const older = { ...booking, admissionId: "a2", admissionNumber: "DC-20260719-0001" };
    const result = buildDepositHoldings({
      ...base,
      bookings: [older, booking],
      balances: new Map([["a1", 51500], ["a2", 1000]]),
      advances: [
        depositEvent,
        { ...depositEvent, admission_id: "a2", created_at: "2026-07-19T05:00:00Z" },
      ],
    });
    expect(result.map(h => h.admissionId)).toEqual(["a1", "a2"]);
  });
});

describe("totalHeld", () => {
  it("sums the holdings", () => {
    expect(totalHeld(buildDepositHoldings(base))).toBe(51500);
  });
  it("is 0 with no holdings, never NaN", () => {
    expect(totalHeld([])).toBe(0);
  });
});

/**
 * Phase 1 (PHASED_TEST_PLAN.md §8) — pure, cheap, adjacent, and guarding a defect that
 * already reached production once.
 *
 * The incident: `bills.payment_status` allows refund_pending and refunded, but every display
 * map fell back to `unpaid` for anything unknown. A refunded bill rendered as a red "Unpaid"
 * badge showing "₹51,500 due", and was counted into the Billing header's pending total —
 * telling the cashier to collect money that had already been handed back.
 */
import { describe, it, expect } from "vitest";
import {
  REFUND_PAYMENT_STATUSES,
  billStatusDisplay,
  isRefundStatus,
  outstandingAmount,
  totalOutstanding,
} from "@/lib/billStatus";

describe("billStatusDisplay — known statuses", () => {
  it.each([
    ["unpaid", "Unpaid"],
    ["partial", "Partial"],
    ["paid", "Paid ✓"],
    ["refunded", "Refunded"],
    ["refund_pending", "Refund pending"],
    ["cancelled", "Cancelled"],
    ["draft", "Draft"],
  ])("%s renders as '%s'", (status, label) => {
    expect(billStatusDisplay(status).label).toBe(label);
  });

  it("covers every value the payment_status CHECK constraint allows", () => {
    // The constraint (20260323042425) permits these five. Any one of them missing from the
    // map is the original defect returning.
    // The fallback branch is identifiable by its neutral-grey badge, so a status that is
    // genuinely mapped never carries it. If one of these five is dropped from DISPLAY it
    // falls through to the fallback and this fails.
    for (const status of ["unpaid", "partial", "paid", "refund_pending", "refunded"]) {
      expect(billStatusDisplay(status).badge, status).not.toBe("bg-muted text-muted-foreground");
    }
  });

  it("gives refunded and refund_pending different badges — settled vs needs action", () => {
    expect(billStatusDisplay("refunded").badge).not.toBe(billStatusDisplay("refund_pending").badge);
    expect(billStatusDisplay("refunded").border).not.toBe(billStatusDisplay("refund_pending").border);
  });

  it("gives unpaid a destructive badge and paid a success badge", () => {
    expect(billStatusDisplay("unpaid").badge).toContain("destructive");
    expect(billStatusDisplay("paid").badge).toContain("success");
  });

  it("matches case-insensitively", () => {
    expect(billStatusDisplay("REFUNDED").label).toBe("Refunded");
    expect(billStatusDisplay("Partial").label).toBe("Partial");
  });

  it("returns a label, badge and border for every status", () => {
    for (const s of ["unpaid", "partial", "paid", "refunded", "refund_pending", "cancelled", "draft", "who_knows", null]) {
      const d = billStatusDisplay(s);
      expect(d.label.length, String(s)).toBeGreaterThan(0);
      expect(d.badge.length, String(s)).toBeGreaterThan(0);
      expect(d.border.length, String(s)).toBeGreaterThan(0);
    }
  });
});

describe("billStatusDisplay — an unrecognised status must never render as 'Unpaid'", () => {
  // This is the whole point of the module. Defaulting an unknown state to "Unpaid" is what
  // hid 'refunded' for as long as it did: the screen asserted a debt the data never claimed.

  it("renders an unknown status as itself, title-cased, in neutral grey", () => {
    const d = billStatusDisplay("insurance_pending");
    expect(d.label).toBe("Insurance Pending");
    expect(d.badge).toBe("bg-muted text-muted-foreground");
    expect(d.border).toBe("border-l-muted-foreground");
  });

  it("never returns the Unpaid label for a status it does not know", () => {
    for (const unknown of ["insurance_pending", "written_off", "adjusted", "on_hold", "xyz"]) {
      expect(billStatusDisplay(unknown).label, unknown).not.toBe("Unpaid");
      expect(billStatusDisplay(unknown).badge, unknown).not.toContain("destructive");
    }
  });

  it("renders a missing status as 'Unknown', not as 'Unpaid'", () => {
    expect(billStatusDisplay(null).label).toBe("Unknown");
    expect(billStatusDisplay(undefined).label).toBe("Unknown");
    expect(billStatusDisplay("").label).toBe("Unknown");
  });
});

describe("isRefundStatus", () => {
  it("exports both refund statuses for query filters", () => {
    // CollectionsTab filters on this array so it does not dun a refunded patient.
    expect([...REFUND_PAYMENT_STATUSES]).toEqual(["refunded", "refund_pending"]);
  });

  it.each(["refunded", "refund_pending", "REFUNDED", "Refund_Pending"])("%s is a refund status", (s) => {
    expect(isRefundStatus(s)).toBe(true);
  });

  it.each(["paid", "unpaid", "partial", "cancelled", "draft", "", null, undefined])(
    "%s is not a refund status",
    (s) => {
      expect(isRefundStatus(s as string | null | undefined)).toBe(false);
    },
  );
});

describe("outstandingAmount", () => {
  it("is zero on a refunded bill whatever balance_due says", () => {
    // RefundApprovalsInbox sets paid_amount = 0 and balance_due = total_amount on refund, so
    // reading the column raw reports a refunded bill as fully collectable — inflating the
    // pending figure by exactly the amount just paid back.
    expect(outstandingAmount({ payment_status: "refunded", balance_due: 51500 })).toBe(0);
    expect(outstandingAmount({ payment_status: "refund_pending", balance_due: 51500 })).toBe(0);
  });

  it("returns the balance on a genuinely unpaid bill", () => {
    expect(outstandingAmount({ payment_status: "unpaid", balance_due: 1200 })).toBe(1200);
    expect(outstandingAmount({ payment_status: "partial", balance_due: 400.5 })).toBe(400.5);
  });

  it("is zero when nothing is owed", () => {
    expect(outstandingAmount({ payment_status: "paid", balance_due: 0 })).toBe(0);
  });

  it("clamps a negative balance to zero rather than crediting the pending total", () => {
    // An overpaid bill must not reduce what other patients owe.
    expect(outstandingAmount({ payment_status: "paid", balance_due: -500 })).toBe(0);
  });

  it("treats a missing or unparseable balance as zero", () => {
    expect(outstandingAmount({ payment_status: "unpaid", balance_due: null })).toBe(0);
    expect(outstandingAmount({ payment_status: "unpaid" })).toBe(0);
    expect(outstandingAmount({ payment_status: "unpaid", balance_due: NaN })).toBe(0);
    expect(outstandingAmount({ balance_due: "abc" as unknown as number })).toBe(0);
  });

  it("still collects on a bill whose status is unrecognised", () => {
    // The mirror of the display rule: an unknown status is not a refund, so the money is
    // still owed. Failing the other way would silently write off every bill in a new state.
    expect(outstandingAmount({ payment_status: "insurance_pending", balance_due: 900 })).toBe(900);
    expect(outstandingAmount({ payment_status: null, balance_due: 900 })).toBe(900);
  });
});

describe("totalOutstanding", () => {
  it("sums only what is genuinely still collectable", () => {
    const bills = [
      { payment_status: "unpaid", balance_due: 1000 },
      { payment_status: "partial", balance_due: 500 },
      { payment_status: "paid", balance_due: 0 },
      { payment_status: "refunded", balance_due: 51500 }, // money went OUT
      { payment_status: "refund_pending", balance_due: 2000 }, // going out
    ];
    expect(totalOutstanding(bills)).toBe(1500);
  });

  it("returns 0 for an empty or missing list", () => {
    expect(totalOutstanding([])).toBe(0);
    expect(totalOutstanding(null as never)).toBe(0);
  });

  it("does not let one refunded bill zero out the whole figure", () => {
    const withRefund = totalOutstanding([
      { payment_status: "unpaid", balance_due: 1000 },
      { payment_status: "refunded", balance_due: 99999 },
    ]);
    expect(withRefund).toBe(1000);
  });
});

describe("D3 — derived insurance_pending", () => {
  // PHASED_TEST_PLAN.md D3 calls for `insurance_pending` to be wired as a DERIVED value
  // computed here from `claim_outstanding > 0`, giving the collections desk the only
  // bill-level signal that outstanding money is insurer-side rather than patient-side.
  //
  // NOT IMPLEMENTED. D3's ratifier (revenue-pod) has not signed, and the Phase 0 gate
  // requiring D1–D9 ratification is still open. The test is written and committed in the
  // phase that found the gap, per R2; the fix is not.
  //
  // KNOWN-BUG-005: bill_status 'insurance_pending' is allowed by the CHECK constraint at
  // 20260323042425 and has zero references in src/. Target: phase 9. Owner: revenue-pod.
  it.skip("derives insurance_pending from claim outstanding (KNOWN-BUG-005 / D3)", () => {
    // Expected shape once D3 lands — a pure function here, not a new hand-set state in the
    // bill's transition machine.
    throw new Error("deriveBillStatus() does not exist yet — D3 unratified");
  });

  it("currently has no claim-awareness at all — pinned so the gap is visible", () => {
    // A bill whose outstanding money is entirely insurer-side is indistinguishable from one
    // the patient owes. This is what lets a collections desk dun the wrong party.
    const insurerOwes = { payment_status: "unpaid", balance_due: 50000 };
    const patientOwes = { payment_status: "unpaid", balance_due: 50000 };
    expect(outstandingAmount(insurerOwes)).toBe(outstandingAmount(patientOwes));
    expect(billStatusDisplay("insurance_pending").badge).toBe("bg-muted text-muted-foreground");
  });
});

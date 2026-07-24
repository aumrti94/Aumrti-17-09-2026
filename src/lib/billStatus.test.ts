import { describe, it, expect } from "vitest";
import {
  billStatusDisplay,
  isRefundStatus,
  outstandingAmount,
  totalOutstanding,
} from "./billStatus";

describe("billStatusDisplay", () => {
  it("labels a refunded bill Refunded, not Unpaid", () => {
    // The reported bug: a ₹51,500 refunded day care bill rendered as a red "Unpaid" badge.
    expect(billStatusDisplay("refunded").label).toBe("Refunded");
    expect(billStatusDisplay("refunded").badge).not.toContain("destructive");
  });

  it("distinguishes a pending refund from a completed one", () => {
    expect(billStatusDisplay("refund_pending").label).toBe("Refund pending");
    expect(billStatusDisplay("refund_pending").badge).not.toBe(billStatusDisplay("refunded").badge);
  });

  it("keeps the familiar labels for the everyday statuses", () => {
    expect(billStatusDisplay("unpaid").label).toBe("Unpaid");
    expect(billStatusDisplay("partial").label).toBe("Partial");
    expect(billStatusDisplay("paid").label).toBe("Paid ✓");
  });

  it("never falls back to Unpaid for an unknown status", () => {
    // Falling back to "Unpaid" is what hid 'refunded' — it asserts a debt the data
    // never claimed. An unknown state renders as itself, in neutral grey.
    expect(billStatusDisplay("some_new_state").label).toBe("Some New State");
    expect(billStatusDisplay(null).label).toBe("Unknown");
    expect(billStatusDisplay("").badge).toContain("muted");
  });

  it("is case-insensitive", () => {
    expect(billStatusDisplay("REFUNDED").label).toBe("Refunded");
  });
});

describe("isRefundStatus", () => {
  it("covers both refund states and nothing else", () => {
    expect(isRefundStatus("refunded")).toBe(true);
    expect(isRefundStatus("refund_pending")).toBe(true);
    expect(isRefundStatus("unpaid")).toBe(false);
    expect(isRefundStatus("paid")).toBe(false);
    expect(isRefundStatus(null)).toBe(false);
  });
});

describe("outstandingAmount", () => {
  it("is zero on a refunded bill however large balance_due is", () => {
    // The refund flow rewrites balance_due back up to the full total, so reading the
    // column raw reports refunded money as still collectable.
    expect(outstandingAmount({ payment_status: "refunded", balance_due: 51500 })).toBe(0);
    expect(outstandingAmount({ payment_status: "refund_pending", balance_due: 51500 })).toBe(0);
  });

  it("is the balance on a live bill", () => {
    expect(outstandingAmount({ payment_status: "unpaid", balance_due: 4500 })).toBe(4500);
    expect(outstandingAmount({ payment_status: "partial", balance_due: 1200 })).toBe(1200);
  });

  it("clamps an over-collected bill to zero rather than reporting a negative debt", () => {
    expect(outstandingAmount({ payment_status: "paid", balance_due: -800 })).toBe(0);
    expect(outstandingAmount({ payment_status: "unpaid", balance_due: null })).toBe(0);
  });
});

describe("totalOutstanding", () => {
  it("excludes refunded bills from the pending figure", () => {
    // Exactly the screenshot: ₹4,500 genuinely due + ₹51,500 refunded was reported
    // as ₹56,000 pending.
    const bills = [
      { payment_status: "unpaid", balance_due: 4500 },
      { payment_status: "refunded", balance_due: 51500 },
    ];
    expect(totalOutstanding(bills)).toBe(4500);
  });

  it("is zero for an empty list", () => {
    expect(totalOutstanding([])).toBe(0);
  });
});

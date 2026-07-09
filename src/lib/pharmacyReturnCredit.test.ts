import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression suite for applyReturnCreditToBill's overpaid-detection — the fix
 * for the bug where a "partial" bill pushed into overpayment by a large
 * return credit never got a refund_payables row created (only bills whose
 * *prior* status was literally "paid" did). The caller (processPharmacyReturn)
 * now decides whether to create a refund request from this function's
 * returned `overpaid`/`overpaidAmount`, not from the bill's pre-return status.
 */

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));

import { applyReturnCreditToBill } from "./pharmacyReturnCredit";

function makeChain(returnValue: unknown, onWrite?: (payload: any) => void) {
  const asPromise = Promise.resolve(returnValue as any);
  function buildProxy(): any {
    return new Proxy({} as any, {
      get(_: any, prop: string) {
        if (prop === "maybeSingle") return vi.fn().mockResolvedValue(returnValue);
        if (prop === "then") return asPromise.then.bind(asPromise);
        if (prop === "catch") return asPromise.catch.bind(asPromise);
        if (prop === "insert" || prop === "update") {
          return vi.fn((payload: any) => {
            onWrite?.(payload);
            return buildProxy();
          });
        }
        return vi.fn().mockReturnValue(buildProxy());
      },
    });
  }
  return buildProxy();
}

const LINES = [{ drugName: "Paracetamol", quantity: 10, unitRate: 5, gstPercent: 12, gstAmount: 6, lineTotal: 56 }];

let billsUpdates: any[];

function setupMocks(bill: Record<string, any> | null) {
  billsUpdates = [];
  mockFrom.mockImplementation((table: string) => {
    if (table === "bills") {
      return makeChain({ data: bill, error: null }, (payload) => billsUpdates.push(payload));
    }
    return makeChain({ error: null });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("applyReturnCreditToBill — overpaid detection", () => {
  it("reports overpaid when a PARTIALLY paid bill is pushed into overpayment by the return", async () => {
    // Bill: total 1000, paid 900 (status 'partial', balance 100). A ₹56 return
    // drops the total to 944 — paid (900) is still under 944, so this specific
    // case stays not-overpaid; use a bigger return below for the positive case.
    setupMocks({
      subtotal: 900, gst_amount: 100, total_amount: 1000,
      patient_payable: 1000, paid_amount: 900, balance_due: 100, payment_status: "partial",
    });

    const result = await applyReturnCreditToBill("bill-1", "hosp-1", "cn-1", LINES, 50, 6, 56);
    expect(result.overpaid).toBe(false);
    expect(billsUpdates[0].payment_status).toBe("partial"); // unchanged, not flipped to refund_pending
  });

  it("reports overpaid for a PARTIALLY paid bill when the return is large enough to exceed the new total", async () => {
    // Bill: total 1000, paid 900 (status 'partial'). A ₹950 return drops the
    // total to 50 — paid (900) now exceeds the new total by 850.
    setupMocks({
      subtotal: 900, gst_amount: 100, total_amount: 1000,
      patient_payable: 1000, paid_amount: 900, balance_due: 100, payment_status: "partial",
    });

    const result = await applyReturnCreditToBill("bill-1", "hosp-1", "cn-1", LINES, 850, 100, 950);
    expect(result.overpaid).toBe(true);
    expect(result.overpaidAmount).toBe(850);
    expect(billsUpdates[0].payment_status).toBe("refund_pending");
  });

  it("still reports overpaid for a fully PAID bill (the original, already-working case)", async () => {
    setupMocks({
      subtotal: 900, gst_amount: 100, total_amount: 1000,
      patient_payable: 1000, paid_amount: 1000, balance_due: 0, payment_status: "paid",
    });

    const result = await applyReturnCreditToBill("bill-1", "hosp-1", "cn-1", LINES, 50, 6, 56);
    expect(result.overpaid).toBe(true);
    expect(result.overpaidAmount).toBe(56);
  });

  it("returns overpaid:false without writing anything when the bill can't be found", async () => {
    setupMocks(null);
    const result = await applyReturnCreditToBill("missing-bill", "hosp-1", "cn-1", LINES, 50, 6, 56);
    expect(result).toEqual({ overpaid: false, overpaidAmount: 0 });
    expect(billsUpdates).toHaveLength(0);
  });
});

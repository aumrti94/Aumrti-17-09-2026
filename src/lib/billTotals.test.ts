/**
 * Phase 1 — revenue tier (PHASED_TEST_PLAN.md §8, Phase 1).
 *
 * `computeBillTotals` is the sole real implementation of a bill's arithmetic: the
 * "recalculate_bill_totals" RPC does not exist as a Postgres function on this project, so
 * every call falls through to this function. It is not a fallback — it is the billing engine.
 *
 * The assertions worth writing here encode the ORDER OF OPERATIONS, not the sums. `total` is
 * net of discount but still gross of advance; `patientPayable` is net of advance AND
 * insurance. Swap those two and every insured bill is wrong by the advance.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  checkBillWritable: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mocks.rpc, from: mocks.from },
}));
vi.mock("@/lib/lockedDay", () => ({ checkBillWritable: mocks.checkBillWritable }));

import { computeBillTotals, recalculateBillTotalsSafe, type BillTotalsInput } from "@/lib/billTotals";

describe("computeBillTotals — order of operations", () => {
  it("nets discount off total, then nets advance and insurance off patientPayable", () => {
    const t = computeBillTotals({
      items: [{ taxable_amount: 1000, gst_amount: 120 }],
      discountAmount: 100,
      advanceReceived: 500,
    });
    expect(t.subtotal).toBe(1000);
    expect(t.gst).toBe(120);
    expect(t.total).toBe(1020); // 1000 + 120 − 100 discount
    expect(t.patientPayable).toBe(520); // 1020 − 500 advance
    expect(t.balanceDue).toBe(520);
  });

  it("keeps total GROSS of advance", () => {
    // total_amount is the value of what was supplied. An advance is money already received
    // against it, not a reduction in what was supplied — netting it into total understates
    // hospital revenue on every admission that took a deposit.
    const withAdvance = computeBillTotals({ items: [{ taxable_amount: 1000, gst_amount: 0 }], advanceReceived: 400 });
    const without = computeBillTotals({ items: [{ taxable_amount: 1000, gst_amount: 0 }] });
    expect(withAdvance.total).toBe(1000);
    expect(withAdvance.total).toBe(without.total);
    expect(withAdvance.patientPayable).toBe(600);
  });

  it("keeps total NET of discount", () => {
    // The stated convention, matching how DiscountTab has always applied a discount. If a
    // recalculation stopped honouring it, a later unrelated line-item edit would silently
    // re-inflate an already-discounted bill back toward its pre-discount total.
    const t = computeBillTotals({ items: [{ taxable_amount: 1000, gst_amount: 0 }], discountAmount: 250 });
    expect(t.total).toBe(750);
  });

  it("subtracts insurance and advance from the same base, not in sequence off total", () => {
    const t = computeBillTotals({
      items: [{ taxable_amount: 10000, gst_amount: 0 }],
      advanceReceived: 2000,
      insuranceAmount: 6000,
    });
    expect(t.total).toBe(10000);
    expect(t.patientPayable).toBe(2000); // 10000 − 2000 − 6000
  });

  it("computes balanceDue off patientPayable, not off total", () => {
    const t = computeBillTotals({
      items: [{ taxable_amount: 10000, gst_amount: 0 }],
      insuranceAmount: 8000,
      paidAmount: 1000,
    });
    expect(t.patientPayable).toBe(2000);
    expect(t.balanceDue).toBe(1000);
  });
});

describe("computeBillTotals — clamping", () => {
  it("never returns a negative total when the discount exceeds the bill", () => {
    const t = computeBillTotals({ items: [{ taxable_amount: 500, gst_amount: 0 }], discountAmount: 900 });
    expect(t.total).toBe(0);
  });

  it("never returns a negative patientPayable when advance exceeds the bill", () => {
    const t = computeBillTotals({ items: [{ taxable_amount: 500, gst_amount: 0 }], advanceReceived: 900 });
    expect(t.patientPayable).toBe(0);
    expect(t.balanceDue).toBe(0);
  });

  it("never returns a negative balance when the patient has overpaid", () => {
    const t = computeBillTotals({ items: [], paidAmount: 500 });
    expect(t.balanceDue).toBe(0);
  });

  it("does not surface an overpayment as a refund due — that lives in billMoney", () => {
    // BillTotals is { subtotal, gst, total, patientPayable, balanceDue, paymentStatus }. The
    // clamp above HIDES the overpayment here by design; a caller that needs the refund must
    // read billMoney, not infer it from a zero balance.
    const t = computeBillTotals({ items: [{ taxable_amount: 100, gst_amount: 0 }], paidAmount: 500 });
    expect(t).not.toHaveProperty("refundDue");
    expect(t.balanceDue).toBe(0);
  });
});

describe("computeBillTotals — payment status", () => {
  it("is 'unpaid' when nothing has been paid", () => {
    expect(computeBillTotals({ items: [{ taxable_amount: 1000, gst_amount: 0 }] }).paymentStatus).toBe("unpaid");
  });

  it("is 'partial' when something is paid and something is still owed", () => {
    const t = computeBillTotals({ items: [{ taxable_amount: 1000, gst_amount: 0 }], paidAmount: 400 });
    expect(t.paymentStatus).toBe("partial");
    expect(t.balanceDue).toBe(600);
  });

  it("is 'paid' when the balance is cleared", () => {
    const t = computeBillTotals({ items: [{ taxable_amount: 1000, gst_amount: 0 }], paidAmount: 1000 });
    expect(t.paymentStatus).toBe("paid");
    expect(t.balanceDue).toBe(0);
  });

  it("is 'paid' on an overpayment", () => {
    expect(
      computeBillTotals({ items: [{ taxable_amount: 1000, gst_amount: 0 }], paidAmount: 1500 }).paymentStatus,
    ).toBe("paid");
  });

  it("is 'unpaid' on a zero bill with no payment", () => {
    expect(computeBillTotals({ items: [] }).paymentStatus).toBe("unpaid");
  });

  // KNOWN-BUG-109: a bill fully covered by an advance or by insurance has balanceDue 0 and
  // paid_amount 0, so it reports 'unpaid'. The badge then reads "Unpaid" on a bill with
  // nothing outstanding — the same class of defect billStatus.ts was written to eliminate,
  // arriving from the other direction. S3. Target: phase 9. Owner: revenue-pod.
  it("currently reports an advance-covered bill as 'unpaid' — pinned until KNOWN-BUG-109 is fixed", () => {
    const t = computeBillTotals({
      items: [{ taxable_amount: 1000, gst_amount: 0 }],
      advanceReceived: 1000,
      paidAmount: 0,
    });
    expect(t.balanceDue).toBe(0);
    expect(t.paymentStatus).toBe("unpaid");
  });

  it.skip("does not label a fully-covered bill 'unpaid' (KNOWN-BUG-109)", () => {
    const t = computeBillTotals({
      items: [{ taxable_amount: 1000, gst_amount: 0 }],
      advanceReceived: 1000,
    });
    expect(t.paymentStatus).not.toBe("unpaid");
  });
});

describe("computeBillTotals — input coercion", () => {
  it("accepts money as numeric strings, which is how it arrives from Postgres numeric", () => {
    // supabase-js returns `numeric` columns as strings. Summing them without Number() gives
    // "0" + "1000" + "120" = "01000120".
    const t = computeBillTotals({
      items: [{ taxable_amount: "1000", gst_amount: "120" }],
      discountAmount: "100",
      advanceReceived: "500",
      paidAmount: "20",
    } as BillTotalsInput);
    expect(t.subtotal).toBe(1000);
    expect(t.total).toBe(1020);
    expect(t.patientPayable).toBe(520);
    expect(t.balanceDue).toBe(500);
  });

  it("treats null and undefined amounts as zero", () => {
    const t = computeBillTotals({
      items: [{ taxable_amount: null, gst_amount: undefined }, {}],
      discountAmount: null,
      advanceReceived: undefined,
    });
    expect(t).toMatchObject({ subtotal: 0, gst: 0, total: 0, patientPayable: 0, balanceDue: 0 });
  });

  it("treats a missing items array as an empty bill rather than throwing", () => {
    expect(computeBillTotals({ items: undefined as never }).total).toBe(0);
  });

  it("sums many lines into one rounded subtotal", () => {
    const items = Array.from({ length: 3 }, () => ({ taxable_amount: 0.005, gst_amount: 0 }));
    expect(computeBillTotals({ items }).subtotal).toBe(0.02); // 0.015 → 0.02, rounded once at the end
  });

  it("rounds the sum, not each line — so a bill equals the sum of its printed lines", () => {
    const t = computeBillTotals({
      items: [
        { taxable_amount: 33.333, gst_amount: 4 },
        { taxable_amount: 33.333, gst_amount: 4 },
        { taxable_amount: 33.334, gst_amount: 4 },
      ],
    });
    expect(t.subtotal).toBe(100);
    expect(t.gst).toBe(12);
    expect(t.total).toBe(112);
  });
});

describe("recalculateBillTotalsSafe", () => {
  const BILL_ID = "22222222-2222-4222-8222-222222222222";

  /** Minimal supabase double: bills read, line-items read, bills update. */
  function wireSupabase(opts: {
    bill?: Record<string, unknown> | null;
    billError?: { message: string } | null;
    items?: { taxable_amount: number; gst_amount: number }[] | null;
    itemsError?: { message: string } | null;
    updateError?: { message: string } | null;
  }) {
    const updates: Record<string, unknown>[] = [];
    mocks.from.mockImplementation((table: string) => {
      if (table === "bills") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: opts.bill === undefined ? {} : opts.bill,
                error: opts.billError ?? null,
              }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            updates.push(payload);
            return { eq: async () => ({ error: opts.updateError ?? null }) };
          },
        };
      }
      return {
        select: () => ({
          // `items` is passed through verbatim — including null — because the `items || []`
          // fallback inside recalculateBillTotalsSafe is one of the branches under test.
          eq: async () => ({
            data: "items" in opts ? opts.items : [],
            error: opts.itemsError ?? null,
          }),
        }),
      };
    });
    return updates;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkBillWritable.mockResolvedValue(null);
  });

  it("reports success without a fallback when the RPC succeeds", () => {
    mocks.rpc.mockResolvedValue({ error: null });
    return expect(recalculateBillTotalsSafe(BILL_ID)).resolves.toEqual({ ok: true, usedFallback: false });
  });

  it("falls back to the client computation when the RPC errors, and writes the totals", async () => {
    // The RPC does not exist on this project, so this IS the normal path — not an edge case.
    mocks.rpc.mockResolvedValue({ error: { message: "function does not exist" } });
    const updates = wireSupabase({
      bill: { discount_amount: 100, advance_received: 500, insurance_amount: 0, paid_amount: 0, hospital_id: "h1" },
      items: [{ taxable_amount: 1000, gst_amount: 120 }],
    });

    const r = await recalculateBillTotalsSafe(BILL_ID);

    expect(r).toEqual({ ok: true, usedFallback: true });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      subtotal: 1000,
      taxable_amount: 1000,
      gst_amount: 120,
      total_amount: 1020,
      patient_payable: 520,
      balance_due: 520,
      payment_status: "unpaid",
    });
  });

  it("refuses — and does not write — when the day is locked", async () => {
    // The stated reason this pre-check exists: ~23 call sites insert the line item FIRST,
    // so an unguarded refusal at the UPDATE leaves the item committed against a bill whose
    // total never moved. Failing before the UPDATE at least reports it.
    mocks.rpc.mockResolvedValue({ error: { message: "nope" } });
    const updates = wireSupabase({ bill: { hospital_id: "h1", bill_date: "2026-09-01" }, items: [] });
    mocks.checkBillWritable.mockResolvedValue("Day closed. Reopen Day to post charges.");

    const r = await recalculateBillTotalsSafe(BILL_ID);

    expect(r).toEqual({
      ok: false,
      usedFallback: true,
      error: "Day closed. Reopen Day to post charges.",
    });
    expect(updates).toHaveLength(0);
  });

  it("passes the bill's own lock context to the locked-day check", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "nope" } });
    wireSupabase({
      bill: { hospital_id: "h1", bill_date: "2026-09-01", bill_status: "final", admission_id: "adm-1" },
      items: [],
    });
    await recalculateBillTotalsSafe(BILL_ID);
    expect(mocks.checkBillWritable).toHaveBeenCalledWith("h1", {
      billDate: "2026-09-01",
      billStatus: "final",
      admissionId: "adm-1",
    });
  });

  it("reports failure when the bill cannot be read", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "nope" } });
    wireSupabase({ bill: null });
    await expect(recalculateBillTotalsSafe(BILL_ID)).resolves.toEqual({
      ok: false,
      usedFallback: true,
      error: "Bill not found for recalculation",
    });
  });

  it("surfaces the bill read error message when there is one", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "nope" } });
    wireSupabase({ bill: null, billError: { message: "permission denied for table bills" } });
    await expect(recalculateBillTotalsSafe(BILL_ID)).resolves.toEqual({
      ok: false,
      usedFallback: true,
      error: "permission denied for table bills",
    });
  });

  it("reports failure rather than writing a total from a failed line-item read", async () => {
    // Supabase returns errors as VALUES. Treating a failed line-item query as an empty bill
    // would zero out a live bill's total — the single most expensive silent failure here.
    mocks.rpc.mockResolvedValue({ error: { message: "nope" } });
    const updates = wireSupabase({
      bill: { hospital_id: "h1" },
      items: null,
      itemsError: { message: "statement timeout" },
    });
    await expect(recalculateBillTotalsSafe(BILL_ID)).resolves.toEqual({
      ok: false,
      usedFallback: true,
      error: "statement timeout",
    });
    expect(updates).toHaveLength(0);
  });

  it("reports failure when the update itself is rejected", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "nope" } });
    wireSupabase({
      bill: { hospital_id: "h1" },
      items: [{ taxable_amount: 100, gst_amount: 0 }],
      updateError: { message: "row level security" },
    });
    await expect(recalculateBillTotalsSafe(BILL_ID)).resolves.toEqual({
      ok: false,
      usedFallback: true,
      error: "row level security",
    });
  });

  it("treats a null line-item result with no error as an empty bill", async () => {
    // Distinct from the error case above: PostgREST can return a null body without an error
    // object. That genuinely IS an empty bill, so zeroing the total is correct here — and
    // the contrast with the itemsError case is the whole point of asserting both.
    mocks.rpc.mockResolvedValue({ error: { message: "nope" } });
    const updates = wireSupabase({ bill: { hospital_id: "h1" }, items: null });
    const r = await recalculateBillTotalsSafe(BILL_ID);
    expect(r).toEqual({ ok: true, usedFallback: true });
    expect(updates[0]).toMatchObject({ subtotal: 0, total_amount: 0, balance_due: 0 });
  });

  it("never throws — an unexpected error is returned as a value", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "nope" } });
    mocks.from.mockImplementation(() => {
      throw new Error("client not initialised");
    });
    await expect(recalculateBillTotalsSafe(BILL_ID)).resolves.toEqual({
      ok: false,
      usedFallback: true,
      error: "client not initialised",
    });
  });

  it("still returns a message when something non-Error is thrown", async () => {
    // A rejected promise carrying a string or an object is common at the supabase-js / fetch
    // boundary. `error: undefined` here would render an empty toast at the billing counter.
    mocks.rpc.mockResolvedValue({ error: { message: "nope" } });
    mocks.from.mockImplementation(() => {
      throw "socket hang up";
    });
    await expect(recalculateBillTotalsSafe(BILL_ID)).resolves.toEqual({
      ok: false,
      usedFallback: true,
      error: "Unknown bill recalculation error",
    });
  });
});

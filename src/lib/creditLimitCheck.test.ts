import { describe, it, expect, vi, beforeEach } from "vitest";

let payerRow: any = null;
const updateMock = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockImplementation(() => Promise.resolve({ data: payerRow, error: null })),
      update: updateMock,
    })),
  },
}));

import { checkPayerCreditLimit, decreasePayerOutstanding, increasePayerOutstanding } from "@/lib/creditLimitCheck";

beforeEach(() => {
  updateMock.mockClear();
  payerRow = null;
});

describe("checkPayerCreditLimit — Payer Masters credit_limit / credit_hold", () => {
  it("allows unrestricted when the payer has no configured credit_limit", async () => {
    payerRow = { credit_limit: null, credit_hold: false, credit_hold_reason: null, outstanding_amount: 50000 };
    const r = await checkPayerCreditLimit("hosp-a", "payer-1", 10000);
    expect(r.allowed).toBe(true);
    expect(r.limit).toBeNull();
  });

  it("blocks outright when the payer is on a manual credit hold, regardless of the amount", async () => {
    payerRow = { credit_limit: 100000, credit_hold: true, credit_hold_reason: "Overdue invoice", outstanding_amount: 5000 };
    const r = await checkPayerCreditLimit("hosp-a", "payer-1", 1);
    expect(r.allowed).toBe(false);
    expect(r.onHold).toBe(true);
    expect(r.reason).toBe("Overdue invoice");
  });

  it("blocks a new bill that would push outstanding past the configured limit", async () => {
    payerRow = { credit_limit: 100000, credit_hold: false, credit_hold_reason: null, outstanding_amount: 95000 };
    const r = await checkPayerCreditLimit("hosp-a", "payer-1", 10000);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/Credit limit exceeded/);
  });

  it("allows a new bill that stays within the limit — same payer, smaller amount, different outcome", async () => {
    payerRow = { credit_limit: 100000, credit_hold: false, credit_hold_reason: null, outstanding_amount: 95000 };
    const r = await checkPayerCreditLimit("hosp-a", "payer-1", 2000);
    expect(r.allowed).toBe(true);
    expect(r.utilizationPct).toBe(97);
  });

  it("a different configured limit for the same outstanding/new-bill numbers changes the decision", async () => {
    payerRow = { credit_limit: 50000, credit_hold: false, credit_hold_reason: null, outstanding_amount: 40000 };
    const tight = await checkPayerCreditLimit("hosp-a", "payer-1", 15000);
    payerRow = { credit_limit: 200000, credit_hold: false, credit_hold_reason: null, outstanding_amount: 40000 };
    const generous = await checkPayerCreditLimit("hosp-a", "payer-1", 15000);
    expect(tight.allowed).toBe(false);
    expect(generous.allowed).toBe(true);
  });

  it("allows unrestricted when the payer row is not found (e.g. self-pay / no payer master)", async () => {
    payerRow = null;
    const r = await checkPayerCreditLimit("hosp-a", "missing", 10000);
    expect(r.allowed).toBe(true);
  });
});

describe("decreasePayerOutstanding — settling a bill lowers outstanding and can auto-lift a hold", () => {
  it("reduces outstanding by the paid amount, never below zero", async () => {
    payerRow = { outstanding_amount: 5000, credit_limit: 100000, credit_hold: false };
    await decreasePayerOutstanding("hosp-a", "payer-1", 8000);
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ outstanding_amount: 0 }));
  });

  it("auto-lifts a credit hold once the payment brings outstanding back within the limit", async () => {
    payerRow = { outstanding_amount: 120000, credit_limit: 100000, credit_hold: true };
    await decreasePayerOutstanding("hosp-a", "payer-1", 30000);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ outstanding_amount: 90000, credit_hold: false, credit_hold_reason: null })
    );
  });

  it("does not lift the hold if the payment is not enough to bring outstanding within the limit", async () => {
    payerRow = { outstanding_amount: 150000, credit_limit: 100000, credit_hold: true };
    await decreasePayerOutstanding("hosp-a", "payer-1", 10000);
    const call = updateMock.mock.calls[0][0];
    expect(call.credit_hold).toBeUndefined();
  });
});

describe("increasePayerOutstanding — a new bill can auto-trigger a hold at 110% utilization", () => {
  it("does not hold when the new outstanding stays under 110% of the limit", async () => {
    payerRow = { outstanding_amount: 50000, credit_limit: 100000 };
    await increasePayerOutstanding("hosp-a", "payer-1", 40000);
    const call = updateMock.mock.calls[0][0];
    expect(call.outstanding_amount).toBe(90000);
    expect(call.credit_hold).toBeUndefined();
  });

  it("auto-holds once the new outstanding exceeds 110% of the configured limit", async () => {
    payerRow = { outstanding_amount: 100000, credit_limit: 100000 };
    await increasePayerOutstanding("hosp-a", "payer-1", 15000);
    const call = updateMock.mock.calls[0][0];
    expect(call.outstanding_amount).toBe(115000);
    expect(call.credit_hold).toBe(true);
    expect(call.credit_hold_reason).toMatch(/Auto-hold/);
  });

  it("a lower configured limit auto-holds sooner for an identical bill sequence", async () => {
    payerRow = { outstanding_amount: 50000, credit_limit: 40000 };
    await increasePayerOutstanding("hosp-a", "payer-1", 5000);
    expect(updateMock.mock.calls[0][0].credit_hold).toBe(true);
  });

  it("never holds when no credit_limit is configured at all", async () => {
    payerRow = { outstanding_amount: 500000, credit_limit: null };
    await increasePayerOutstanding("hosp-a", "payer-1", 500000);
    expect(updateMock.mock.calls[0][0].credit_hold).toBeUndefined();
  });
});

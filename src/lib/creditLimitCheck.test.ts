import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));

import { checkPayerCreditLimit, increasePayerOutstanding, decreasePayerOutstanding } from "./creditLimitCheck";

function payerChain(payer: unknown) {
  return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: payer }) }) }) }) };
}

// increasePayerOutstanding and decreasePayerOutstanding both select filtered by id (one .eq()).
function payerChainOneEq(payer: unknown) {
  return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: payer }) }) }) };
}

beforeEach(() => mockFrom.mockReset());

describe("checkPayerCreditLimit", () => {
  it("allows unrestricted when the payer has no configured credit limit", async () => {
    mockFrom.mockReturnValue(payerChain({ credit_limit: null, credit_hold: false, outstanding_amount: 50000 }));
    const result = await checkPayerCreditLimit("h1", "payer-1", 10000);
    expect(result).toEqual({ allowed: true, onHold: false, outstanding: 50000, limit: null, utilizationPct: null });
  });

  it("allows unrestricted (open account) when the payer master doesn't exist", async () => {
    mockFrom.mockReturnValue(payerChain(null));
    const result = await checkPayerCreditLimit("h1", "payer-1");
    expect(result.allowed).toBe(true);
  });

  it("blocks outright when the account is already on credit hold", async () => {
    mockFrom.mockReturnValue(
      payerChain({ credit_limit: 100000, credit_hold: true, credit_hold_reason: "Overdue invoice", outstanding_amount: 90000 }),
    );
    const result = await checkPayerCreditLimit("h1", "payer-1", 5000);
    expect(result).toEqual({
      allowed: false,
      onHold: true,
      outstanding: 90000,
      limit: 100000,
      utilizationPct: 90,
      reason: "Overdue invoice",
    });
  });

  it("blocks when the new bill would push outstanding past the limit", async () => {
    mockFrom.mockReturnValue(payerChain({ credit_limit: 100000, credit_hold: false, outstanding_amount: 95000 }));
    const result = await checkPayerCreditLimit("h1", "payer-1", 10000);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Credit limit exceeded");
  });

  it("allows when the new bill stays within the limit", async () => {
    mockFrom.mockReturnValue(payerChain({ credit_limit: 100000, credit_hold: false, outstanding_amount: 50000 }));
    const result = await checkPayerCreditLimit("h1", "payer-1", 10000);
    expect(result).toEqual({ allowed: true, onHold: false, outstanding: 50000, limit: 100000, utilizationPct: 60 });
  });

  it("allows exactly at the limit boundary (not over)", async () => {
    mockFrom.mockReturnValue(payerChain({ credit_limit: 100000, credit_hold: false, outstanding_amount: 90000 }));
    const result = await checkPayerCreditLimit("h1", "payer-1", 10000);
    expect(result.allowed).toBe(true);
  });
});

describe("increasePayerOutstanding — auto-hold at 110% utilization", () => {
  it("increases outstanding without triggering a hold when within 110% of the limit", async () => {
    const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) }) });
    mockFrom.mockReturnValue({ ...payerChainOneEq({ outstanding_amount: 50000, credit_limit: 100000 }), update: updateSpy });

    await increasePayerOutstanding("h1", "payer-1", 20000);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ outstanding_amount: 70000 }));
    expect(updateSpy.mock.calls[0][0]).not.toHaveProperty("credit_hold");
  });

  it("auto-holds the account once outstanding exceeds 110% of the limit", async () => {
    const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) }) });
    mockFrom.mockReturnValue({ ...payerChainOneEq({ outstanding_amount: 100000, credit_limit: 100000 }), update: updateSpy });

    await increasePayerOutstanding("h1", "payer-1", 15000); // 115000 > 110000 (110%)
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ credit_hold: true }));
  });

  it("does nothing when the payer doesn't exist", async () => {
    const updateSpy = vi.fn();
    mockFrom.mockReturnValue({ ...payerChainOneEq(null), update: updateSpy });
    await increasePayerOutstanding("h1", "payer-1", 5000);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe("decreasePayerOutstanding — auto-lift hold once back within limit", () => {
  it("decreases outstanding and never goes negative", async () => {
    const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) }) });
    mockFrom.mockReturnValue({ ...payerChainOneEq({ outstanding_amount: 5000, credit_limit: 100000, credit_hold: false }), update: updateSpy });

    await decreasePayerOutstanding("h1", "payer-1", 20000); // overpaying the tracked outstanding
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ outstanding_amount: 0 }));
  });

  it("auto-lifts a credit hold once the payment brings outstanding back within the limit", async () => {
    const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) }) });
    mockFrom.mockReturnValue({
      ...payerChainOneEq({ outstanding_amount: 120000, credit_limit: 100000, credit_hold: true }),
      update: updateSpy,
    });

    await decreasePayerOutstanding("h1", "payer-1", 30000); // 90000 <= 100000
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ credit_hold: false, credit_hold_reason: null }),
    );
  });

  it("keeps the hold in place if the payment doesn't bring outstanding within the limit", async () => {
    const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) }) });
    mockFrom.mockReturnValue({
      ...payerChainOneEq({ outstanding_amount: 150000, credit_limit: 100000, credit_hold: true }),
      update: updateSpy,
    });

    await decreasePayerOutstanding("h1", "payer-1", 10000); // still 140000 > 100000
    expect(updateSpy.mock.calls[0][0]).not.toHaveProperty("credit_hold");
  });
});

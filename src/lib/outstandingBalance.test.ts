import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));
vi.mock("@/lib/billStatus", () => ({ REFUND_PAYMENT_STATUSES: ["refunded", "partially_refunded"] }));

import { fetchPatientOutstandingBalance } from "./outstandingBalance";

function billsChain(bills: unknown[]) {
  const p: any = Promise.resolve({ data: bills });
  p.select = () => p;
  p.eq = () => p;
  p.gt = () => p;
  p.not = () => p;
  return p;
}

beforeEach(() => mockFrom.mockReset());

describe("fetchPatientOutstandingBalance", () => {
  it("sums balance_due across every outstanding bill", async () => {
    mockFrom.mockReturnValue(billsChain([{ balance_due: 1500 }, { balance_due: 2500 }]));
    const result = await fetchPatientOutstandingBalance("p1", "h1");
    expect(result).toEqual({ totalOutstanding: 4000, billCount: 2 });
  });

  it("returns zero when the patient has no outstanding bills", async () => {
    mockFrom.mockReturnValue(billsChain([]));
    const result = await fetchPatientOutstandingBalance("p1", "h1");
    expect(result).toEqual({ totalOutstanding: 0, billCount: 0 });
  });

  it("returns zero rather than throwing when the query returns no data", async () => {
    mockFrom.mockReturnValue(billsChain(null as any));
    const result = await fetchPatientOutstandingBalance("p1", "h1");
    expect(result).toEqual({ totalOutstanding: 0, billCount: 0 });
  });

  it("treats a non-numeric balance_due as zero rather than producing NaN", async () => {
    mockFrom.mockReturnValue(billsChain([{ balance_due: "not-a-number" }, { balance_due: 500 }]));
    const result = await fetchPatientOutstandingBalance("p1", "h1");
    expect(result.totalOutstanding).toBe(500);
  });
});

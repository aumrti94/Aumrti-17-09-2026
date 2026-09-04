import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFrom, mockGenerateBillNumber, mockFindOrCreateBill, mockRecalc,
  mockGetModuleDefaultRate, mockRecordServiceCharge,
  mockFetchIpdAncillaryPolicy, mockResolveChargePaymentStatus,
  mockServiceForSourceModule, mockShouldDebitAdvance,
} = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGenerateBillNumber: vi.fn(),
  mockFindOrCreateBill: vi.fn(),
  mockRecalc: vi.fn(),
  mockGetModuleDefaultRate: vi.fn(),
  mockRecordServiceCharge: vi.fn(),
  mockFetchIpdAncillaryPolicy: vi.fn(),
  mockResolveChargePaymentStatus: vi.fn(),
  mockServiceForSourceModule: vi.fn(),
  mockShouldDebitAdvance: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));
vi.mock("@/hooks/useBillNumber", () => ({ generateBillNumber: mockGenerateBillNumber }));
vi.mock("@/lib/admissionBill", () => ({ findOrCreateAdmissionBill: mockFindOrCreateBill }));
vi.mock("@/lib/billTotals", () => ({ recalculateBillTotalsSafe: mockRecalc }));
vi.mock("@/lib/serviceRates", () => ({ getModuleDefaultRate: mockGetModuleDefaultRate }));
vi.mock("@/lib/serviceBilling", () => ({ recordServiceCharge: mockRecordServiceCharge }));
vi.mock("@/lib/ipdAncillaryGate", () => ({
  fetchIpdAncillaryPolicy: mockFetchIpdAncillaryPolicy,
  resolveChargePaymentStatus: mockResolveChargePaymentStatus,
  serviceForSourceModule: mockServiceForSourceModule,
  shouldDebitAdvance: mockShouldDebitAdvance,
}));
// calcGST is pure and already tested via currency.test.ts.

import { postCharge, syncBillItemPaymentStatus, lookupServiceRate } from "./chargePosting";

function existingChargeChain(existing: unknown) {
  return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: existing }) }) }) }) };
}

const BASE_OPTS = {
  hospitalId: "h1",
  patientId: "p1",
  description: "Dialysis session",
  itemType: "dialysis_session",
  sourceModule: "dialysis" as const,
  sourceId: "order-1",
  unitPrice: 2000,
  gstPercent: 0,
};

beforeEach(() => {
  mockFrom.mockReset();
  mockGenerateBillNumber.mockReset();
  mockFindOrCreateBill.mockReset();
  mockRecalc.mockReset();
  mockGetModuleDefaultRate.mockReset();
  mockRecordServiceCharge.mockReset();
  mockFetchIpdAncillaryPolicy.mockReset();
  mockResolveChargePaymentStatus.mockReset();
  mockServiceForSourceModule.mockReset();
  mockShouldDebitAdvance.mockReset();

  mockServiceForSourceModule.mockReturnValue(null); // dialysis is ungoverned -> post_paid path
  mockResolveChargePaymentStatus.mockReturnValue("advance_covered");
  mockRecalc.mockResolvedValue({ ok: true });
});

describe("postCharge — idempotency", () => {
  it("returns the existing line item without inserting a duplicate", async () => {
    mockFrom.mockReturnValue(existingChargeChain({ id: "li-1", bill_id: "bill-1", total_amount: 2000 }));

    const result = await postCharge(BASE_OPTS);
    expect(result).toEqual({ success: true, billItemId: "li-1", billId: "bill-1", amount: 2000, paymentStatus: "advance_covered" });
  });
});

describe("postCharge — OPD path", () => {
  it("creates a new OPD bill when none exists for the encounter", async () => {
    mockGenerateBillNumber.mockResolvedValue("OPD-2026-0001");
    const billInsert = vi.fn().mockReturnValue({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "bill-new" }, error: null }) }) });
    const lineInsert = vi.fn().mockReturnValue({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "li-new" }, error: null }) }) });

    mockFrom.mockImplementation((table: string) => {
      if (table === "bill_line_items") {
        return { ...existingChargeChain(null), insert: lineInsert };
      }
      if (table === "bills") {
        return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }) }) }) }), insert: billInsert };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await postCharge({ ...BASE_OPTS, encounterId: "enc-1" });
    expect(result.success).toBe(true);
    expect(result.billId).toBe("bill-new");
    expect(billInsert).toHaveBeenCalledWith(expect.objectContaining({ bill_type: "opd", bill_number: "OPD-2026-0001" }));
  });
});

describe("postCharge — IPD path", () => {
  it("posts onto the admission's own bill and does not debit the advance when not directed to", async () => {
    mockFindOrCreateBill.mockResolvedValue({ id: "bill-ipd" });
    mockShouldDebitAdvance.mockReturnValue(false);
    const lineInsert = vi.fn().mockReturnValue({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "li-1" }, error: null }) }) });
    mockFrom.mockReturnValue({ ...existingChargeChain(null), insert: lineInsert });

    const result = await postCharge({ ...BASE_OPTS, admissionId: "adm-1" });
    expect(result.success).toBe(true);
    expect(result.billId).toBe("bill-ipd");
    // Only the idempotency-check + line-item calls to bill_line_items — no ipd_advances insert.
    expect(mockFrom).not.toHaveBeenCalledWith("ipd_advances");
  });

  it("debits the advance ledger when shouldDebitAdvance says to", async () => {
    mockFindOrCreateBill.mockResolvedValue({ id: "bill-ipd" });
    mockShouldDebitAdvance.mockReturnValue(true);
    const lineInsert = vi.fn().mockReturnValue({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "li-1" }, error: null }) }) });
    const advanceInsert = vi.fn().mockResolvedValue({ data: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "bill_line_items") return { ...existingChargeChain(null), insert: lineInsert };
      if (table === "ipd_advances") return { insert: advanceInsert };
      throw new Error(`unexpected table ${table}`);
    });

    await postCharge({ ...BASE_OPTS, admissionId: "adm-1" });
    expect(advanceInsert).toHaveBeenCalledWith(expect.objectContaining({ transaction_type: "service_debit", amount: 2000 }));
  });

  it("returns a typed failure when the admission bill cannot be resolved", async () => {
    mockFindOrCreateBill.mockRejectedValue(new Error("admission not found"));
    mockFrom.mockReturnValue(existingChargeChain(null));

    const result = await postCharge({ ...BASE_OPTS, admissionId: "adm-1" });
    expect(result).toEqual({ success: false, error: "admission not found" });
  });
});

describe("postCharge — GST-safe unitPrice contract", () => {
  it("applies an explicitly supplied gstPercent alongside an explicit unitPrice", async () => {
    mockFindOrCreateBill.mockResolvedValue({ id: "bill-ipd" });
    mockShouldDebitAdvance.mockReturnValue(false);
    let inserted: any;
    mockFrom.mockReturnValue({
      ...existingChargeChain(null),
      insert: (row: any) => {
        inserted = row;
        return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "li-1" }, error: null }) }) };
      },
    });

    await postCharge({ ...BASE_OPTS, admissionId: "adm-1", unitPrice: 1000, gstPercent: 18 });
    expect(inserted.gst_percent).toBe(18);
    expect(inserted.total_amount).toBe(1180);
  });
});

describe("syncBillItemPaymentStatus", () => {
  it("marks a single line item paid by id", async () => {
    const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) });
    mockFrom.mockReturnValue({ update: updateSpy });

    const result = await syncBillItemPaymentStatus({ billItemId: "li-1", collectedBy: "u1" });
    expect(result).toBe(true);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ payment_status: "paid", payment_collected_by: "u1" }));
  });

  it("returns false rather than throwing on a DB failure", async () => {
    mockFrom.mockImplementation(() => {
      throw new Error("db down");
    });
    expect(await syncBillItemPaymentStatus({ billItemId: "li-1", collectedBy: "u1" })).toBe(false);
  });
});

describe("lookupServiceRate", () => {
  it("returns the configured fee for the item type", async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ ilike: () => ({}), maybeSingle: () => Promise.resolve({ data: { fee: 850 } }) }) }) }) }) }),
    });
    expect(await lookupServiceRate("h1", "consultation")).toBe(850);
  });

  it("returns 0 when no rate is configured", async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ ilike: () => ({}), maybeSingle: () => Promise.resolve({ data: null }) }) }) }) }) }),
    });
    expect(await lookupServiceRate("h1", "consultation")).toBe(0);
  });
});

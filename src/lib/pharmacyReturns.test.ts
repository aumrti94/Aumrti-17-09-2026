import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom, mockGenerateBillNumber, mockAutoPostJournalEntry, mockApplyReturnCredit } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGenerateBillNumber: vi.fn(),
  mockAutoPostJournalEntry: vi.fn(),
  mockApplyReturnCredit: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));
vi.mock("@/hooks/useBillNumber", () => ({ generateBillNumber: mockGenerateBillNumber }));
vi.mock("@/lib/accounting", () => ({ autoPostJournalEntry: mockAutoPostJournalEntry }));
vi.mock("@/lib/pharmacyReturnCredit", () => ({ applyReturnCreditToBill: mockApplyReturnCredit }));

import { processPharmacyReturn, STOCK_ACTIONS, PharmacyReturnContext, PharmacyReturnLine } from "./pharmacyReturns";

function emptyChain(): any {
  const p: any = Promise.resolve({ data: [] });
  for (const m of ["select", "eq", "in", "not", "order", "limit"]) p[m] = () => p;
  p.maybeSingle = () => Promise.resolve({ data: null });
  return p;
}
const NOOP = { select: () => emptyChain(), insert: () => emptyChain(), update: () => emptyChain() };

const CTX: PharmacyReturnContext = {
  hospitalId: "h1", patientId: "p1", patientName: "Jane Doe", admissionId: null,
  billId: "bill-1", userId: "u1",
};

beforeEach(() => {
  mockFrom.mockReset();
  mockGenerateBillNumber.mockReset();
  mockAutoPostJournalEntry.mockReset();
  mockApplyReturnCredit.mockReset();
  mockAutoPostJournalEntry.mockResolvedValue(null);
});

describe("STOCK_ACTIONS", () => {
  it("has a unique value and a non-empty label for every disposition option", () => {
    const values = STOCK_ACTIONS.map((a) => a.value);
    expect(new Set(values).size).toBe(values.length);
    for (const a of STOCK_ACTIONS) expect(a.label.length).toBeGreaterThan(0);
  });
});

describe("processPharmacyReturn", () => {
  const LINE: PharmacyReturnLine = {
    dispensingItemId: "di-1", dispensingId: "disp-1", drugId: "drug-1", drugName: "Paracetamol",
    batchId: "batch-1", batchNumber: "B1", quantity: 10, unitPrice: 5, gstPercent: 12,
    isNdps: false, reason: "Adverse reaction", stockAction: "returned_to_stock",
  };

  it("creates a credit note and posts a journal entry for a non-zero refund", async () => {
    mockGenerateBillNumber.mockResolvedValue("CN-2026-0001");
    mockApplyReturnCredit.mockResolvedValue({ overpaid: false, overpaidAmount: 0 });

    const creditNoteInsert = vi.fn().mockReturnValue({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "cn-1" }, error: null }) }) });
    const batchSelect = { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { quantity_available: 50 } }) }) }) };

    mockFrom.mockImplementation((table: string) => {
      if (table === "drug_batches") return { ...batchSelect, update: () => ({ eq: () => Promise.resolve({}) }) };
      if (table === "credit_notes") return { insert: creditNoteInsert };
      if (table === "pharmacy_dispensing_items") return { update: () => ({ eq: () => Promise.resolve({}) }) };
      return NOOP;
    });

    const result = await processPharmacyReturn(CTX, [LINE]);

    // 10 * 5 = 50 base, 12% GST = 6, total 56
    expect(result).toEqual({ creditNoteId: "cn-1", creditNoteNumber: "CN-2026-0001", totalRefund: 56, billAdjusted: true, refundPayableCreated: false });
    expect(creditNoteInsert).toHaveBeenCalledWith(expect.objectContaining({ credit_amount: 50, gst_credit: 6, total_credit: 56 }));
    expect(mockApplyReturnCredit).toHaveBeenCalled();
    expect(mockAutoPostJournalEntry).toHaveBeenCalledWith(expect.objectContaining({ triggerEvent: "credit_note_pharmacy", amount: 56 }));
  });

  it("creates a refund_payable when the return credit pushes the bill into overpayment", async () => {
    mockGenerateBillNumber.mockResolvedValue("CN-2026-0002");
    mockApplyReturnCredit.mockResolvedValue({ overpaid: true, overpaidAmount: 20 });
    const refundInsert = vi.fn().mockResolvedValue({ data: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "credit_notes") return { insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "cn-2" }, error: null }) }) }) };
      if (table === "refund_payables") return { insert: refundInsert };
      return NOOP;
    });

    const result = await processPharmacyReturn(CTX, [LINE]);
    expect(result.refundPayableCreated).toBe(true);
    expect(refundInsert).toHaveBeenCalledWith(expect.objectContaining({ amount: 20, status: "pending_approval" }));
  });

  it("writes an NDPS register entry, chaining the running balance, for a Schedule X/H1 drug", async () => {
    const ndpsInsert = vi.fn().mockResolvedValue({ data: null });
    mockGenerateBillNumber.mockResolvedValue("CN-2026-0003");
    mockApplyReturnCredit.mockResolvedValue({ overpaid: false, overpaidAmount: 0 });

    mockFrom.mockImplementation((table: string) => {
      if (table === "ndps_register") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: { balance_after: 100 } }) }) }) }) }) }),
          insert: ndpsInsert,
        };
      }
      if (table === "credit_notes") return { insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "cn-3" }, error: null }) }) }) };
      return NOOP;
    });

    const ndpsLine: PharmacyReturnLine = { ...LINE, isNdps: true, quantity: 5 };
    await processPharmacyReturn({ ...CTX, ndpsPharmacistId: "senior-1" }, [ndpsLine]);

    expect(ndpsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ transaction_type: "return", quantity: 5, balance_after: 105, pharmacist_id: "senior-1" }),
    );
  });

  it("does not write an NDPS register entry for an ordinary (non-NDPS, non-H1) drug", async () => {
    const ndpsInsert = vi.fn();
    mockGenerateBillNumber.mockResolvedValue("CN-2026-0004");
    mockApplyReturnCredit.mockResolvedValue({ overpaid: false, overpaidAmount: 0 });
    mockFrom.mockImplementation((table: string) => {
      if (table === "ndps_register") return { insert: ndpsInsert };
      if (table === "credit_notes") return { insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "cn-4" }, error: null }) }) }) };
      return NOOP;
    });

    await processPharmacyReturn(CTX, [LINE]);
    expect(ndpsInsert).not.toHaveBeenCalled();
  });

  it("skips credit-note creation entirely when the computed refund is zero", async () => {
    const creditNoteFrom = vi.fn();
    mockFrom.mockImplementation((table: string) => {
      if (table === "credit_notes") return creditNoteFrom();
      return NOOP;
    });

    const zeroLine: PharmacyReturnLine = { ...LINE, unitPrice: 0, gstPercent: 0 };
    const result = await processPharmacyReturn(CTX, [zeroLine]);
    expect(result.creditNoteId).toBeNull();
    expect(creditNoteFrom).not.toHaveBeenCalled();
  });
});

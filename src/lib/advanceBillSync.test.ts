import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindAdmissionBill, mockFrom } = vi.hoisted(() => ({
  mockFindAdmissionBill: vi.fn(),
  mockFrom: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));
vi.mock("@/lib/admissionBill", () => ({ findAdmissionBill: mockFindAdmissionBill }));

import { syncAdvanceToBill } from "./advanceBillSync";

function billChain(bill: unknown) {
  return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: bill }) }) }) };
}

function paymentsChain(existing: unknown[]) {
  return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: existing }) }) }) };
}

const BASE_PARAMS = {
  admissionId: "adm-1",
  hospitalId: "h1",
  amount: 5000,
  paymentMode: "cash",
  userId: "u1",
};

beforeEach(() => {
  mockFindAdmissionBill.mockReset();
  mockFrom.mockReset();
});

describe("syncAdvanceToBill — records an admission advance as a real bill payment", () => {
  it("returns null silently when the admission has no draft bill yet", async () => {
    mockFindAdmissionBill.mockResolvedValue(null);
    expect(await syncAdvanceToBill(BASE_PARAMS)).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("inserts the full amount and marks the bill partial when nothing was synced before", async () => {
    mockFindAdmissionBill.mockResolvedValue({ id: "bill-1" });
    const insertSpy = vi.fn().mockResolvedValue({ data: null });
    const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null }) });
    mockFrom.mockImplementation((table: string) => {
      if (table === "bills") {
        return { ...billChain({ id: "bill-1", paid_amount: 0, total_amount: 20000, balance_due: 20000, insurance_amount: 0 }), update: updateSpy };
      }
      if (table === "bill_payments") return { ...paymentsChain([]), insert: insertSpy };
      throw new Error(`unexpected table ${table}`);
    });

    const result = await syncAdvanceToBill(BASE_PARAMS);

    expect(result).toBe("bill-1");
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ amount: 5000, is_advance: true }));
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ paid_amount: 5000, balance_due: 15000, payment_status: "partial" }),
    );
  });

  it("is idempotent — skips entirely when the full amount was already synced", async () => {
    mockFindAdmissionBill.mockResolvedValue({ id: "bill-1" });
    const insertSpy = vi.fn();
    mockFrom.mockImplementation((table: string) => {
      if (table === "bills") return billChain({ id: "bill-1", paid_amount: 5000, total_amount: 20000, balance_due: 15000, insurance_amount: 0 });
      if (table === "bill_payments") return { ...paymentsChain([{ id: "p1", amount: 5000 }]), insert: insertSpy };
      throw new Error(`unexpected table ${table}`);
    });

    const result = await syncAdvanceToBill(BASE_PARAMS);
    expect(result).toBe("bill-1");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("syncs only the delta when a partial amount was already recorded", async () => {
    mockFindAdmissionBill.mockResolvedValue({ id: "bill-1" });
    const insertSpy = vi.fn().mockResolvedValue({ data: null });
    const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null }) });
    mockFrom.mockImplementation((table: string) => {
      if (table === "bills") return { ...billChain({ id: "bill-1", paid_amount: 2000, total_amount: 20000, balance_due: 18000, insurance_amount: 0 }), update: updateSpy };
      if (table === "bill_payments") return { ...paymentsChain([{ id: "p1", amount: 2000 }]), insert: insertSpy };
      throw new Error(`unexpected table ${table}`);
    });

    await syncAdvanceToBill(BASE_PARAMS); // amount: 5000, already synced: 2000
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ amount: 3000 }));
  });

  it("nets off the insurance share before computing the patient's balance due", async () => {
    mockFindAdmissionBill.mockResolvedValue({ id: "bill-1" });
    const insertSpy = vi.fn().mockResolvedValue({ data: null });
    const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null }) });
    mockFrom.mockImplementation((table: string) => {
      if (table === "bills") {
        // total 20000, insurance covers 15000 -> patient payable is 5000
        return { ...billChain({ id: "bill-1", paid_amount: 0, total_amount: 20000, balance_due: 20000, insurance_amount: 15000 }), update: updateSpy };
      }
      if (table === "bill_payments") return { ...paymentsChain([]), insert: insertSpy };
      throw new Error(`unexpected table ${table}`);
    });

    await syncAdvanceToBill({ ...BASE_PARAMS, amount: 5000 });
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ payment_status: "paid", balance_due: 0 }),
    );
  });

  it("normalises neft/cheque payment modes to net_banking for the bill_payments row", async () => {
    mockFindAdmissionBill.mockResolvedValue({ id: "bill-1" });
    const insertSpy = vi.fn().mockResolvedValue({ data: null });
    const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null }) });
    mockFrom.mockImplementation((table: string) => {
      if (table === "bills") return { ...billChain({ id: "bill-1", paid_amount: 0, total_amount: 20000, balance_due: 20000, insurance_amount: 0 }), update: updateSpy };
      if (table === "bill_payments") return { ...paymentsChain([]), insert: insertSpy };
      throw new Error(`unexpected table ${table}`);
    });

    await syncAdvanceToBill({ ...BASE_PARAMS, paymentMode: "neft" });
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ payment_mode: "net_banking" }));
  });
});

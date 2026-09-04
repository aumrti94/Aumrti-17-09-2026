import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom, mockPostCharge, mockGetInvestigationRate, mockFetchPolicy, mockResolveStatus } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockPostCharge: vi.fn(),
  mockGetInvestigationRate: vi.fn(),
  mockFetchPolicy: vi.fn(),
  mockResolveStatus: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));
vi.mock("@/hooks/useBillNumber", () => ({ generateBillNumber: vi.fn().mockResolvedValue("LAB-2026-0001") }));
vi.mock("@/lib/chargePosting", () => ({ postCharge: mockPostCharge }));
vi.mock("@/lib/investigationBilling", () => ({ getInvestigationRate: mockGetInvestigationRate }));
vi.mock("@/lib/ipdAncillaryGate", () => ({
  fetchIpdAncillaryPolicy: mockFetchPolicy,
  resolveChargePaymentStatus: mockResolveStatus,
}));

import { postAncillaryOrderCharges, chargeLabOrders } from "./ancillaryCharges";

beforeEach(() => {
  mockFrom.mockReset();
  mockPostCharge.mockReset();
  mockGetInvestigationRate.mockReset();
  mockFetchPolicy.mockReset();
  mockResolveStatus.mockReset();
});

describe("postAncillaryOrderCharges", () => {
  it("returns ok:true with no billId when there are no items to charge", async () => {
    mockFetchPolicy.mockResolvedValue({ lab: { mode: "post_paid" } });
    mockResolveStatus.mockReturnValue("advance_covered");

    const result = await postAncillaryOrderCharges({
      hospitalId: "h1", patientId: "p1", admissionId: "adm-1", service: "lab", items: [],
    });
    expect(result).toEqual({ ok: true, paymentStatus: "advance_covered", dedupeKeys: [] });
    expect(mockPostCharge).not.toHaveBeenCalled();
  });

  it("posts every item and returns the resolved bill id in post_paid mode", async () => {
    mockFetchPolicy.mockResolvedValue({ lab: { mode: "post_paid" } });
    mockResolveStatus.mockReturnValue("advance_covered");
    mockPostCharge
      .mockResolvedValueOnce({ success: true, billId: "bill-1" })
      .mockResolvedValueOnce({ success: true, billId: "bill-1" });

    const items = [
      { sourceId: "item-1", dedupeKey: "lab:item-1", description: "CBC", unitPrice: 300, gstPercent: 0 },
      { sourceId: "item-2", dedupeKey: "lab:item-2", description: "LFT", unitPrice: 500, gstPercent: 0 },
    ];
    const result = await postAncillaryOrderCharges({ hospitalId: "h1", patientId: "p1", admissionId: "adm-1", service: "lab", items });

    expect(result).toEqual({ ok: true, billId: "bill-1", paymentStatus: "advance_covered", dedupeKeys: ["lab:item-1", "lab:item-2"] });
    expect(mockPostCharge).toHaveBeenCalledTimes(2);
    expect(mockPostCharge).toHaveBeenCalledWith(expect.objectContaining({ debitAdvance: false, dedupeKey: "lab:item-1" }));
  });

  it("stops and reports failure — does not silently swallow it like the dialysis/physio callers do", async () => {
    mockFetchPolicy.mockResolvedValue({ lab: { mode: "post_paid" } });
    mockResolveStatus.mockReturnValue("advance_covered");
    mockPostCharge.mockResolvedValueOnce({ success: false, error: "GST rate missing" });

    const items = [{ sourceId: "item-1", dedupeKey: "lab:item-1", description: "CBC", unitPrice: 300, gstPercent: 0 }];
    const result = await postAncillaryOrderCharges({ hospitalId: "h1", patientId: "p1", admissionId: "adm-1", service: "lab", items });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("GST rate missing");
  });

  it("creates a separate receipt bill in pre_paid + separate-receipt mode, and posts every item onto it", async () => {
    mockFetchPolicy.mockResolvedValue({ lab: { mode: "pre_paid", receipt: "separate" } });
    mockResolveStatus.mockReturnValue("pending_payment");
    mockFrom.mockReturnValue({
      insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "receipt-1" }, error: null }) }) }),
    });
    mockPostCharge.mockResolvedValue({ success: true, billId: "receipt-1" });

    const items = [{ sourceId: "item-1", dedupeKey: "lab:item-1", description: "CBC", unitPrice: 300, gstPercent: 0 }];
    const result = await postAncillaryOrderCharges({ hospitalId: "h1", patientId: "p1", admissionId: "adm-1", service: "lab", items });

    expect(result.ok).toBe(true);
    expect(result.billId).toBe("receipt-1");
    expect(mockPostCharge).toHaveBeenCalledWith(expect.objectContaining({ billId: "receipt-1" }));
  });

  it("never wants a separate receipt for an OPD (non-admitted) patient, regardless of policy", async () => {
    mockFetchPolicy.mockResolvedValue({ lab: { mode: "pre_paid", receipt: "separate" } });
    mockResolveStatus.mockReturnValue("pending_payment");
    mockPostCharge.mockResolvedValue({ success: true, billId: "opd-bill" });

    const items = [{ sourceId: "item-1", dedupeKey: "lab:item-1", description: "CBC", unitPrice: 300, gstPercent: 0 }];
    await postAncillaryOrderCharges({ hospitalId: "h1", patientId: "p1", service: "lab", items }); // no admissionId

    expect(mockFrom).not.toHaveBeenCalled(); // no receipt bill created
  });
});

describe("chargeLabOrders — keyed per lab_order_item, not per order", () => {
  it("returns the empty result without querying when there are no order ids", async () => {
    const result = await chargeLabOrders({ hospitalId: "h1", patientId: "p1", orderIds: [] });
    expect(result).toEqual({ ok: true, paymentStatus: "advance_covered", dedupeKeys: [] });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("builds one charge item per lab_order_item with the dedupe key lab:{item.id}", async () => {
    mockFrom.mockReturnValue({
      select: () => ({ in: () => Promise.resolve({ data: [{ id: "item-1", lab_order_id: "order-1", lab_test_master: { test_name: "CBC" } }] }) }) },
    );
    mockGetInvestigationRate.mockResolvedValue({ rate: 300, gstPercent: 0 });
    mockFetchPolicy.mockResolvedValue({ lab: { mode: "post_paid" } });
    mockResolveStatus.mockReturnValue("advance_covered");
    mockPostCharge.mockResolvedValue({ success: true, billId: "bill-1" });

    const result = await chargeLabOrders({ hospitalId: "h1", patientId: "p1", admissionId: "adm-1", orderIds: ["order-1"] });
    expect(result.dedupeKeys).toEqual(["lab:item-1"]);
    expect(mockPostCharge).toHaveBeenCalledWith(expect.objectContaining({ description: "Lab: CBC", unitPrice: 300 }));
  });
});

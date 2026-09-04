import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom, mockGenerateBillNumber, mockAutoPostJournalEntry, mockRecalc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGenerateBillNumber: vi.fn(),
  mockAutoPostJournalEntry: vi.fn(),
  mockRecalc: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));
vi.mock("@/hooks/useBillNumber", () => ({ generateBillNumber: mockGenerateBillNumber }));
vi.mock("@/lib/accounting", () => ({ autoPostJournalEntry: mockAutoPostJournalEntry }));
vi.mock("@/lib/billTotals", () => ({ recalculateBillTotalsSafe: mockRecalc }));
// roundCurrency/calcGST are pure and already tested via currency.test.ts.

import { autoBillOpdInvestigation, getInvestigationRate } from "./investigationBilling";

function chain(data: unknown) {
  const p: any = Promise.resolve({ data });
  p.select = () => p; p.eq = () => p; p.ilike = () => p; p.limit = () => p; p.maybeSingle = () => Promise.resolve({ data });
  return p;
}

beforeEach(() => {
  mockFrom.mockReset();
  mockGenerateBillNumber.mockReset();
  mockAutoPostJournalEntry.mockReset();
  mockRecalc.mockReset();
});

describe("getInvestigationRate — priority chain: module master -> service_master -> hard default", () => {
  it("uses the lab_test_master fee when configured, at 0% GST (healthcare services)", async () => {
    mockFrom.mockReturnValue(chain({ fee: 350 }));
    expect(await getInvestigationRate("h1", "CBC", "lab")).toEqual({ rate: 350, gstPercent: 0 });
  });

  it("uses the radiology_study_master fee for a radiology lookup", async () => {
    mockFrom.mockReturnValue(chain({ fee: 1500 }));
    expect(await getInvestigationRate("h1", "X-Ray Chest", "radiology")).toEqual({ rate: 1500, gstPercent: 0 });
  });

  it("falls back to service_master when the module master has no configured fee", async () => {
    let call = 0;
    mockFrom.mockImplementation(() => {
      call++;
      if (call === 1) return chain(null); // lab_test_master miss
      return chain({ fee: 400, gst_percent: 18, gst_applicable: true }); // service_master hit
    });
    expect(await getInvestigationRate("h1", "CBC", "lab")).toEqual({ rate: 400, gstPercent: 18 });
  });

  it("falls back to the hard default and flags isDefaultRate when nothing is configured anywhere", async () => {
    mockFrom.mockReturnValue(chain(null));
    expect(await getInvestigationRate("h1", "Obscure Test", "lab")).toEqual({ rate: 200, gstPercent: 0, isDefaultRate: true });
    expect(await getInvestigationRate("h1", "Obscure Study", "radiology")).toEqual({ rate: 500, gstPercent: 0, isDefaultRate: true });
  });

  it("treats an unconfigured (non-applicable) GST as 0%, not the stored percent", async () => {
    let call = 0;
    mockFrom.mockImplementation(() => {
      call++;
      if (call === 1) return chain(null);
      return chain({ fee: 400, gst_percent: 18, gst_applicable: false });
    });
    expect((await getInvestigationRate("h1", "CBC", "lab")).gstPercent).toBe(0);
  });
});

describe("autoBillOpdInvestigation", () => {
  const BASE = {
    hospitalId: "h1", patientId: "p1", orderedBy: "u1",
    lineItems: [{ description: "CBC", itemType: "lab_test" as const, unitRate: 300, gstPercent: 0 }],
    billPrefix: "LAB", sourceModule: "lab", sourceId: "order-1",
  };

  it("skips IPD patients entirely — handled by the discharge sweep instead", async () => {
    const result = await autoBillOpdInvestigation({ ...BASE, admissionId: "adm-1" });
    expect(result).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("skips when there are no line items to bill", async () => {
    const result = await autoBillOpdInvestigation({ ...BASE, lineItems: [] });
    expect(result).toBeNull();
  });

  it("is idempotent — returns null when the order is already billed", async () => {
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { billing_status: "billed" } }) }) }) });
    expect(await autoBillOpdInvestigation(BASE)).toBeNull();
  });

  it("creates a new bill, posts a non-blocking journal entry, and marks the order billed", async () => {
    const lineInsert = vi.fn().mockResolvedValue({ data: null });
    const orderUpdateEq = vi.fn().mockResolvedValue({});
    mockGenerateBillNumber.mockResolvedValue("LAB-2026-0001");
    mockFrom.mockImplementation((table: string) => {
      if (table === "lab_orders") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { billing_status: "unbilled" } }) }) }),
          update: () => ({ eq: orderUpdateEq }),
        };
      }
      if (table === "bills") return { insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "bill-1" }, error: null }) }) }) };
      if (table === "bill_line_items") return { insert: lineInsert };
      throw new Error(`unexpected table ${table}`);
    });

    const result = await autoBillOpdInvestigation(BASE);
    expect(result).toEqual({ billId: "bill-1", total: 300 });
    expect(mockAutoPostJournalEntry).toHaveBeenCalledWith(expect.objectContaining({ triggerEvent: "bill_finalized_lab" }));
    expect(orderUpdateEq).toHaveBeenCalledWith("id", "order-1");
  });

  it("appends to an existing open bill for the encounter rather than creating a second one", async () => {
    const lineInsert = vi.fn().mockResolvedValue({ data: null });
    mockRecalc.mockResolvedValue({ ok: true });
    mockFrom.mockImplementation((table: string) => {
      if (table === "lab_orders") return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { billing_status: "unbilled" } }) }) }), update: () => ({ eq: vi.fn().mockResolvedValue({}) }) };
      if (table === "bills") return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ in: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "existing-bill" } }) }) }) }) }) }) }) }) }) };
      if (table === "bill_line_items") return { insert: lineInsert };
      throw new Error(`unexpected table ${table}`);
    });

    const result = await autoBillOpdInvestigation({ ...BASE, encounterId: "enc-1" });
    expect(result?.billId).toBe("existing-bill");
    expect(mockGenerateBillNumber).not.toHaveBeenCalled();
    expect(mockRecalc).toHaveBeenCalledWith("existing-bill");
  });
});

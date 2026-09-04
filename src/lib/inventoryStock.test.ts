import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));

import { deductCentralFEFO, reverseCentral } from "./inventoryStock";

function batchesChain(rows: unknown[]) {
  return { select: () => ({ eq: () => ({ eq: () => ({ gt: () => ({ order: () => Promise.resolve({ data: rows }) }) }) }) }) };
}

function limitedBatchChain(rows: unknown[]) {
  return { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: rows }) }) }) }) }) };
}

const LEDGER = { transactionType: "issue" };

// Fallback for any table not explicitly handled by a test's dispatcher — a harmless empty
// result rather than a throw, since some Supabase mock chains see a stray extra call.
const NOOP = {
  select: () => ({
    eq: () => ({
      eq: () => ({ gt: () => ({ order: () => Promise.resolve({ data: [] }) }), order: () => ({ limit: () => Promise.resolve({ data: [] }) }) }),
      order: () => ({ limit: () => Promise.resolve({ data: [] }) }),
    }),
  }),
  update: () => ({ eq: () => Promise.resolve({}) }),
  insert: () => Promise.resolve({ error: null }),
};

beforeEach(() => mockFrom.mockReset());

describe("deductCentralFEFO — oldest-expiry-first stock deduction", () => {
  it("deducts fully from a single batch that has enough stock", async () => {
    const updateEq = vi.fn().mockResolvedValue({});
    const insertSpy = vi.fn().mockResolvedValue({ data: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "inventory_stock") return { ...batchesChain([{ id: "batch-1", quantity_available: 100, cost_price: 5 }]), update: () => ({ eq: updateEq }) };
      if (table === "stock_transactions") return { insert: insertSpy };
      return NOOP;
    });

    const result = await deductCentralFEFO({ hospitalId: "h1", itemId: "item-1", qty: 30, ledger: LEDGER });
    expect(result).toEqual({ deducted: 30, value: 150, short: 0 });
    expect(updateEq).toHaveBeenCalledWith("id", "batch-1");
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ quantity: -30, transaction_type: "issue" }));
  });

  it("spans multiple batches in expiry order when the first batch is insufficient", async () => {
    const updateCalls: any[] = [];
    mockFrom.mockImplementation((table: string) => {
      if (table === "inventory_stock") {
        return {
          ...batchesChain([
            { id: "batch-old", quantity_available: 10, cost_price: 5 },
            { id: "batch-new", quantity_available: 100, cost_price: 6 },
          ]),
          update: (payload: any) => ({ eq: (_col: string, val: string) => { updateCalls.push({ payload, val }); return Promise.resolve({}); } }),
        };
      }
      if (table === "stock_transactions") return { insert: vi.fn().mockResolvedValue({ data: null }) };
      return NOOP;
    });

    const result = await deductCentralFEFO({ hospitalId: "h1", itemId: "item-1", qty: 25, ledger: LEDGER });
    // 10 from the older batch (fully drained) + 15 from the newer one.
    expect(result).toEqual({ deducted: 25, value: 10 * 5 + 15 * 6, short: 0 });
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0]).toEqual({ payload: { quantity_available: 0 }, val: "batch-old" });
    expect(updateCalls[1]).toEqual({ payload: { quantity_available: 85 }, val: "batch-new" });
  });

  it("reports a shortage rather than deducting more than is on hand", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "inventory_stock") return { ...batchesChain([{ id: "batch-1", quantity_available: 5, cost_price: 5 }]), update: () => ({ eq: vi.fn().mockResolvedValue({}) }) };
      if (table === "stock_transactions") return { insert: vi.fn().mockResolvedValue({ data: null }) };
      return NOOP;
    });

    const result = await deductCentralFEFO({ hospitalId: "h1", itemId: "item-1", qty: 20, ledger: LEDGER });
    expect(result).toEqual({ deducted: 5, value: 25, short: 15 });
  });

  it("logs a stock_transactions row even when nothing was available (zero deduction)", async () => {
    const insertSpy = vi.fn().mockResolvedValue({ data: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "inventory_stock") return batchesChain([]);
      if (table === "stock_transactions") return { insert: insertSpy };
      return NOOP;
    });

    const result = await deductCentralFEFO({ hospitalId: "h1", itemId: "item-1", qty: 10, ledger: LEDGER });
    expect(result).toEqual({ deducted: 0, value: 0, short: 10 });
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ quantity: -0 }));
  });
});

describe("reverseCentral — reverses a prior consumption back onto the earliest-expiry batch", () => {
  it("adds the quantity back to the earliest-expiry batch and logs a positive transaction", async () => {
    const updateEq = vi.fn().mockResolvedValue({});
    const insertSpy = vi.fn().mockResolvedValue({ data: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "inventory_stock") return { ...limitedBatchChain([{ id: "batch-1", quantity_available: 20 }]), update: () => ({ eq: updateEq }) };
      if (table === "stock_transactions") return { insert: insertSpy };
      return NOOP;
    });

    await reverseCentral({ hospitalId: "h1", itemId: "item-1", qty: 5, ledger: LEDGER });
    expect(updateEq).toHaveBeenCalledWith("id", "batch-1");
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ quantity: 5 }));
  });

  it("still logs the transaction even when there is no batch to credit back to", async () => {
    const insertSpy = vi.fn().mockResolvedValue({ data: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "inventory_stock") return limitedBatchChain([]);
      if (table === "stock_transactions") return { insert: insertSpy };
      return NOOP;
    });

    await reverseCentral({ hospitalId: "h1", itemId: "item-1", qty: 5, ledger: LEDGER });
    expect(insertSpy).toHaveBeenCalled();
  });
});

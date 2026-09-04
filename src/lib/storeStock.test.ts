import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));

import { planTakes, issueStoreStock, returnStoreStock } from "./storeStock";

function emptyChain(): any {
  const p: any = Promise.resolve({ data: [] });
  for (const m of ["select", "eq", "in", "not", "order", "limit", "is", "gt"]) p[m] = () => p;
  p.maybeSingle = () => Promise.resolve({ data: null });
  return p;
}
const NOOP = { select: () => emptyChain(), insert: () => emptyChain(), update: () => emptyChain() };

beforeEach(() => mockFrom.mockReset());

describe("planTakes — FEFO allocation across a source's batches", () => {
  const batch = (id: string, qty: number) => ({ id, batch_number: `B-${id}`, expiry_date: "2027-01-01", quantity_available: qty, cost_price: 10 });

  it("takes fully from the first batch when it has enough", () => {
    const result = planTakes([batch("b1", 100)], 30);
    expect(result).toEqual({ takes: [{ batch: batch("b1", 100), take: 30 }], short: false, available: 100 });
  });

  it("spans multiple batches in the given (expiry) order when the first is insufficient", () => {
    const result = planTakes([batch("b1", 10), batch("b2", 100)], 25);
    expect(result.takes).toEqual([{ batch: batch("b1", 10), take: 10 }, { batch: batch("b2", 100), take: 15 }]);
    expect(result.short).toBe(false);
  });

  it("reports a shortage with total available when batches don't cover the request", () => {
    const result = planTakes([batch("b1", 5), batch("b2", 3)], 20);
    expect(result.short).toBe(true);
    expect(result.available).toBe(8);
  });

  it("returns no takes and no shortage for a zero-quantity request", () => {
    const result = planTakes([batch("b1", 10)], 0);
    expect(result.takes).toEqual([]);
    expect(result.short).toBe(false);
  });
});

describe("issueStoreStock — all-or-nothing store issue", () => {
  it("returns ok:true without touching anything when there are no linked items", async () => {
    const result = await issueStoreStock(
      { hospitalId: "h1", supplierStoreId: "central", supplierIsCentral: true, requesterStoreId: "ward-1", movedById: "u1", indentId: "ind-1" },
      [{ item_id: null, item_name: "Free-text item", quantity: 5 }],
    );
    expect(result).toEqual({ ok: true, shortages: [] });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("refuses the whole batch (all-or-nothing) and moves nothing when any item is short", async () => {
    const updateSpy = vi.fn();
    mockFrom.mockImplementation((table: string) => {
      if (table === "inventory_stock") return { ...emptyChain(), select: () => ({ eq: () => ({ eq: () => ({ gt: () => ({ order: () => Promise.resolve({ data: [{ id: "b1", quantity_available: 2, cost_price: 10 }] }) }) }) }) }), update: updateSpy };
      return NOOP;
    });

    const result = await issueStoreStock(
      { hospitalId: "h1", supplierStoreId: "central", supplierIsCentral: true, requesterStoreId: "ward-1", movedById: "u1", indentId: "ind-1" },
      [{ item_id: "item-1", item_name: "Paracetamol", quantity: 10 }],
    );

    expect(result.ok).toBe(false);
    expect(result.shortages).toEqual([{ item_name: "Paracetamol", requested: 10, available: 2 }]);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("deducts the central supplier, credits the requesting ward, and logs a central transaction on success", async () => {
    const centralUpdate = vi.fn().mockReturnValue({ eq: () => Promise.resolve({}) });
    const storeStockInsert = vi.fn().mockResolvedValue({ data: null });
    const txnInsert = vi.fn().mockResolvedValue({ data: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "inventory_stock") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ gt: () => ({ order: () => Promise.resolve({ data: [{ id: "b1", batch_number: "B1", expiry_date: "2027-01-01", quantity_available: 50, cost_price: 10 }] }) }) }) }) }),
          update: centralUpdate,
        };
      }
      if (table === "store_stock") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }) }) }) }),
          insert: storeStockInsert,
        };
      }
      if (table === "stock_transactions") return { insert: txnInsert };
      return NOOP;
    });

    const result = await issueStoreStock(
      { hospitalId: "h1", supplierStoreId: "central", supplierIsCentral: true, requesterStoreId: "ward-1", movedById: "u1", indentId: "ind-1", indentNumber: "IND-001" },
      [{ item_id: "item-1", item_name: "Paracetamol", quantity: 20 }],
    );

    expect(result).toEqual({ ok: true, shortages: [] });
    expect(centralUpdate).toHaveBeenCalledWith({ quantity_available: 30 });
    expect(storeStockInsert).toHaveBeenCalledWith(expect.objectContaining({ store_id: "ward-1", item_id: "item-1", quantity_available: 20 }));
    expect(txnInsert).toHaveBeenCalledWith(expect.objectContaining({ transaction_type: "store_issue", quantity: -20 }));
  });
});

describe("returnStoreStock", () => {
  it("returns ok:true without querying when there are no linked items", async () => {
    const result = await returnStoreStock(
      { hospitalId: "h1", returningStoreId: "ward-1", supplierStoreId: "central", supplierIsCentral: true, movedById: "u1", indentId: "ind-1" },
      [],
    );
    expect(result).toEqual({ ok: true, shortages: [] });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("reports a shortage without moving anything when the ward doesn't actually hold enough to return", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "store_stock") return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ gt: () => ({ order: () => Promise.resolve({ data: [{ id: "b1", quantity_available: 1, cost_price: 10 }] }) }) }) }) }) }) };
      return NOOP;
    });

    const result = await returnStoreStock(
      { hospitalId: "h1", returningStoreId: "ward-1", supplierStoreId: "central", supplierIsCentral: true, movedById: "u1", indentId: "ind-1" },
      [{ item_id: "item-1", item_name: "Paracetamol", quantity: 5 }],
    );
    expect(result.ok).toBe(false);
    expect(result.shortages[0].available).toBe(1);
  });
});

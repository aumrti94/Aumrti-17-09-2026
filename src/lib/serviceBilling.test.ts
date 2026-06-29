import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase mock (vi.hoisted so factories run before module resolution) ───────
const { mockFrom, mockRpc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc:  vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mockFrom,
    rpc:  mockRpc,
  },
}));

// Generate bill number hook: return a stable value
vi.mock("@/hooks/useBillNumber", () => ({
  generateBillNumber: vi.fn().mockResolvedValue("OPD-2026-001"),
}));

// Accounting: no-op for tests
vi.mock("@/lib/accounting", () => ({
  autoPostJournalEntry: vi.fn().mockResolvedValue(undefined),
}));

// Bill totals: no-op for tests
vi.mock("@/lib/billTotals", () => ({
  recalculateBillTotalsSafe: vi.fn().mockResolvedValue(undefined),
}));

import { autoChargeService } from "./serviceBilling";
import { recalculateBillTotalsSafe } from "@/lib/billTotals";

// ── Query builder chain factory ───────────────────────────────────────────────
// Uses a Proxy so that ANY method call returns the same proxy, enabling
// unlimited chaining (.eq().eq().in().order().limit()…) without pre-defining
// each method. Only `maybeSingle`, `single`, `then`, and `catch` are real ops.
function makeChain(returnValue: unknown) {
  const asPromise = Promise.resolve(returnValue as any);

  function buildProxy(): any {
    return new Proxy({} as any, {
      get(_: any, prop: string) {
        if (prop === "maybeSingle") return vi.fn().mockResolvedValue(returnValue);
        if (prop === "single")      return vi.fn().mockResolvedValue(returnValue);
        if (prop === "then")        return asPromise.then.bind(asPromise);
        if (prop === "catch")       return asPromise.catch.bind(asPromise);
        // Any other method (eq, in, order, select, insert, update, etc.)
        // returns a new proxy so chaining is unlimited
        return vi.fn().mockReturnValue(buildProxy());
      },
    });
  }

  return buildProxy();
}

const H_ID  = "hosp-uuid";
const P_ID  = "pat-uuid";
const ADM_ID = "adm-uuid";
const ENC_ID  = "enc-uuid";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Idempotency ───────────────────────────────────────────────────────────────
describe("autoChargeService — idempotency guard", () => {
  it("returns null when source record is already billed", async () => {
    mockFrom.mockReturnValue(makeChain({ data: { billing_status: "billed" }, error: null }));

    const result = await autoChargeService({
      hospitalId: H_ID,
      patientId:  P_ID,
      serviceName: "Physiotherapy",
      serviceModule: "physiotherapy",
      sourceTable: "physiotherapy_sessions",
      sourceId: "session-uuid",
      unitRate: 500,
    });

    expect(result).toBeNull();
  });
});

// ── Amount calculation ─────────────────────────────────────────────────────────
describe("autoChargeService — amount calculation", () => {
  function setupForBilling(billId = "bill-uuid") {
    // Source not billed, IPD bill found, line item inserted OK, update source billing_status OK
    mockFrom.mockImplementation((table: string) => {
      if (table === "bills") {
        return makeChain({ data: { id: billId }, error: null });
      }
      if (table === "bill_line_items") {
        return makeChain({ data: { id: "line-uuid" }, error: null });
      }
      // service_charges update / source table update
      return makeChain({ data: {}, error: null });
    });
  }

  it("calculates 18% GST on ₹1000 unit rate → total ₹1180", async () => {
    setupForBilling();

    const result = await autoChargeService({
      hospitalId:    H_ID,
      patientId:     P_ID,
      admissionId:   ADM_ID,
      serviceName:   "Dialysis",
      serviceModule: "dialysis",
      unitRate:      1000,
      gstPercent:    18,
    });

    // result?.total should be 1180 (taxable 1000 + GST 180)
    expect(result?.total).toBe(1180);
  });

  it("calculates correct total for quantity > 1", async () => {
    setupForBilling();

    const result = await autoChargeService({
      hospitalId:    H_ID,
      patientId:     P_ID,
      admissionId:   ADM_ID,
      serviceName:   "Physiotherapy",
      serviceModule: "physiotherapy",
      unitRate:      200,
      gstPercent:    0,
      quantity:      3,
    });

    // 200 * 3 = 600, GST 0
    expect(result?.total).toBe(600);
  });
});

// ── Bill routing ───────────────────────────────────────────────────────────────
describe("autoChargeService — bill routing", () => {
  it("routes to existing IPD bill when admissionId is provided", async () => {
    const ipdBillId = "ipd-bill-uuid";
    mockFrom.mockImplementation((table: string) => {
      if (table === "bills")
        return makeChain({ data: { id: ipdBillId }, error: null });
      return makeChain({ data: {}, error: null });
    });

    const result = await autoChargeService({
      hospitalId:    H_ID,
      patientId:     P_ID,
      admissionId:   ADM_ID,
      serviceName:   "Dialysis",
      serviceModule: "dialysis",
      unitRate:      500,
    });

    expect(result?.billId).toBe(ipdBillId);
    expect(result?.isNewBill).toBe(false);
  });

  it("routes to OPD bill when only encounterId is provided (no admissionId)", async () => {
    const opdBillId = "opd-bill-uuid";
    // no existing OPD bill → create one
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "bills") {
        callCount++;
        if (callCount === 1) {
          // First call: findOrCreateOpdBill SELECT → no existing bill
          return makeChain({ data: null, error: null });
        }
        // Second call: INSERT new bill
        return makeChain({ data: { id: opdBillId }, error: null });
      }
      return makeChain({ data: {}, error: null });
    });

    const result = await autoChargeService({
      hospitalId:   H_ID,
      patientId:    P_ID,
      encounterId:  ENC_ID,
      serviceName:  "Consultation",
      serviceModule: "opd",
      unitRate:     300,
    });

    expect(result?.billId).toBeDefined();
  });

  it("returns null and records unbilled service when unit rate is 0 (unconfigured)", async () => {
    // Source check: not billed
    // Rate lookup: 0
    mockFrom.mockReturnValue(makeChain({ data: null, error: null }));

    const result = await autoChargeService({
      hospitalId:    H_ID,
      patientId:     P_ID,
      serviceName:   "Unconfigured Service",
      serviceModule: "other",
      unitRate:      0,
    });

    expect(result).toBeNull();
  });
});

// ── Post-billing hooks ─────────────────────────────────────────────────────────
describe("autoChargeService — post-billing hooks", () => {
  it("calls recalculateBillTotalsSafe after successful line item insert", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "bills")
        return makeChain({ data: { id: "bill-uuid" }, error: null });
      return makeChain({ data: {}, error: null });
    });

    await autoChargeService({
      hospitalId:    H_ID,
      patientId:     P_ID,
      admissionId:   ADM_ID,
      serviceName:   "Physio",
      serviceModule: "physiotherapy",
      unitRate:      400,
    });

    // recalculateBillTotalsSafe(billId) — single arg (hospitalId not passed)
    expect(recalculateBillTotalsSafe).toHaveBeenCalledWith(expect.any(String));
  });
});

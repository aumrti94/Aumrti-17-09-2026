import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom, mockCheckClearance } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockCheckClearance: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));
vi.mock("@/lib/ancillaryGateChecks", () => ({ checkLabOrderClearance: mockCheckClearance }));

import { resolveOrderBarcode, collectOrderSamples, receiveOrderSamples, startOrderProcessing, rejectSample, LabPaymentPendingError } from "./labSamples";

const NOOP = {
  select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }), in: () => Promise.resolve({ data: [] }), limit: () => Promise.resolve({ data: [] }) }) }),
  update: () => ({ eq: () => ({ eq: () => Promise.resolve({}), in: () => Promise.resolve({}) }) }),
  insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
};

beforeEach(() => {
  mockFrom.mockReset();
  mockCheckClearance.mockReset();
});

describe("resolveOrderBarcode", () => {
  it("uses the order's own accession number when it has one", async () => {
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { accession_number: "ACC-001" } }) }) }) });
    expect(await resolveOrderBarcode("order-1")).toBe("ACC-001");
  });

  it("falls back to LAB-<uhid>-<id8> for a legacy order with no accession number", async () => {
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) });
    const barcode = await resolveOrderBarcode("order-12345678-abcd", "UHID 001");
    expect(barcode).toBe("LAB-UHID001-ORDER-12");
  });
});

describe("collectOrderSamples — the block point for lab sample collection", () => {
  it("throws LabPaymentPendingError when the order isn't cleared for payment and no override was given", async () => {
    mockCheckClearance.mockResolvedValue({ cleared: false, unpaidAmount: 500, overrideAvailable: true, reason: "unpaid" });
    await expect(collectOrderSamples({ orderId: "order-1", userId: "u1" })).rejects.toBeInstanceOf(LabPaymentPendingError);
  });

  it("carries the unpaid amount and override flag on the thrown error", async () => {
    mockCheckClearance.mockResolvedValue({ cleared: false, unpaidAmount: 750, overrideAvailable: false, reason: "unpaid" });
    try {
      await collectOrderSamples({ orderId: "order-1", userId: "u1" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(LabPaymentPendingError);
      expect((e as LabPaymentPendingError).unpaidAmount).toBe(750);
      expect((e as LabPaymentPendingError).overrideAvailable).toBe(false);
    }
  });

  it("skips the clearance check entirely when overridden:true (override already audited)", async () => {
    mockFrom.mockReturnValue({ ...NOOP, select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { accession_number: "ACC-1" } }) }) }) });
    await collectOrderSamples({ orderId: "order-1", userId: "u1", overridden: true });
    expect(mockCheckClearance).not.toHaveBeenCalled();
  });

  it("returns the barcode and updates items/order/samples to collected when cleared", async () => {
    mockCheckClearance.mockResolvedValue({ cleared: true, unpaidAmount: 0, overrideAvailable: false, reason: "" });
    const itemsUpdate = vi.fn().mockReturnValue({ eq: () => ({ in: () => Promise.resolve({}) }) });
    const orderUpdate = vi.fn().mockReturnValue({ eq: () => ({ eq: () => Promise.resolve({}) }) });
    const samplesUpdate = vi.fn().mockReturnValue({ eq: () => ({ eq: () => Promise.resolve({}) }) });
    mockFrom.mockImplementation((table: string) => {
      if (table === "lab_orders") return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { accession_number: "ACC-99" } }) }) }), update: orderUpdate };
      if (table === "lab_order_items") return { update: itemsUpdate };
      if (table === "lab_samples") return { update: samplesUpdate };
      return NOOP;
    });

    const barcode = await collectOrderSamples({ orderId: "order-1", userId: "u1" });
    expect(barcode).toBe("ACC-99");
    expect(itemsUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "sample_collected" }));
    expect(samplesUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "collected" }));
  });
});

describe("receiveOrderSamples / startOrderProcessing — simple status transitions", () => {
  it("moves collected samples to received", async () => {
    const updateSpy = vi.fn().mockReturnValue({ eq: () => ({ eq: () => Promise.resolve({}) }) });
    mockFrom.mockReturnValue({ update: updateSpy });
    await receiveOrderSamples({ orderId: "order-1", userId: "u1" });
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "received" }));
  });

  it("moves received samples, items, and the order into processing", async () => {
    const updateSpy = vi.fn().mockReturnValue({ eq: () => ({ eq: () => Promise.resolve({}), in: () => Promise.resolve({}) }) });
    mockFrom.mockReturnValue({ update: updateSpy });
    await startOrderProcessing({ orderId: "order-1", userId: "u1" });
    expect(updateSpy).toHaveBeenCalledWith({ status: "processing" });
    expect(updateSpy).toHaveBeenCalledWith({ status: "in_process" });
  });
});

describe("rejectSample — reject + linked recollection, winding back the order only if nothing else is viable", () => {
  const SAMPLE = { id: "s1", hospital_id: "h1", lab_order_id: "order-1", sample_type: "Blood", barcode: "LAB-001" };

  it("throws when the sample can't be resolved", async () => {
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) });
    await expect(rejectSample({ sampleId: "missing", userId: "u1", reason: "Clotted" })).rejects.toThrow("Sample not found");
  });

  it("creates a linked recollection sample carrying the reject reason forward via barcode suffix", async () => {
    let insertedRow: any;
    mockFrom.mockImplementation((table: string) => {
      if (table === "lab_samples") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: SAMPLE }), in: () => ({ limit: () => Promise.resolve({ data: [{ id: "other-sample" }] }) }) }) }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          insert: (row: any) => { insertedRow = row; return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "recollect-1" }, error: null }) }) }; },
        };
      }
      return NOOP;
    });

    const result = await rejectSample({ sampleId: "s1", userId: "u1", reason: "Clotted" });
    expect(result).toEqual({ recollectionSampleId: "recollect-1" });
    expect(insertedRow.recollected_from_sample_id).toBe("s1");
    expect(insertedRow.status).toBe("pending");
  });

  it("winds the order and items back to 'ordered' when no other viable sample remains", async () => {
    const itemsUpdate = vi.fn().mockReturnValue({ eq: () => ({ eq: () => Promise.resolve({}) }) });
    const orderUpdate = vi.fn().mockReturnValue({ eq: () => ({ eq: () => Promise.resolve({}) }) });
    mockFrom.mockImplementation((table: string) => {
      if (table === "lab_samples") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: SAMPLE }), in: () => ({ limit: () => Promise.resolve({ data: [] }) }) }) }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "recollect-1" }, error: null }) }) }),
        };
      }
      if (table === "lab_order_items") return { update: itemsUpdate };
      if (table === "lab_orders") return { update: orderUpdate };
      return NOOP;
    });

    await rejectSample({ sampleId: "s1", userId: "u1", reason: "Clotted" });
    expect(itemsUpdate).toHaveBeenCalledWith({ status: "ordered" });
    expect(orderUpdate).toHaveBeenCalledWith({ status: "ordered" });
  });

  it("does NOT wind the order back when another viable sample still covers it", async () => {
    const itemsUpdate = vi.fn();
    mockFrom.mockImplementation((table: string) => {
      if (table === "lab_samples") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: SAMPLE }), in: () => ({ limit: () => Promise.resolve({ data: [{ id: "still-viable" }] }) }) }) }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "recollect-1" }, error: null }) }) }),
        };
      }
      if (table === "lab_order_items") return { update: itemsUpdate };
      return NOOP;
    });

    await rejectSample({ sampleId: "s1", userId: "u1", reason: "Clotted" });
    expect(itemsUpdate).not.toHaveBeenCalled();
  });
});

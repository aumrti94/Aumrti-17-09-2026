import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom, mockFindOrCreateBill, mockRecalc, mockGetWardRate } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockFindOrCreateBill: vi.fn(),
  mockRecalc: vi.fn(),
  mockGetWardRate: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));
vi.mock("@/lib/admissionBill", () => ({ findOrCreateAdmissionBill: mockFindOrCreateBill }));
vi.mock("@/lib/billTotals", () => ({ recalculateBillTotalsSafe: mockRecalc }));
vi.mock("@/lib/wardNursingRate", () => ({ getWardNursingRate: mockGetWardRate }));

import { addSpecialNursingCharge, fetchWardNursingRate } from "./ipdNursingCharge";

const BASE_OPTS = {
  hospitalId: "h1",
  patientId: "p1",
  admissionId: "adm-1",
  date: "2026-08-24",
  days: 3,
  rate: 1500,
};

beforeEach(() => {
  mockFrom.mockReset();
  mockFindOrCreateBill.mockReset();
  mockRecalc.mockReset();
  mockGetWardRate.mockReset();
});

describe("addSpecialNursingCharge — validation", () => {
  it("rejects when hospital, patient, or admission is missing", async () => {
    const result = await addSpecialNursingCharge({ ...BASE_OPTS, admissionId: "" });
    expect(result.ok).toBe(false);
    expect(mockFindOrCreateBill).not.toHaveBeenCalled();
  });

  it("rejects a zero or negative rate", async () => {
    const result = await addSpecialNursingCharge({ ...BASE_OPTS, rate: 0 });
    expect(result).toEqual({ ok: false, error: "Nursing rate must be greater than zero" });
  });
});

describe("addSpecialNursingCharge — happy path", () => {
  it("deletes any existing line under the per-date dedupe key, then inserts the new one", async () => {
    mockFindOrCreateBill.mockResolvedValue({ id: "bill-1" });
    const deleteSpy = vi.fn().mockReturnValue({ eq: () => ({ eq: () => Promise.resolve({}) }) });
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ delete: deleteSpy, insert: insertSpy });
    mockRecalc.mockResolvedValue({ ok: true });

    const result = await addSpecialNursingCharge(BASE_OPTS);

    expect(deleteSpy).toHaveBeenCalled();
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ source_dedupe_key: "ipd_nursing_special:2026-08-24", gst_percent: 0 }),
    );
    expect(result).toEqual({ ok: true, billId: "bill-1", amount: 4500 }); // 1500 * 3 days
  });

  it("floors a fractional days value and never charges less than 1 day", async () => {
    mockFindOrCreateBill.mockResolvedValue({ id: "bill-1" });
    let inserted: any;
    mockFrom.mockReturnValue({
      delete: () => ({ eq: () => ({ eq: () => Promise.resolve({}) }) }),
      insert: (row: any) => {
        inserted = row;
        return Promise.resolve({ error: null });
      },
    });
    mockRecalc.mockResolvedValue({ ok: true });

    await addSpecialNursingCharge({ ...BASE_OPTS, days: 0.4 });
    expect(inserted.quantity).toBe(1);
  });

  it("surfaces a bill-recalculation failure rather than reporting success", async () => {
    mockFindOrCreateBill.mockResolvedValue({ id: "bill-1" });
    mockFrom.mockReturnValue({
      delete: () => ({ eq: () => ({ eq: () => Promise.resolve({}) }) }),
      insert: () => Promise.resolve({ error: null }),
    });
    mockRecalc.mockResolvedValue({ ok: false, error: "recalc failed" });

    const result = await addSpecialNursingCharge(BASE_OPTS);
    expect(result).toEqual({ ok: false, billId: "bill-1", error: "recalc failed" });
  });

  it("catches an unexpected exception rather than propagating it", async () => {
    mockFindOrCreateBill.mockRejectedValue(new Error("db unreachable"));
    const result = await addSpecialNursingCharge(BASE_OPTS);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("db unreachable");
  });
});

describe("fetchWardNursingRate — prefill only, never the ceiling", () => {
  it("resolves the ward name and rate for the admission's ward", async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { ward_id: "w1", wards: { name: "ICU" } } }) }) }),
    });
    mockGetWardRate.mockResolvedValue(2000);

    const result = await fetchWardNursingRate("adm-1");
    expect(result).toEqual({ rate: 2000, wardName: "ICU" });
  });

  it("returns an empty ward name and rate 0 when the admission has no ward", async () => {
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) });
    mockGetWardRate.mockResolvedValue(0);

    const result = await fetchWardNursingRate("adm-1");
    expect(result).toEqual({ rate: 0, wardName: "" });
  });
});

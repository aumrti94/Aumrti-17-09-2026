import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom, mockFindOrCreateBill, mockRecalc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockFindOrCreateBill: vi.fn(),
  mockRecalc: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));
vi.mock("@/lib/admissionBill", () => ({ findOrCreateAdmissionBill: mockFindOrCreateBill }));
vi.mock("@/lib/billTotals", () => ({ recalculateBillTotalsSafe: mockRecalc }));
// calcGST is pure and already tested via currency.test.ts — use the real implementation.

import { addManualConsultationCharge, fetchConsultationDoctors } from "./ipdConsultationCharge";

const BASE_OPTS = {
  hospitalId: "h1",
  patientId: "p1",
  admissionId: "adm-1",
  doctorId: "doc-1",
  doctorName: "Rao",
  date: "2026-08-24",
  visits: 2,
  fee: 500,
  gstPercent: 0,
};

beforeEach(() => {
  mockFrom.mockReset();
  mockFindOrCreateBill.mockReset();
  mockRecalc.mockReset();
});

describe("addManualConsultationCharge — validation", () => {
  it("rejects when no doctor is selected", async () => {
    const result = await addManualConsultationCharge({ ...BASE_OPTS, doctorId: "" });
    expect(result).toEqual({ ok: false, error: "Select a doctor" });
  });

  it("rejects a zero or negative fee", async () => {
    const result = await addManualConsultationCharge({ ...BASE_OPTS, fee: 0 });
    expect(result).toEqual({ ok: false, error: "Consultation fee must be greater than zero" });
  });
});

describe("addManualConsultationCharge — happy path", () => {
  it("writes the sweep-compatible dedupe key so a later ward-round save can safely replace it", async () => {
    mockFindOrCreateBill.mockResolvedValue({ id: "bill-1" });
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ delete: () => ({ eq: () => ({ eq: () => Promise.resolve({}) }) }), insert: insertSpy });
    mockRecalc.mockResolvedValue({ ok: true });

    const result = await addManualConsultationCharge(BASE_OPTS);

    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        source_module: "ipd_visit",
        source_dedupe_key: "ipd_visit:doc-1:2026-08-24",
        source_record_id: "doc-1",
      }),
    );
    expect(result).toEqual({ ok: true, billId: "bill-1", amount: 1000 }); // 500 * 2 visits, 0% GST
  });

  it("computes GST on top of the taxable visit total when a rate is configured", async () => {
    mockFindOrCreateBill.mockResolvedValue({ id: "bill-1" });
    let inserted: any;
    mockFrom.mockReturnValue({
      delete: () => ({ eq: () => ({ eq: () => Promise.resolve({}) }) }),
      insert: (row: any) => { inserted = row; return Promise.resolve({ error: null }); },
    });
    mockRecalc.mockResolvedValue({ ok: true });

    const result = await addManualConsultationCharge({ ...BASE_OPTS, visits: 1, fee: 1000, gstPercent: 18 });
    expect(inserted.taxable_amount).toBe(1000);
    expect(inserted.gst_amount).toBe(180);
    expect(result.amount).toBe(1180);
  });

  it("surfaces a bill-recalculation failure rather than reporting success", async () => {
    mockFindOrCreateBill.mockResolvedValue({ id: "bill-1" });
    mockFrom.mockReturnValue({
      delete: () => ({ eq: () => ({ eq: () => Promise.resolve({}) }) }),
      insert: () => Promise.resolve({ error: null }),
    });
    mockRecalc.mockResolvedValue({ ok: false, error: "recalc failed" });

    const result = await addManualConsultationCharge(BASE_OPTS);
    expect(result).toEqual({ ok: false, billId: "bill-1", error: "recalc failed" });
  });
});

describe("fetchConsultationDoctors — doctor picker with prefilled fees", () => {
  it("resolves fee/GST from configured consultation services, preferring the IPD-specific fee", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "service_master") {
        return {
          select: () => ({
            eq: () => ({
              not: () => ({
                ilike: () => Promise.resolve({
                  data: [{ doctor_id: "doc-1", fee: 500, ipd_consultation_fee: 800, gst_percent: 18, gst_applicable: true, hsn_code: "999312" }],
                }),
              }),
            }),
          }),
        };
      }
      if (table === "users") {
        return { select: () => ({ in: () => Promise.resolve({ data: [{ id: "doc-1", full_name: "Rao" }] }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await fetchConsultationDoctors("h1");
    expect(result).toEqual([
      { doctorId: "doc-1", doctorName: "Rao", fee: 800, gstPercent: 18, hsnCode: "999312" },
    ]);
  });

  it("folds in the attending doctor at ₹0 when they have no configured consultation service", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "service_master") {
        return { select: () => ({ eq: () => ({ not: () => ({ ilike: () => Promise.resolve({ data: [] }) }) }) }) };
      }
      if (table === "admissions") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { admitting_doctor_id: "doc-2" } }) }) }) };
      }
      if (table === "users") {
        return { select: () => ({ in: () => Promise.resolve({ data: [{ id: "doc-2", full_name: "Iyer" }] }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await fetchConsultationDoctors("h1", "adm-1");
    expect(result).toEqual([{ doctorId: "doc-2", doctorName: "Iyer", fee: 0, gstPercent: 0, hsnCode: "999312" }]);
  });

  it("returns an empty list rather than querying users when there are no candidate doctors", async () => {
    const usersFrom = vi.fn();
    mockFrom.mockImplementation((table: string) => {
      if (table === "service_master") return { select: () => ({ eq: () => ({ not: () => ({ ilike: () => Promise.resolve({ data: [] }) }) }) }) };
      if (table === "users") return usersFrom();
      throw new Error(`unexpected table ${table}`);
    });

    const result = await fetchConsultationDoctors("h1");
    expect(result).toEqual([]);
    expect(usersFrom).not.toHaveBeenCalled();
  });
});

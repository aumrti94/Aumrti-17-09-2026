import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom, mockGetRateWithGst, mockRecordServiceCharge, mockRecordBillPayment } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGetRateWithGst: vi.fn(),
  mockRecordServiceCharge: vi.fn(),
  mockRecordBillPayment: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));
vi.mock("@/lib/serviceRates", () => ({
  getRateWithGst: mockGetRateWithGst,
  SERVICE_RATE_CODES: { REGISTRATION_FEE: "registration_fee" },
}));
vi.mock("@/lib/serviceBilling", () => ({ recordServiceCharge: mockRecordServiceCharge }));
vi.mock("@/lib/billPayments", () => ({ recordBillPayment: mockRecordBillPayment }));

import { getRegistrationFee, createAndPayRegistrationBill } from "./registrationBill";

beforeEach(() => {
  mockFrom.mockReset();
  mockGetRateWithGst.mockReset();
  mockRecordServiceCharge.mockReset();
  mockRecordBillPayment.mockReset();
});

describe("getRegistrationFee", () => {
  it("resolves the configured registration_fee rate + GST", async () => {
    mockGetRateWithGst.mockResolvedValue({ rate: 200, gst: 18 });
    const result = await getRegistrationFee("h1");
    expect(result).toEqual({ rate: 200, gst: 18 });
    expect(mockGetRateWithGst).toHaveBeenCalledWith("h1", "registration_fee", 0, 0);
  });
});

describe("createAndPayRegistrationBill", () => {
  const BASE_OPTS = {
    hospitalId: "h1",
    patientId: "p1",
    amount: 236, // GST-inclusive: 200 + 18%
    gstPercent: 18,
    mode: "cash",
    collectedBy: "u1",
  };

  it("refuses when the fee is not configured (0 or below)", async () => {
    const result = await createAndPayRegistrationBill({ ...BASE_OPTS, amount: 0 });
    expect(result).toEqual({ ok: false, error: "Registration fee is not configured." });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("creates a paid registration bill and records the payment on success", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "bills") {
        return {
          insert: () => ({
            select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "bill-1", bill_number: "REG-20260824-0001" }, error: null }) }),
          }),
        };
      }
      if (table === "bill_line_items") return { insert: vi.fn().mockResolvedValue({ data: null }) };
      throw new Error(`unexpected table ${table}`);
    });
    mockRecordBillPayment.mockResolvedValue({ ok: true });

    const result = await createAndPayRegistrationBill(BASE_OPTS);

    expect(result).toEqual({ ok: true, billNumber: "REG-20260824-0001" });
    expect(mockRecordServiceCharge).toHaveBeenCalledWith(
      expect.objectContaining({ serviceModule: "patient_registration", totalAmount: 236 }),
    );
    expect(mockRecordBillPayment).toHaveBeenCalledWith(
      expect.objectContaining({ billId: "bill-1", newPaymentStatus: "paid", newBalanceDue: 0 }),
    );
  });

  it("splits the GST-inclusive fee into taxable + GST amounts correctly", async () => {
    let insertedBill: any;
    mockFrom.mockImplementation((table: string) => {
      if (table === "bills") {
        return {
          insert: (payload: any) => {
            insertedBill = payload;
            return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "bill-1", bill_number: "REG-1" }, error: null }) }) };
          },
        };
      }
      if (table === "bill_line_items") return { insert: vi.fn().mockResolvedValue({ data: null }) };
      throw new Error(`unexpected table ${table}`);
    });
    mockRecordBillPayment.mockResolvedValue({ ok: true });

    await createAndPayRegistrationBill(BASE_OPTS); // 236 gross, 18% GST -> 200 taxable + 36 GST
    expect(insertedBill.subtotal).toBe(200);
    expect(insertedBill.gst_amount).toBe(36);
    expect(insertedBill.total_amount).toBe(236);
  });

  it("returns the bill error rather than proceeding when bill creation fails", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "bills") {
        return { insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: "insert failed" } }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await createAndPayRegistrationBill(BASE_OPTS);
    expect(result).toEqual({ ok: false, error: "insert failed" });
    expect(mockRecordBillPayment).not.toHaveBeenCalled();
  });

  it("surfaces a payment-recording failure, but still reports the bill number that was created", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "bills") {
        return { insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "bill-1", bill_number: "REG-1" }, error: null }) }) }) };
      }
      if (table === "bill_line_items") return { insert: vi.fn().mockResolvedValue({ data: null }) };
      throw new Error(`unexpected table ${table}`);
    });
    mockRecordBillPayment.mockResolvedValue({ ok: false, error: "payment gateway timeout" });

    const result = await createAndPayRegistrationBill(BASE_OPTS);
    expect(result).toEqual({ ok: false, billNumber: "REG-1", error: "payment gateway timeout" });
  });
});

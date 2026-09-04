import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockInvoke, mockFrom } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockFrom: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: mockInvoke }, from: mockFrom },
}));

import { generatePaymentLink } from "./paymentLinks";

const BASE_OPTS = {
  hospitalId: "h1",
  billId: "b1",
  patientId: "p1",
  patientName: "Jane Doe",
  amount: 2500,
};

beforeEach(() => {
  mockInvoke.mockReset();
  mockFrom.mockReset();
  vi.stubGlobal("location", { origin: "https://app.aumrti.example" });
});

describe("generatePaymentLink — Razorpay-first, always-persisted fallback", () => {
  it("uses the Razorpay short URL when Razorpay succeeds", async () => {
    mockInvoke.mockResolvedValue({
      data: { razorpay_link_id: "rzp_1", razorpay_link_url: "https://rzp.io/l/1", short_url: "https://rzp.io/s1" },
      error: null,
    });
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert: insertSpy });

    const result = await generatePaymentLink(BASE_OPTS);

    expect(result.isRazorpay).toBe(true);
    expect(result.url).toBe("https://rzp.io/s1");
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ razorpay_link_id: "rzp_1", short_url: "https://rzp.io/s1" }),
    );
  });

  it("falls back to the app's own /pay/:token route when Razorpay returns an error", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: "not configured" } });
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert: insertSpy });

    const result = await generatePaymentLink(BASE_OPTS);

    expect(result.isRazorpay).toBe(false);
    expect(result.url).toMatch(/^https:\/\/app\.aumrti\.example\/pay\/[0-9a-f-]+$/);
  });

  it("falls back to the local link when the Razorpay call throws outright", async () => {
    mockInvoke.mockRejectedValue(new Error("network down"));
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert: insertSpy });

    const result = await generatePaymentLink(BASE_OPTS);
    expect(result.isRazorpay).toBe(false);
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ razorpay_link_id: null }));
  });

  it("always persists a payment_links row, even on the local-link fallback path", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: "not configured" } });
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert: insertSpy });

    await generatePaymentLink(BASE_OPTS);
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ hospital_id: "h1", bill_id: "b1", amount: 2500 }),
    );
  });

  it("throws when the payment_links row cannot be persisted — a link that isn't recorded must not be returned", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: "not configured" } });
    mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: { message: "insert failed" } }) });

    await expect(generatePaymentLink(BASE_OPTS)).rejects.toEqual({ message: "insert failed" });
  });
});

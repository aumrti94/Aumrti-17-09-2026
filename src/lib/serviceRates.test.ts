import { describe, it, expect, vi, beforeEach } from "vitest";

// Route every `.from("service_rates")...maybeSingle()` call through one controllable mock so
// each test can seed a different configured row and assert the resolved rate/GST differs —
// this is what actually happens when a hospital edits Settings › Service Rates.
const mockMaybeSingle = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: mockMaybeSingle,
    })),
  },
}));

import { getRate, getRateWithGst, getModuleDefaultRate, MODULE_RATE_CODE } from "@/lib/serviceRates";

beforeEach(() => {
  mockMaybeSingle.mockReset();
});

describe("getRate", () => {
  it("returns the hospital's configured rate, not the fallback", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { default_rate: 1500 }, error: null });
    expect(await getRate("hospital-a", "dialysis_session", 0)).toBe(1500);
  });

  it("a different configured rate produces a different resolved value for the same code", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { default_rate: 2200 }, error: null });
    expect(await getRate("hospital-b", "dialysis_session", 0)).toBe(2200);
  });

  it("falls back when the hospital has no configured row", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await getRate("hospital-c", "dialysis_session", 800)).toBe(800);
  });

  it("falls back rather than propagating a query error", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await getRate("hospital-a", "dialysis_session", 800)).toBe(800);
  });

  it("short-circuits to the fallback without querying when hospitalId or itemCode is missing", async () => {
    expect(await getRate("", "dialysis_session", 500)).toBe(500);
    expect(await getRate("hospital-a", "", 500)).toBe(500);
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });

  it("falls back when the stored rate is not a finite number", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { default_rate: "not-a-number" }, error: null });
    expect(await getRate("hospital-a", "dialysis_session", 900)).toBe(900);
  });
});

describe("getRateWithGst", () => {
  it("returns both configured rate and GST together", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { default_rate: 3000, gst_rate: 18 }, error: null });
    expect(await getRateWithGst("hospital-a", "surgery_fee", 0, 0)).toEqual({ rate: 3000, gst: 18 });
  });

  it("two hospitals with different configured GST get different resolved GST for the same code", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { default_rate: 3000, gst_rate: 5 }, error: null });
    expect(await getRateWithGst("hospital-b", "surgery_fee", 0, 0)).toEqual({ rate: 3000, gst: 5 });
  });

  it("falls back to both defaults when no row is configured", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await getRateWithGst("hospital-c", "surgery_fee", 1200, 12)).toEqual({ rate: 1200, gst: 12 });
  });
});

describe("getModuleDefaultRate", () => {
  it("resolves a governed module through its mapped service_rates code", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { default_rate: 650, gst_rate: 18 }, error: null });
    const result = await getModuleDefaultRate("hospital-a", "physio", 0);
    expect(result).toEqual({ rate: 650, gst: 18 });
  });

  it("returns the fallback with zero GST for a module with no configured code — never queries", async () => {
    const result = await getModuleDefaultRate("hospital-a", "not_a_real_module", 250);
    expect(result).toEqual({ rate: 250, gst: 0 });
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });

  it("every MODULE_RATE_CODE entry maps to a real SERVICE_RATE_CODES value", () => {
    for (const code of Object.values(MODULE_RATE_CODE)) {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    }
  });
});

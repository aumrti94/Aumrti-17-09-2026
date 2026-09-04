import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));

import { getRate, getRateWithGst, getModuleDefaultRate, SERVICE_RATE_CODES, MODULE_RATE_CODE } from "./serviceRates";

function rateChain(data: unknown, error: unknown = null) {
  return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data, error }) }) }) }) }) };
}

beforeEach(() => mockFrom.mockReset());

describe("getRate", () => {
  it("returns the fallback without querying when hospitalId or itemCode is missing", async () => {
    expect(await getRate("", "consultation", 500)).toBe(500);
    expect(await getRate("h1", "", 500)).toBe(500);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns the configured rate when one exists", async () => {
    mockFrom.mockReturnValue(rateChain({ default_rate: 750 }));
    expect(await getRate("h1", "consultation", 500)).toBe(750);
  });

  it("returns the fallback when no rate is configured", async () => {
    mockFrom.mockReturnValue(rateChain(null));
    expect(await getRate("h1", "consultation", 500)).toBe(500);
  });

  it("returns the fallback on a query error rather than throwing", async () => {
    mockFrom.mockReturnValue(rateChain(null, { message: "boom" }));
    expect(await getRate("h1", "consultation", 500)).toBe(500);
  });

  it("returns the fallback when the stored rate isn't a finite number", async () => {
    mockFrom.mockReturnValue(rateChain({ default_rate: "not-a-number" }));
    expect(await getRate("h1", "consultation", 500)).toBe(500);
  });
});

describe("getRateWithGst", () => {
  it("returns both rate and GST when configured", async () => {
    mockFrom.mockReturnValue(rateChain({ default_rate: 1000, gst_rate: 18 }));
    expect(await getRateWithGst("h1", "surgery_fee", 0, 0)).toEqual({ rate: 1000, gst: 18 });
  });

  it("falls back independently for rate and GST when unconfigured", async () => {
    mockFrom.mockReturnValue(rateChain(null));
    expect(await getRateWithGst("h1", "surgery_fee", 500, 12)).toEqual({ rate: 500, gst: 12 });
  });
});

describe("getModuleDefaultRate", () => {
  it("resolves a known module to its service_rates code and looks up the rate", async () => {
    mockFrom.mockReturnValue(rateChain({ default_rate: 2000, gst_rate: 0 }));
    const result = await getModuleDefaultRate("h1", "dialysis", 0);
    expect(result).toEqual({ rate: 2000, gst: 0 });
  });

  it("returns the fallback with zero GST for a module with no configured rate code", async () => {
    const result = await getModuleDefaultRate("h1", "some_unmapped_module", 999);
    expect(result).toEqual({ rate: 999, gst: 0 });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("SERVICE_RATE_CODES / MODULE_RATE_CODE integrity", () => {
  it("every MODULE_RATE_CODE entry points at a real SERVICE_RATE_CODES value", () => {
    const validCodes = new Set(Object.values(SERVICE_RATE_CODES));
    for (const code of Object.values(MODULE_RATE_CODE)) {
      expect(validCodes.has(code as any)).toBe(true);
    }
  });

  it("has no duplicate rate codes", () => {
    const codes = Object.values(SERVICE_RATE_CODES);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

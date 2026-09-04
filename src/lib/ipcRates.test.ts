import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mockRpc } }));

import { deviceDaysInPeriod, makeRate, fetchHicRates, DeviceWindow } from "./ipcRates";

describe("deviceDaysInPeriod — device-days clipped to the reporting period", () => {
  const PERIOD_START = new Date("2026-08-01T00:00:00Z");
  const PERIOD_END = new Date("2026-08-31T00:00:00Z"); // 30-day period

  it("counts a device present for the entire period as the full period length", () => {
    const devices: DeviceWindow[] = [
      { device_type: "central_line", device_inserted_at: "2026-07-01T00:00:00Z", device_removed_at: null },
    ];
    expect(deviceDaysInPeriod(devices, "central_line", PERIOD_START, PERIOD_END)).toBe(30);
  });

  it("clips a device inserted mid-period to only the days inside the period", () => {
    // Inserted 10 days into the period -> 20 days of exposure inside it.
    const devices: DeviceWindow[] = [
      { device_type: "central_line", device_inserted_at: "2026-08-11T00:00:00Z", device_removed_at: null },
    ];
    expect(deviceDaysInPeriod(devices, "central_line", PERIOD_START, PERIOD_END)).toBe(20);
  });

  it("clips a device removed mid-period to only the days before removal", () => {
    const devices: DeviceWindow[] = [
      { device_type: "central_line", device_inserted_at: "2026-07-01T00:00:00Z", device_removed_at: "2026-08-11T00:00:00Z" },
    ];
    expect(deviceDaysInPeriod(devices, "central_line", PERIOD_START, PERIOD_END)).toBe(10);
  });

  it("excludes a device of a different type entirely", () => {
    const devices: DeviceWindow[] = [
      { device_type: "urinary_catheter", device_inserted_at: "2026-07-01T00:00:00Z", device_removed_at: null },
    ];
    expect(deviceDaysInPeriod(devices, "central_line", PERIOD_START, PERIOD_END)).toBe(0);
  });

  it("excludes a device whose entire window falls outside the period", () => {
    const devices: DeviceWindow[] = [
      { device_type: "central_line", device_inserted_at: "2026-06-01T00:00:00Z", device_removed_at: "2026-06-15T00:00:00Z" },
    ];
    expect(deviceDaysInPeriod(devices, "central_line", PERIOD_START, PERIOD_END)).toBe(0);
  });

  it("sums device-days across multiple devices of the same type", () => {
    const devices: DeviceWindow[] = [
      { device_type: "central_line", device_inserted_at: "2026-08-01T00:00:00Z", device_removed_at: "2026-08-06T00:00:00Z" }, // 5
      { device_type: "central_line", device_inserted_at: "2026-08-10T00:00:00Z", device_removed_at: "2026-08-20T00:00:00Z" }, // 10
    ];
    expect(deviceDaysInPeriod(devices, "central_line", PERIOD_START, PERIOD_END)).toBe(15);
  });
});

describe("makeRate — client-side fallback, same shape as the DB collectors", () => {
  it("computes a rate scaled by the multiplier, rounded to 2dp", () => {
    // 3 infections / 1000 device-days * 1000 = 3.00 per-mille
    expect(makeRate(3, 1000, 1000)).toEqual({ value: 3, numerator: 3, denominator: 1000 });
  });

  it("returns value:null (not 0) when the denominator is zero — no exposure, not a zero rate", () => {
    expect(makeRate(0, 0, 1000)).toEqual({ value: null, numerator: 0, denominator: null });
  });

  it("returns value:null for a negative or missing denominator", () => {
    expect(makeRate(0, -5, 1000)).toEqual({ value: null, numerator: 0, denominator: null });
  });
});

describe("fetchHicRates", () => {
  beforeEach(() => mockRpc.mockReset());

  it("maps the two collector RPCs into named rates with the documented multipliers", async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "qi_collect_hic_device") {
        return Promise.resolve({
          data: [
            { indicator_code: "hic.clabsi_per1000", numerator: 2, denominator: 1000 },
            { indicator_code: "hic.cauti_per1000", numerator: 1, denominator: 500 },
          ],
          error: null,
        });
      }
      return Promise.resolve({
        data: [{ indicator_code: "hic.ssi_pct", numerator: 3, denominator: 60 }],
        error: null,
      });
    });

    const result = await fetchHicRates("h1", new Date("2026-08-01"), new Date("2026-08-31"));
    expect(result.unsupported).toBe(false);
    expect(result.rates?.clabsi.value).toBe(2);
    expect(result.rates?.ssi.value).toBe(5); // 3/60 * 100 = 5.00
  });

  it("reports unsupported:true when the collector functions don't exist yet (older DB)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "function not found" } });
    const result = await fetchHicRates("h1", new Date("2026-08-01"), new Date("2026-08-31"));
    expect(result).toEqual({ rates: null, error: null, unsupported: true });
  });

  it("surfaces a genuine query error distinctly from an unsupported/missing function", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    const result = await fetchHicRates("h1", new Date("2026-08-01"), new Date("2026-08-31"));
    expect(result.unsupported).toBe(false);
    expect(result.error).toContain("permission denied");
  });

  it("clamps the period end to now, so an in-progress period doesn't inflate device-days", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const farFuture = new Date(Date.now() + 365 * 86400000);
    await fetchHicRates("h1", new Date("2026-08-01"), farFuture);

    const callArgs = mockRpc.mock.calls[0][1];
    expect(new Date(callArgs.p_to).getTime()).toBeLessThanOrEqual(Date.now());
  });
});

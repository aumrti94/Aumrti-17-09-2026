import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * These tests exist because of a real regression: folding nursing_rate_per_day into the
 * Settings → Wards & Beds select made PostgREST reject the WHOLE query with 42703 on a
 * database that had not had migration 20261011000091 applied. The page then rendered
 * "No wards configured — IPD bed map will be empty" over six perfectly good wards, and the
 * same pattern in the IPD admission select would have taken out the room charge and every
 * charge behind it. So the contract under test is: a missing column degrades to "no nursing
 * rate configured", never to a thrown error or an empty ward list.
 */

const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const updateEq = vi.fn();
const update = vi.fn(() => ({ eq: updateEq }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select, update }) },
}));

const MISSING_COLUMN = {
  code: "42703",
  message: 'column wards.nursing_rate_per_day does not exist',
};

async function freshModule() {
  // The module latches "column missing" in module scope, so each case needs a clean copy.
  vi.resetModules();
  return import("./wardNursingRate");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getWardNursingRate", () => {
  it("returns the configured rate when the column exists", async () => {
    maybeSingle.mockResolvedValue({ data: { nursing_rate_per_day: 300 }, error: null });
    const { getWardNursingRate } = await freshModule();
    expect(await getWardNursingRate("ward-1")).toBe(300);
  });

  it("returns 0 instead of throwing when the column does not exist", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: MISSING_COLUMN });
    const { getWardNursingRate } = await freshModule();
    expect(await getWardNursingRate("ward-1")).toBe(0);
  });

  it("stops querying once it knows the column is missing", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: MISSING_COLUMN });
    const { getWardNursingRate } = await freshModule();
    await getWardNursingRate("ward-1");
    await getWardNursingRate("ward-2");
    await getWardNursingRate("ward-3");
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("treats a null rate as bundled into the room rate", async () => {
    maybeSingle.mockResolvedValue({ data: { nursing_rate_per_day: null }, error: null });
    const { getWardNursingRate } = await freshModule();
    expect(await getWardNursingRate("ward-1")).toBe(0);
  });

  it("does not query at all without a ward id", async () => {
    const { getWardNursingRate } = await freshModule();
    expect(await getWardNursingRate(null)).toBe(0);
    expect(select).not.toHaveBeenCalled();
  });

  it("recognises the PostgREST schema-cache variant of the error", async () => {
    maybeSingle.mockResolvedValue({
      data: null,
      error: { code: "PGRST204", message: "Could not find the 'nursing_rate_per_day' column" },
    });
    const { getWardNursingRate, nursingRateColumnAvailable } = await freshModule();
    expect(await getWardNursingRate("ward-1")).toBe(0);
    expect(nursingRateColumnAvailable()).toBe(false);
  });

  it("does not latch on an unrelated error — a transient failure must not disable the feature", async () => {
    maybeSingle.mockResolvedValue({
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    });
    const { getWardNursingRate, nursingRateColumnAvailable } = await freshModule();
    expect(await getWardNursingRate("ward-1")).toBe(0);
    expect(nursingRateColumnAvailable()).toBe(true);
  });
});

describe("setWardNursingRate", () => {
  it("reports success when the write lands", async () => {
    updateEq.mockResolvedValue({ error: null });
    const { setWardNursingRate } = await freshModule();
    expect(await setWardNursingRate("ward-1", 300)).toBe(true);
  });

  it("reports failure instead of throwing when the column is missing, so saving a ward still works", async () => {
    updateEq.mockResolvedValue({ error: MISSING_COLUMN });
    const { setWardNursingRate } = await freshModule();
    expect(await setWardNursingRate("ward-1", 300)).toBe(false);
  });
});

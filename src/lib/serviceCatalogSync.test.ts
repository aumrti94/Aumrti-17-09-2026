import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));

import { propagateCatalogFeeToSource } from "./serviceCatalogSync";

beforeEach(() => mockFrom.mockReset());

describe("propagateCatalogFeeToSource — catalog edit written back to the owning module table", () => {
  it("returns false without querying when the row has no source reference", async () => {
    expect(await propagateCatalogFeeToSource(null, 1000)).toBe(false);
    expect(await propagateCatalogFeeToSource({ source_table: null, source_id: null }, 1000)).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("writes the new fee to wards.rate_per_day and returns true", async () => {
    const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) });
    mockFrom.mockReturnValue({ update: updateSpy });

    const result = await propagateCatalogFeeToSource({ source_table: "wards", source_id: "ward-1" }, 2500);
    expect(result).toBe(true);
    expect(updateSpy).toHaveBeenCalledWith({ rate_per_day: 2500 });
  });

  it("returns false for a source table with no propagation path implemented yet", async () => {
    const result = await propagateCatalogFeeToSource({ source_table: "lab_test_master", source_id: "t1" }, 300);
    expect(result).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));

import {
  readStagedOrders,
  stationKeys,
  resolveComponentNames,
  releasePackageOrders,
  STAGED_ORDERS_KEY,
} from "./packageOrders";

beforeEach(() => mockFrom.mockReset());

describe("readStagedOrders — pure extraction from components_done", () => {
  it("reads staged lab and radiology order ids", () => {
    const blob = { [STAGED_ORDERS_KEY]: { lab: ["l1", "l2"], radiology: ["r1"] } };
    expect(readStagedOrders(blob)).toEqual({ lab: ["l1", "l2"], radiology: ["r1"] });
  });

  it("returns empty arrays when there is no staged-orders entry", () => {
    expect(readStagedOrders({ some_station: true })).toEqual({ lab: [], radiology: [] });
  });

  it("never throws on malformed input — null, non-object, or wrongly-typed array contents", () => {
    expect(readStagedOrders(null)).toEqual({ lab: [], radiology: [] });
    expect(readStagedOrders("not an object")).toEqual({ lab: [], radiology: [] });
    expect(readStagedOrders({ [STAGED_ORDERS_KEY]: { lab: [1, 2, "l1"] } })).toEqual({ lab: ["l1"], radiology: [] });
  });
});

describe("stationKeys — station-progress keys, excluding the reserved staging entry", () => {
  it("excludes the __staged_orders key from the station count", () => {
    const blob = { checkin: true, vitals: true, [STAGED_ORDERS_KEY]: { lab: [], radiology: [] } };
    expect(stationKeys(blob)).toEqual(["checkin", "vitals"]);
  });

  it("returns an empty list for null or non-object input", () => {
    expect(stationKeys(null)).toEqual([]);
    expect(stationKeys(undefined)).toEqual([]);
  });
});

describe("resolveComponentNames — resolves to the master's current name", () => {
  it("returns an empty list without querying when there are no components", async () => {
    expect(await resolveComponentNames("h1", [], "lab_test_master", "test_name")).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("prefers the live master name over a stale stored name when source_id is present", async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: [{ id: "t1", test_name: "CBC (Complete)" }] }) }) }),
    });
    const result = await resolveComponentNames(
      "h1",
      [{ source_id: "t1", name: "CBC (old name)" } as any],
      "lab_test_master",
      "test_name",
    );
    expect(result).toEqual(["CBC (Complete)"]);
  });

  it("falls back to the stored name for a legacy component with no source_id", async () => {
    const result = await resolveComponentNames("h1", [{ source_id: null, name: "Legacy Test" } as any], "lab_test_master", "test_name");
    expect(result).toEqual(["Legacy Test"]);
    expect(mockFrom).not.toHaveBeenCalled(); // no ids to look up
  });

  it("de-duplicates components that resolve to the same name, case-insensitively", async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: [{ id: "t1", test_name: "CBC" }] }) }) }),
    });
    const result = await resolveComponentNames(
      "h1",
      [{ source_id: "t1", name: "old" } as any, { source_id: null, name: "cbc" } as any],
      "lab_test_master",
      "test_name",
    );
    expect(result).toEqual(["CBC"]);
  });
});

describe("releasePackageOrders — flips staged orders to billed once a package is paid", () => {
  // The multi-step update chain (update -> in -> eq -> select) across two conditional
  // tables is deliberately not covered here — same policy as billTotals.ts for I/O-heavy
  // wrappers. The staging/reading logic it depends on (readStagedOrders) is fully tested above.
  it("returns zero counts without touching orders when the bill has no package bookings", async () => {
    mockFrom.mockReturnValue({ select: () => ({ eq: () => Promise.resolve({ data: [] }) }) });
    expect(await releasePackageOrders("bill-1")).toEqual({ lab: 0, radiology: 0 });
  });

  it("returns zero counts without querying at all when billId is missing", async () => {
    expect(await releasePackageOrders("")).toEqual({ lab: 0, radiology: 0 });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

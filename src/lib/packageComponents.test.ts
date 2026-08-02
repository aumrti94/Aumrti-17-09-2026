import { describe, it, expect } from "vitest";
import {
  parseComponents,
  componentsOfType,
  componentsTotal,
  packageDiscountPercent,
  resequence,
} from "./packageComponents";
import { readStagedOrders, stationKeys, STAGED_ORDERS_KEY } from "./packageOrders";

describe("parseComponents", () => {
  it("parses the master-backed shape", () => {
    const out = parseComponents([
      { name: "CBC", type: "lab_test", estimated_mins: 10, sequence: 1, source_id: "t1", source_table: "lab_test_master", fee: 300 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "CBC", type: "lab_test", source_id: "t1", fee: 300 });
  });

  it("keeps legacy free-text components with no source_id", () => {
    // Packages built before master-backed picking must still render and still book.
    const out = parseComponents([{ name: "Old Test", type: "lab_test", estimated_mins: 15, sequence: 1 }]);
    expect(out[0].source_id).toBeNull();
    expect(out[0].fee).toBe(0);
  });

  it("rescues bare-string components rather than dropping them", () => {
    const out = parseComponents(["Chest X-Ray"]);
    expect(out).toEqual([{ name: "Chest X-Ray", type: "service", estimated_mins: 15, sequence: 0 }]);
  });

  it("drops entries with no usable name", () => {
    expect(parseComponents([{ name: "  " }, null, 42, ""])).toEqual([]);
  });

  it("falls back to 'service' for an unknown type", () => {
    expect(parseComponents([{ name: "X", type: "nonsense" }])[0].type).toBe("service");
  });

  it("returns empty for non-array input", () => {
    expect(parseComponents(null)).toEqual([]);
    expect(parseComponents({})).toEqual([]);
  });
});

describe("componentsOfType", () => {
  const comps = parseComponents([
    { name: "USG", type: "radiology", estimated_mins: 20, sequence: 3 },
    { name: "CBC", type: "lab_test", estimated_mins: 10, sequence: 1 },
    { name: "LFT", type: "lab_test", estimated_mins: 10, sequence: 2 },
  ]);

  it("filters by type and sorts by sequence", () => {
    expect(componentsOfType(comps, "lab_test").map((c) => c.name)).toEqual(["CBC", "LFT"]);
  });

  it("returns empty when no component of that type exists", () => {
    expect(componentsOfType(comps, "consultation")).toEqual([]);
  });
});

describe("componentsTotal", () => {
  it("sums the captured fees", () => {
    const comps = parseComponents([
      { name: "A", type: "lab_test", fee: 300 },
      { name: "B", type: "radiology", fee: 500 },
    ]);
    expect(componentsTotal(comps)).toBe(800);
  });

  it("treats missing fees as zero", () => {
    expect(componentsTotal(parseComponents([{ name: "A", type: "lab_test" }]))).toBe(0);
  });
});

describe("packageDiscountPercent", () => {
  it("computes the advertised discount", () => {
    expect(packageDiscountPercent(4850, 3499)).toBe(28);
  });

  it("returns null when the package is priced at or above its parts", () => {
    // An overpriced package is a data-entry error; the caller flags it separately rather
    // than showing a negative discount.
    expect(packageDiscountPercent(1000, 1000)).toBeNull();
    expect(packageDiscountPercent(1000, 1500)).toBeNull();
  });

  it("returns null when no fees were captured", () => {
    expect(packageDiscountPercent(0, 500)).toBeNull();
  });
});

describe("resequence", () => {
  it("renumbers from 1 after a removal", () => {
    const comps = parseComponents([
      { name: "A", type: "lab_test", sequence: 1 },
      { name: "C", type: "lab_test", sequence: 3 },
    ]);
    expect(resequence(comps).map((c) => c.sequence)).toEqual([1, 2]);
  });
});

describe("readStagedOrders", () => {
  it("reads the staged order ids", () => {
    const done = { [STAGED_ORDERS_KEY]: { lab: ["l1", "l2"], radiology: ["r1"] } };
    expect(readStagedOrders(done)).toEqual({ lab: ["l1", "l2"], radiology: ["r1"] });
  });

  it("returns empty arrays when nothing is staged", () => {
    expect(readStagedOrders({ Reception: { completed_at: "x" } })).toEqual({ lab: [], radiology: [] });
    expect(readStagedOrders(null)).toEqual({ lab: [], radiology: [] });
  });

  it("ignores non-string entries", () => {
    const done = { [STAGED_ORDERS_KEY]: { lab: ["l1", 5, null], radiology: "nope" } };
    expect(readStagedOrders(done)).toEqual({ lab: ["l1"], radiology: [] });
  });
});

describe("stationKeys", () => {
  it("excludes the reserved staging key from station progress", () => {
    // Otherwise booking a package would show as one station already complete.
    const done = { Reception: {}, Vitals: {}, [STAGED_ORDERS_KEY]: { lab: [], radiology: [] } };
    expect(stationKeys(done)).toEqual(["Reception", "Vitals"]);
  });

  it("returns empty for a fresh booking", () => {
    expect(stationKeys({})).toEqual([]);
    expect(stationKeys(undefined)).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import {
  DEVICE_LABELS,
  DEVICE_TYPES,
  MAINTENANCE_BUNDLES,
  INSERT_BUNDLES,
  bundleElements,
  hasInsertBundle,
  computeCompliancePct,
  toElementsJson,
} from "./ipcBundles";

describe("DEVICE_TYPES / DEVICE_LABELS", () => {
  it("derives DEVICE_TYPES from DEVICE_LABELS with matching value/label pairs", () => {
    for (const [value, label] of Object.entries(DEVICE_LABELS)) {
      expect(DEVICE_TYPES).toContainEqual({ value, label });
    }
  });
});

describe("bundleElements — maintenance vs insertion bundle lookup", () => {
  it("returns the maintenance bundle for a known device type", () => {
    expect(bundleElements("central_line", "maintenance")).toBe(MAINTENANCE_BUNDLES.central_line);
  });

  it("falls back to the 'others' maintenance bundle for an unrecognised device type", () => {
    expect(bundleElements("some_new_device", "maintenance")).toBe(MAINTENANCE_BUNDLES.others);
  });

  it("returns the insertion bundle only for device types that have one", () => {
    expect(bundleElements("central_line", "insert")).toBe(INSERT_BUNDLES.central_line);
  });

  it("returns an empty array for insert on a device type with no insertion bundle", () => {
    expect(bundleElements("urinary_catheter", "insert")).toEqual([]);
  });
});

describe("hasInsertBundle", () => {
  it("is true only for device types with a defined insertion bundle", () => {
    expect(hasInsertBundle("central_line")).toBe(true);
  });

  it("is false for device types without one", () => {
    expect(hasInsertBundle("urinary_catheter")).toBe(false);
    expect(hasInsertBundle("ventilator")).toBe(false);
  });
});

describe("computeCompliancePct — unanswered elements count against compliance", () => {
  const elements = MAINTENANCE_BUNDLES.peripheral_line; // 4 elements

  it("returns null for an empty element list rather than a misleading 0%", () => {
    expect(computeCompliancePct({}, [])).toBeNull();
  });

  it("scores 100% when every element is explicitly true", () => {
    const answers = Object.fromEntries(elements.map((e) => [e.key, true]));
    expect(computeCompliancePct(answers, elements)).toBe(100);
  });

  it("scores an unanswered element the same as an explicit false", () => {
    const allTrueButOne = Object.fromEntries(elements.map((e) => [e.key, true]));
    delete allTrueButOne[elements[0].key]; // unanswered, not false
    expect(computeCompliancePct(allTrueButOne, elements)).toBe(
      Math.round((3 / 4) * 100),
    );
  });

  it("scores 0% when nothing is answered", () => {
    expect(computeCompliancePct({}, elements)).toBe(0);
  });

  it("does not count an explicit false as met", () => {
    const answers = Object.fromEntries(elements.map((e) => [e.key, false]));
    expect(computeCompliancePct(answers, elements)).toBe(0);
  });
});

describe("toElementsJson — every element becomes an explicit boolean", () => {
  it("turns an unticked element into an explicit false, not an absent key", () => {
    const elements = MAINTENANCE_BUNDLES.tracheostomy;
    const json = toElementsJson({ hand_hygiene: true }, elements);
    for (const el of elements) {
      expect(typeof json[el.key]).toBe("boolean");
    }
    expect(json.hand_hygiene).toBe(true);
    expect(json.stoma_care).toBe(false);
  });
});

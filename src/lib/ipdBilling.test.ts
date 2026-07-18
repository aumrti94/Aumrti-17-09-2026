import { describe, it, expect } from "vitest";
import { buildDedupeKey, filterSiblingBillsForSweep, shouldChargeRoom } from "./ipdBilling";

/**
 * Regression suite for the IPD discharge sweep double-charge fix. Lab, radiology and
 * pharmacy charges are already pulled directly (lab_order_items / radiology_orders /
 * pharmacy_dispensing_items, keyed lab:{id} / radiology:{id} /
 * pharmacy:dispense-item:{id}) — their standalone sibling bills must be excluded from the
 * generic sibling-bill-copy sweep, or the same charge lands on the discharge bill twice
 * under two different dedupe keys.
 *
 * The rule: a bill_type belongs on the excluded side IFF autoPullAdmissionCharges has a
 * dedicated pull for it. Adding a pull without adding the type here is the bug.
 *
 * 'radiology' was on the wrong side, and these tests asserted it there. It has had a
 * dedicated pull (keyed radiology:{order.id}) all along, while the sibling copy keyed the
 * same scan `bill-line:{item.id}` — so every IPD radiology order placed through
 * NewRadiologyOrderModal was billed TWICE at discharge. The expectations below now encode
 * the fix; the old ones encoded the bug.
 */
describe("filterSiblingBillsForSweep", () => {
  it("excludes lab, pharmacy and radiology sibling bills", () => {
    const bills = [
      { bill_type: "lab" },
      { bill_type: "pharmacy" },
      { bill_type: "radiology" },
    ];
    expect(filterSiblingBillsForSweep(bills)).toEqual([]);
  });

  it("excludes radiology — the live double-charge this filter used to miss", () => {
    expect(filterSiblingBillsForSweep([{ bill_type: "radiology" }])).toEqual([]);
  });

  it("keeps every other bill_type that has no dedicated direct pull", () => {
    const bills = [
      { bill_type: "ot" },
      { bill_type: "daycare" },
      { bill_type: "opd" },
    ];
    expect(filterSiblingBillsForSweep(bills)).toEqual(bills);
  });

  it("partitions a mixed list, preserving the order of what it keeps", () => {
    const bills = [
      { bill_type: "ot" },
      { bill_type: "lab" },
      { bill_type: "daycare" },
      { bill_type: "radiology" },
      { bill_type: "pharmacy" },
      { bill_type: "opd" },
    ];
    expect(filterSiblingBillsForSweep(bills)).toEqual([
      { bill_type: "ot" },
      { bill_type: "daycare" },
      { bill_type: "opd" },
    ]);
  });

  it("returns an empty array when there are no sibling bills", () => {
    expect(filterSiblingBillsForSweep([])).toEqual([]);
  });

  it("filters out lab/pharmacy/radiology even when they're the only sibling bills present", () => {
    const bills = [{ bill_type: "lab" }, { bill_type: "pharmacy" }, { bill_type: "radiology" }];
    expect(filterSiblingBillsForSweep(bills)).toEqual([]);
  });

  it("is null-safe on bill_type (defensive — schema allows it, even if unused today)", () => {
    const bills = [{ bill_type: null }, { bill_type: "lab" }];
    expect(filterSiblingBillsForSweep(bills)).toEqual([{ bill_type: null }]);
  });

  it("does not mutate its input", () => {
    const bills = [{ bill_type: "ot" }, { bill_type: "radiology" }];
    filterSiblingBillsForSweep(bills);
    expect(bills).toEqual([{ bill_type: "ot" }, { bill_type: "radiology" }]);
  });
});

/**
 * Regression suite for the phantom day care room charge.
 *
 * 20261008000137 made bed_id/ward_id nullable so day care could admit without a bed. The
 * room-charge block guarded only on the admission row existing, so for a bed-less admission
 * it fell through every rate lookup to its ₹500 / "general" / 1-day fallback and billed a
 * "Room: Ward - Bed  (1 days)" line for a bed that was never occupied.
 */
describe("shouldChargeRoom", () => {
  it("never charges a room for day care, even if a bed somehow got linked", () => {
    // The admission_type check must win outright: a day care patient parked on a bed for
    // recovery still hasn't bought a bed-day.
    expect(shouldChargeRoom("daycare", "bed-uuid-1")).toBe(false);
  });

  it("does not charge a room for a day care admission with no bed (the live bug)", () => {
    expect(shouldChargeRoom("daycare", null)).toBe(false);
  });

  it("charges a room for an inpatient occupying a bed", () => {
    expect(shouldChargeRoom("elective", "bed-uuid-1")).toBe(true);
    expect(shouldChargeRoom("emergency", "bed-uuid-2")).toBe(true);
    expect(shouldChargeRoom("planned", "bed-uuid-3")).toBe(true);
  });

  it("does not charge a room for any admission type without a bed", () => {
    // Guards the ₹500 fallback directly: no bed means no rate lookup can be meaningful,
    // whatever the admission type says.
    expect(shouldChargeRoom("elective", null)).toBe(false);
    expect(shouldChargeRoom("emergency", undefined)).toBe(false);
    expect(shouldChargeRoom("elective", "")).toBe(false);
  });

  it("is null/undefined-safe on admission_type and falls back to the bed test", () => {
    expect(shouldChargeRoom(null, "bed-uuid-1")).toBe(true);
    expect(shouldChargeRoom(undefined, "bed-uuid-1")).toBe(true);
    expect(shouldChargeRoom("", "bed-uuid-1")).toBe(true);
    expect(shouldChargeRoom(null, null)).toBe(false);
  });

  it("matches admission_type case-insensitively", () => {
    // admissions.admission_type has no CHECK constraint, so casing is convention only.
    expect(shouldChargeRoom("DAYCARE", "bed-uuid-1")).toBe(false);
    expect(shouldChargeRoom("DayCare", "bed-uuid-1")).toBe(false);
  });
});

/**
 * The anti-double-charge contract between order-time posting (lib/ancillaryCharges.ts) and the
 * discharge sweep. A charge posted at order time and the sweep's own pull of the same source
 * record MUST produce the identical dedupe key, or the discharge bill gets both. This is the
 * single most consequential invariant in the pre/post-paid feature, so it is pinned here rather
 * than left implicit in two files that must agree.
 */
describe("buildDedupeKey — the sweep ⇄ ancillaryCharges contract", () => {
  // The keys ancillaryCharges writes at order time, verbatim.
  const LAB_KEY = (itemId: string) => `lab:${itemId}`;
  const RAD_KEY = (orderId: string) => `radiology:${orderId}`;
  const PHARM_KEY = (itemId: string) => `pharmacy:dispense-item:${itemId}`;

  it("a lab charge posted at order time matches the sweep's lab_order_items pull", () => {
    const orderTime = buildDedupeKey({
      source_module: "lab", item_type: "lab", source_dedupe_key: LAB_KEY("item-1"),
    });
    const sweep = buildDedupeKey({
      source_module: "lab", item_type: "lab", source_record_id: "item-1", source_dedupe_key: `lab:item-1`,
    });
    expect(orderTime).toBe(sweep);
  });

  it("a radiology charge posted at order time matches the sweep's radiology_orders pull", () => {
    const orderTime = buildDedupeKey({
      source_module: "radiology", item_type: "radiology", source_dedupe_key: RAD_KEY("ord-1"),
    });
    const sweep = buildDedupeKey({
      source_module: "radiology", item_type: "radiology", source_dedupe_key: `radiology:ord-1`,
    });
    expect(orderTime).toBe(sweep);
  });

  it("a pharmacy charge posted at order time matches the sweep's dispensing-items pull", () => {
    const orderTime = buildDedupeKey({
      source_module: "pharmacy", item_type: "pharmacy", source_dedupe_key: PHARM_KEY("di-1"),
    });
    const sweep = buildDedupeKey({
      source_module: "pharmacy", item_type: "pharmacy", source_dedupe_key: `pharmacy:dispense-item:di-1`,
    });
    expect(orderTime).toBe(sweep);
  });

  it("distinguishes different source records so genuinely separate charges are NOT merged", () => {
    const a = buildDedupeKey({ source_module: "lab", item_type: "lab", source_dedupe_key: LAB_KEY("item-1") });
    const b = buildDedupeKey({ source_module: "lab", item_type: "lab", source_dedupe_key: LAB_KEY("item-2") });
    expect(a).not.toBe(b);
  });

  it("does not collide across services that happen to share a source id", () => {
    const lab = buildDedupeKey({ source_module: "lab", item_type: "lab", source_dedupe_key: "lab:x" });
    const rad = buildDedupeKey({ source_module: "radiology", item_type: "radiology", source_dedupe_key: "radiology:x" });
    expect(lab).not.toBe(rad);
  });

  it("falls back to source_record_id, then description, for legacy rows with no dedupe key", () => {
    expect(buildDedupeKey({ source_module: "lab", item_type: "lab", source_record_id: "rec-9" }))
      .toBe("lab::rec-9::lab");
    expect(buildDedupeKey({ source_module: "lab", item_type: "lab", description: "  CBC  " }))
      .toBe("lab::cbc::lab");
  });
});

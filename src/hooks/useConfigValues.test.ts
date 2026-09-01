import { describe, it, expect } from "vitest";
import { mergeConfigValues, type ConfigRow } from "./useConfigValues";

/**
 * Dropdown options come from three layers — hospital rows, system rows, and the
 * hardcoded defaults — and getting the precedence wrong is invisible until a
 * clinician is staring at the wrong list. An override that silently loses to the
 * system row shows the hospital a label it already renamed; a disabled value that
 * survives the merge keeps offering a drug route the hospital deliberately
 * withdrew. Both rules are pinned here.
 */

const HOSPITAL = "hosp-1";

function row(over: Partial<ConfigRow> & Pick<ConfigRow, "value">): ConfigRow {
  return {
    id:          `row-${over.value}`,
    hospital_id: null,
    label:       over.value,
    sort_order:  0,
    is_system:   false,
    is_active:   true,
    metadata:    null,
    ...over,
  };
}

describe("mergeConfigValues", () => {
  it("falls back to the hardcoded defaults when the table has no rows", () => {
    const merged = mergeConfigValues("allergy_types", []);
    expect(merged.map(v => v.value)).toEqual([
      "drug", "food", "environmental", "latex", "contrast",
      "insect", "pollen", "animal_dander", "other",
    ]);
    expect(merged.every(v => v.is_system)).toBe(true);
  });

  it("lets a system row in the table override the hardcoded label", () => {
    const merged = mergeConfigValues("allergy_types", [
      row({ value: "drug", label: "Medication", is_system: true }),
    ]);
    expect(merged.find(v => v.value === "drug")?.label).toBe("Medication");
    expect(merged).toHaveLength(9); // still the full list, one label replaced
  });

  it("lets a hospital override win over the system row regardless of sort order", () => {
    // The query orders by sort_order, so the system row arrives first here. Row
    // order must not decide the winner.
    const merged = mergeConfigValues("drug_routes", [
      row({ value: "Oral", label: "Oral (PO)",  sort_order: 10, is_system: true }),
      row({ value: "Oral", label: "By mouth",   sort_order: 99, hospital_id: HOSPITAL }),
    ]);
    expect(merged.find(v => v.value === "Oral")?.label).toBe("By mouth");
  });

  it("drops a value the hospital switched off, including a hardcoded default", () => {
    // Disabling a system value stores a hospital row with is_active = false.
    const merged = mergeConfigValues("allergy_types", [
      row({ value: "latex", label: "Latex", hospital_id: HOSPITAL, is_active: false }),
    ]);
    expect(merged.map(v => v.value)).not.toContain("latex");
    expect(merged).toHaveLength(8);
  });

  it("keeps a hospital's custom value alongside the defaults", () => {
    const merged = mergeConfigValues("allergy_types", [
      row({ value: "iodine", label: "Iodine", sort_order: 15, hospital_id: HOSPITAL }),
    ]);
    expect(merged.map(v => v.value)).toContain("iodine");
    expect(merged).toHaveLength(10);
  });

  it("sorts by sort_order, then label", () => {
    const merged = mergeConfigValues("unknown_category", [
      row({ value: "c", label: "Charlie", sort_order: 20 }),
      row({ value: "b", label: "Bravo",   sort_order: 10 }),
      row({ value: "a", label: "Alpha",   sort_order: 10 }),
    ]);
    expect(merged.map(v => v.label)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("returns nothing for an unknown category with no rows", () => {
    expect(mergeConfigValues("not_a_category", [])).toEqual([]);
  });

  it("does not leak is_active onto the returned options", () => {
    const [first] = mergeConfigValues("allergy_types", []);
    expect(first).not.toHaveProperty("is_active");
  });
});

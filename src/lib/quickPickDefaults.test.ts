import { describe, it, expect } from "vitest";
import {
  DEFAULT_COMPLAINTS,
  DEFAULT_EXAM_FINDINGS,
  DEFAULT_DIAGNOSES,
  DEFAULT_RX_TEMPLATES,
  DEFAULT_LAB_TEMPLATES,
  DEFAULT_RADIOLOGY_TEMPLATES,
  QUICK_PICK_DEFAULTS,
} from "./quickPickDefaults";

describe("quick-pick default catalogues — seeded values for a doctor's OPD shortcuts", () => {
  it("has no duplicate entries in any plain string list", () => {
    for (const list of [DEFAULT_COMPLAINTS, DEFAULT_EXAM_FINDINGS, DEFAULT_DIAGNOSES, DEFAULT_LAB_TEMPLATES, DEFAULT_RADIOLOGY_TEMPLATES]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("gives every Rx template all fields a prescription needs", () => {
    for (const rx of DEFAULT_RX_TEMPLATES) {
      expect(rx.drug_name.length).toBeGreaterThan(0);
      expect(rx.dose.length).toBeGreaterThan(0);
      expect(rx.route.length).toBeGreaterThan(0);
      expect(rx.frequency.length).toBeGreaterThan(0);
      expect(rx.duration_days.length).toBeGreaterThan(0);
      expect(rx.quantity.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate drug names across the Rx templates", () => {
    const names = DEFAULT_RX_TEMPLATES.map((r) => r.drug_name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("assembles QUICK_PICK_DEFAULTS from the same arrays exported individually", () => {
    expect(QUICK_PICK_DEFAULTS.complaints).toBe(DEFAULT_COMPLAINTS);
    expect(QUICK_PICK_DEFAULTS.exam_findings).toBe(DEFAULT_EXAM_FINDINGS);
    expect(QUICK_PICK_DEFAULTS.diagnoses).toBe(DEFAULT_DIAGNOSES);
    expect(QUICK_PICK_DEFAULTS.rx_templates).toBe(DEFAULT_RX_TEMPLATES);
    expect(QUICK_PICK_DEFAULTS.lab_templates).toBe(DEFAULT_LAB_TEMPLATES);
    expect(QUICK_PICK_DEFAULTS.radiology_templates).toBe(DEFAULT_RADIOLOGY_TEMPLATES);
  });

  it("starts test_group_order empty — it is populated per-doctor, not seeded", () => {
    expect(QUICK_PICK_DEFAULTS.test_group_order).toEqual([]);
  });
});

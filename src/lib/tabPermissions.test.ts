import { describe, it, expect } from "vitest";
import { hasTabAccess, parseModuleTabs, MODULE_TABS } from "./tabPermissions";

// Nursing module completion plan, Phase 7 — /nursing's 7 sub-tabs wired into the same
// hasTabAccess()/MODULE_TABS permission system every other module (ipd, opd, ot, ...) uses.
describe("nursing MODULE_TABS + hasTabAccess", () => {
  it("declares all 7 nursing sub-tabs", () => {
    const keys = MODULE_TABS.nursing.map((t) => t.key);
    expect(keys).toEqual(["tasks", "kanban", "care_plans", "io", "restraints", "icu_monitor", "risk_assessments"]);
  });

  it("default-allow: with no restriction configured, every nursing tab is accessible to a nurse", () => {
    for (const tab of MODULE_TABS.nursing) {
      expect(hasTabAccess("nursing", tab.key, null, "nurse")).toBe(true);
    }
  });

  it("a super_admin restricting one nursing tab hides only that tab for the nurse role", () => {
    const permissions = { nursing: { tabs: { restraints: false } } };
    expect(hasTabAccess("nursing", "restraints", permissions, "nurse")).toBe(false);
    for (const tab of MODULE_TABS.nursing.filter((t) => t.key !== "restraints")) {
      expect(hasTabAccess("nursing", tab.key, permissions, "nurse")).toBe(true);
    }
  });

  it("super_admin and hospital_admin always see all 7 tabs regardless of configured restrictions", () => {
    const permissions = { nursing: { tabs: { tasks: false, kanban: false, care_plans: false, io: false, restraints: false, icu_monitor: false, risk_assessments: false } } };
    for (const role of ["super_admin", "hospital_admin"]) {
      for (const tab of MODULE_TABS.nursing) {
        expect(hasTabAccess("nursing", tab.key, permissions, role)).toBe(true);
      }
    }
  });

  it("parseModuleTabs (the settings-page helper) surfaces all 7 nursing tabs as true by default", () => {
    const parsed = parseModuleTabs("nursing", {});
    expect(Object.keys(parsed).sort()).toEqual(
      ["care_plans", "icu_monitor", "io", "kanban", "restraints", "risk_assessments", "tasks"]
    );
    expect(Object.values(parsed).every((v) => v === true)).toBe(true);
  });
});

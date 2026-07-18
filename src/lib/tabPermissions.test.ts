import { describe, it, expect } from "vitest";
import { hasTabAccess, hasActionAccess, parseModuleTabs, MODULE_TABS, ENTITLEMENT_KEY } from "./tabPermissions";

// Nursing module completion plan, Phase 7 — /nursing's 7 sub-tabs wired into the same
// hasTabAccess()/MODULE_TABS permission system every other module (ipd, opd, ot, ...) uses.
describe("nursing MODULE_TABS + hasTabAccess", () => {
  it("declares the nursing sub-tabs including the Phase 9 lab-collection tab", () => {
    const keys = MODULE_TABS.nursing.map((t) => t.key);
    expect(keys).toEqual(["tasks", "kanban", "care_plans", "io", "restraints", "icu_monitor", "risk_assessments", "collection", "radiology"]);
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

  it("parseModuleTabs (the settings-page helper) surfaces all nursing tabs as true by default", () => {
    const parsed = parseModuleTabs("nursing", {});
    expect(Object.keys(parsed).sort()).toEqual(
      ["care_plans", "collection", "icu_monitor", "io", "kanban", "radiology", "restraints", "risk_assessments", "tasks"]
    );
    expect(Object.values(parsed).every((v) => v === true)).toBe(true);
  });
});

// Lab module completion plan, Phase 5 — the Collection workstation tab joins the
// existing lab tab set under the same permission system.
describe("lab MODULE_TABS + hasTabAccess", () => {
  it("declares the lab tabs including the Phase 5 collection tab", () => {
    const keys = MODULE_TABS.lab.map((t) => t.key);
    expect(keys).toEqual([
      "worklist", "collection", "qc", "calibration", "histopathology", "tat", "external", "analyzer",
      "results", "sample", "history", "notes",
    ]);
  });

  it("default-allow: with no restriction configured, every lab tab is accessible to a lab technician", () => {
    for (const tab of MODULE_TABS.lab) {
      expect(hasTabAccess("lab", tab.key, null, "lab_technician")).toBe(true);
    }
  });

  it("restricting the collection tab hides only that tab for the lab technician role", () => {
    const permissions = { lab: { tabs: { collection: false } } };
    expect(hasTabAccess("lab", "collection", permissions, "lab_technician")).toBe(false);
    for (const tab of MODULE_TABS.lab.filter((t) => t.key !== "collection")) {
      expect(hasTabAccess("lab", tab.key, permissions, "lab_technician")).toBe(true);
    }
  });

  it("super_admin and hospital_admin always see all lab tabs regardless of restrictions", () => {
    const permissions = { lab: { tabs: Object.fromEntries(MODULE_TABS.lab.map((t) => [t.key, false])) } };
    for (const role of ["super_admin", "hospital_admin"]) {
      for (const tab of MODULE_TABS.lab) {
        expect(hasTabAccess("lab", tab.key, permissions, role)).toBe(true);
      }
    }
  });

  it("parseModuleTabs surfaces all lab tabs as true by default", () => {
    const parsed = parseModuleTabs("lab", {});
    expect(Object.keys(parsed).sort()).toEqual(
      ["analyzer", "calibration", "collection", "external", "histopathology", "history", "notes", "qc", "results", "sample", "tat", "worklist"]
    );
    expect(Object.values(parsed).every((v) => v === true)).toBe(true);
  });
});

// Platform-controlled per-hospital entitlement floor (billing-only customisation).
// The __entitlement blob is injected by HospitalContext and must gate access for
// EVERY role — including the admins that the per-role layer normally bypasses —
// because it represents what the hospital actually subscribed to.
describe("hospital entitlement floor (__entitlement)", () => {
  const entitlement = {
    [ENTITLEMENT_KEY]: {
      billing: { tabs: { leakage: false }, actions: { waive_amount: false } },
    },
  };

  it("withholds an un-subscribed tab even from super_admin / hospital_admin", () => {
    for (const role of ["super_admin", "hospital_admin", "billing_executive"]) {
      expect(hasTabAccess("billing", "leakage", entitlement, role)).toBe(false);
    }
  });

  it("withholds an un-subscribed action even from admins", () => {
    for (const role of ["super_admin", "hospital_admin", "billing_executive"]) {
      expect(hasActionAccess("billing", "waive_amount", entitlement, role)).toBe(false);
    }
  });

  it("leaves entitled tabs/actions of the same module fully accessible", () => {
    expect(hasTabAccess("billing", "bills", entitlement, "billing_executive")).toBe(true);
    expect(hasTabAccess("billing", "collections", entitlement, "super_admin")).toBe(true);
    expect(hasActionAccess("billing", "new_bill", entitlement, "billing_executive")).toBe(true);
  });

  it("does not affect modules with no entitlement entry", () => {
    expect(hasTabAccess("lab", "worklist", entitlement, "lab_technician")).toBe(true);
  });

  it("effective access = entitlement AND role: a role-denied tab stays hidden regardless of entitlement", () => {
    const both = {
      billing: { tabs: { collections: false } },
      [ENTITLEMENT_KEY]: { billing: { tabs: { leakage: false } } },
    };
    // withheld by role
    expect(hasTabAccess("billing", "collections", both, "billing_executive")).toBe(false);
    // withheld by entitlement (and would be hidden for admins too)
    expect(hasTabAccess("billing", "leakage", both, "billing_executive")).toBe(false);
    // allowed by both
    expect(hasTabAccess("billing", "bills", both, "billing_executive")).toBe(true);
  });
});

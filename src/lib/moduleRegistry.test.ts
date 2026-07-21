import { describe, it, expect } from "vitest";
import {
  applyUserOverrides,
  PERMISSION_MODULE_KEYS,
  LEGACY_MODULE_PARENT,
} from "./moduleRegistry";

describe("PERMISSION_MODULES registry", () => {
  it("covers far more than the legacy 18 and includes internal governance keys", () => {
    expect(PERMISSION_MODULE_KEYS.length).toBeGreaterThan(40);
    for (const k of ["opd", "ipd", "dialysis", "oncology", "day_closure", "pmjay", "patients", "reports", "user_management"]) {
      expect(PERMISSION_MODULE_KEYS).toContain(k);
    }
  });

  it("excludes the routeless ai_suite pseudo-module", () => {
    expect(PERMISSION_MODULE_KEYS).not.toContain("ai_suite");
  });
});

describe("applyUserOverrides — restrict-only L4 overlay", () => {
  it("returns the role blob untouched when there is nothing to withhold", () => {
    const role = { opd: { view: true, create: true } };
    expect(applyUserOverrides(role, null)).toBe(role);
    expect(applyUserOverrides(role, {})).toBe(role);
  });

  it("flips a granted CRUD action off without mutating the role blob", () => {
    const role = { billing: { view: true, create: true, edit: true } };
    const out = applyUserOverrides(role, { billing: { create: false } });
    expect(out).toEqual({ billing: { view: true, create: false, edit: true, tabs: {}, actions: {} } });
    // original untouched
    expect(role).toEqual({ billing: { view: true, create: true, edit: true } });
  });

  it("withholds a specific tab and action", () => {
    const role = { oncology: { view: true, tabs: { chemo: true }, actions: { book_chemo: true } } };
    const out = applyUserOverrides(role, { oncology: { tabs: { chemo: false }, actions: { book_chemo: false } } });
    expect(out.oncology.tabs.chemo).toBe(false);
    expect(out.oncology.actions.book_chemo).toBe(false);
    expect(out.oncology.view).toBe(true);
  });

  it("never grants a module the role does not already carry", () => {
    const role = { opd: { view: true } };
    // withhold references a module absent from the role → no-op (already denied)
    const out = applyUserOverrides(role, { ipd: { view: false } });
    expect(out.ipd).toBeUndefined();
  });

  it("expands a legacy string module value before withholding", () => {
    const role = { pharmacy: "rw" as any };
    const out = applyUserOverrides(role, { pharmacy: { create: false } });
    expect(out.pharmacy.view).toBe(true); // r retained
    expect(out.pharmacy.create).toBe(false); // withheld
  });
});

describe("LEGACY_MODULE_PARENT", () => {
  it("maps specialty children to the bucket they used to inherit", () => {
    expect(LEGACY_MODULE_PARENT.dialysis).toBe("ipd");
    expect(LEGACY_MODULE_PARENT.payments).toBe("billing");
    expect(LEGACY_MODULE_PARENT.pmjay).toBe("insurance");
  });
});

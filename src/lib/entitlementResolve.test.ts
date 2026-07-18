import { describe, it, expect } from "vitest";
import { resolveEntitlement } from "./entitlementResolve";

describe("resolveEntitlement — plan default layered under hospital override", () => {
  it("returns null when neither plan nor hospital withhold anything", () => {
    expect(resolveEntitlement([], [])).toBeNull();
    expect(
      resolveEntitlement(
        [{ module_key: "billing", tabs: {}, actions: {} }],
        [],
      ),
    ).toBeNull();
  });

  it("applies plan defaults when the hospital has no override", () => {
    const r = resolveEntitlement(
      [{ module_key: "billing", tabs: { leakage: false }, actions: { waive_amount: false } }],
      [],
    );
    expect(r).toEqual({ billing: { tabs: { leakage: false }, actions: { waive_amount: false } } });
  });

  it("hospital explicit false withholds a tab the plan allowed", () => {
    const r = resolveEntitlement(
      [{ module_key: "oncology", tabs: {}, actions: {} }],
      [{ module_key: "oncology", tabs: { protocols: false }, actions: {} }],
    );
    expect(r).toEqual({ oncology: { tabs: { protocols: false }, actions: {} } });
  });

  it("hospital explicit true RE-ENABLES a tab the plan withheld", () => {
    const r = resolveEntitlement(
      [{ module_key: "billing", tabs: { leakage: false }, actions: {} }],
      [{ module_key: "billing", tabs: { leakage: true }, actions: {} }],
    );
    // leakage becomes allowed → dropped from the withheld map → module has nothing withheld → null
    expect(r).toBeNull();
  });

  it("merges per key: plan withholds A, hospital withholds B → both withheld", () => {
    const r = resolveEntitlement(
      [{ module_key: "billing", tabs: { leakage: false }, actions: {} }],
      [{ module_key: "billing", tabs: { approvals: false }, actions: {} }],
    );
    expect(r).toEqual({ billing: { tabs: { leakage: false, approvals: false }, actions: {} } });
  });

  it("keeps modules independent", () => {
    const r = resolveEntitlement(
      [{ module_key: "billing", tabs: { leakage: false }, actions: {} }],
      [{ module_key: "oncology", tabs: { reports: false }, actions: {} }],
    );
    expect(r).toEqual({
      billing: { tabs: { leakage: false }, actions: {} },
      oncology: { tabs: { reports: false }, actions: {} },
    });
  });

  it("tolerates null tabs/actions columns", () => {
    const r = resolveEntitlement(
      [{ module_key: "billing", tabs: null, actions: null }],
      [{ module_key: "billing", tabs: { leakage: false }, actions: null }],
    );
    expect(r).toEqual({ billing: { tabs: { leakage: false }, actions: {} } });
  });
});

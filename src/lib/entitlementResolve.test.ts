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

  // ── Add-on layer (pricing v3 Phase 2) ──────────────────────────────────
  describe("add-on grants", () => {
    // Starter withholds the AI Suite Pro features at the plan level.
    const planWithheld = [{
      module_key: "ai_suite",
      tabs: {},
      actions: { ai_digest: false, ot_optimizer: false, roster_optimizer: false },
    }];

    it("un-withholds exactly the features the purchased SKU grants", () => {
      const r = resolveEntitlement(
        planWithheld,
        [],
        [{ module_key: "ai_suite", tabs: {}, actions: { ai_digest: true, ot_optimizer: true } }],
      );
      // Granted keys disappear from the withheld map; the unbought one remains.
      expect(r).toEqual({ ai_suite: { tabs: {}, actions: { roster_optimizer: false } } });
    });

    it("returns null when an add-on grants everything the plan withheld", () => {
      const r = resolveEntitlement(
        [{ module_key: "ai_suite", tabs: {}, actions: { ai_digest: false } }],
        [],
        [{ module_key: "ai_suite", tabs: {}, actions: { ai_digest: true } }],
      );
      expect(r).toBeNull(); // nothing withheld anywhere = fully permissive
    });

    it("an admin override still beats a paid add-on", () => {
      const r = resolveEntitlement(
        planWithheld,
        [{ module_key: "ai_suite", tabs: {}, actions: { ai_digest: false } }],
        [{ module_key: "ai_suite", tabs: {}, actions: { ai_digest: true } }],
      );
      expect(r?.ai_suite.actions.ai_digest).toBe(false);
    });

    it("omitting addonRows preserves the previous two-argument behaviour", () => {
      const withOut = resolveEntitlement(planWithheld, []);
      const withEmpty = resolveEntitlement(planWithheld, [], []);
      expect(withOut).toEqual(withEmpty);
      expect(withOut?.ai_suite.actions.ai_digest).toBe(false);
    });
  });
});

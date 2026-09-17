import { describe, it, expect } from "vitest";
import { resolveEntitlement, type EntitlementRow } from "@/lib/entitlementResolve";

describe("resolveEntitlement — Plan & Billing / AI Features entitlement floor", () => {
  it("returns null (full access) when nothing is configured anywhere", () => {
    expect(resolveEntitlement([], [], [])).toBeNull();
  });

  it("a plan withholding a tab produces a withheld entry", () => {
    const plan: EntitlementRow[] = [{ module_key: "lab", tabs: { advanced_reports: false } }];
    const result = resolveEntitlement(plan, []);
    expect(result).toEqual({ lab: { tabs: { advanced_reports: false }, actions: {} } });
  });

  it("upgrading the plan (removing the withhold) changes the resolved entitlement for the same hospital", () => {
    const basicPlan: EntitlementRow[] = [{ module_key: "lab", tabs: { advanced_reports: false } }];
    const premiumPlan: EntitlementRow[] = [{ module_key: "lab", tabs: {} }];
    expect(resolveEntitlement(basicPlan, [])).not.toBeNull();
    expect(resolveEntitlement(premiumPlan, [])).toBeNull();
  });

  it("a hospital override wins over the plan default", () => {
    const plan: EntitlementRow[] = [{ module_key: "radiology", actions: { export: false } }];
    const hosp: EntitlementRow[] = [{ module_key: "radiology", actions: { export: true } }];
    const result = resolveEntitlement(plan, hosp);
    // export:true is not a withhold, so it does not appear in the output at all
    expect(result).toBeNull();
  });

  it("a hospital override can add its own withhold beyond the plan", () => {
    const plan: EntitlementRow[] = [{ module_key: "radiology", actions: {} }];
    const hosp: EntitlementRow[] = [{ module_key: "radiology", actions: { export: false } }];
    const result = resolveEntitlement(plan, hosp);
    expect(result).toEqual({ radiology: { tabs: {}, actions: { export: false } } });
  });

  it("an active add-on un-withholds what the plan withheld (grants sit between plan and hospital)", () => {
    const plan: EntitlementRow[] = [{ module_key: "ai_suite", actions: { clinical_note: false } }];
    const addon: EntitlementRow[] = [{ module_key: "ai_suite", actions: { clinical_note: true } }];
    const result = resolveEntitlement(plan, [], addon);
    expect(result).toBeNull();
  });

  it("an admin hospital override still wins over a purchased add-on — 'paying but gated'", () => {
    const plan: EntitlementRow[] = [{ module_key: "ai_suite", actions: { clinical_note: false } }];
    const addon: EntitlementRow[] = [{ module_key: "ai_suite", actions: { clinical_note: true } }];
    const hosp: EntitlementRow[] = [{ module_key: "ai_suite", actions: { clinical_note: false } }];
    const result = resolveEntitlement(plan, hosp, addon);
    expect(result).toEqual({ ai_suite: { tabs: {}, actions: { clinical_note: false } } });
  });

  it("only withheld (false) keys survive — a true value is never emitted", () => {
    const plan: EntitlementRow[] = [{ module_key: "ipd", tabs: { overview: true }, actions: { export: false } }];
    const result = resolveEntitlement(plan, []);
    expect(result).toEqual({ ipd: { tabs: {}, actions: { export: false } } });
  });

  it("modules present only in an add-on or hospital row (absent from the plan) still resolve", () => {
    const hosp: EntitlementRow[] = [{ module_key: "pharmacy", actions: { delete: false } }];
    expect(resolveEntitlement([], hosp)).toEqual({ pharmacy: { tabs: {}, actions: { delete: false } } });
  });

  it("missing tabs/actions on a row default to empty rather than throwing", () => {
    const plan: EntitlementRow[] = [{ module_key: "ot" }];
    expect(() => resolveEntitlement(plan, [])).not.toThrow();
    expect(resolveEntitlement(plan, [])).toBeNull();
  });
});

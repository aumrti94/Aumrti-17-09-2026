import { describe, it, expect } from "vitest";
import { resolveEnabledModules } from "./moduleAccess";

const ALWAYS = new Set(["settings", "inbox", "dashboard"]);
const KEYS = ["opd", "ipd", "insurance", "accounts", "ai_suite", "settings"];

const base = {
  canonicalKeys: KEYS,
  alwaysEnabled: ALWAYS,
  planRows: [] as { module_key: string; is_enabled: boolean }[],
  overrideRows: [] as { module_key: string; is_enabled: boolean }[],
};

describe("resolveEnabledModules — behaviour carried over from useSubscriptionConfig", () => {
  it("treats a hospital with NO plan_features rows as fully open (legacy)", () => {
    // Losing access on a data gap would lock a working hospital out of its own
    // records, so absence of plan rows must stay fail-open.
    expect(resolveEnabledModules(base)).toEqual(KEYS);
  });

  it("grants ALWAYS_ENABLED keys even when the plan withholds them", () => {
    const r = resolveEnabledModules({
      ...base,
      planRows: [{ module_key: "settings", is_enabled: false }, { module_key: "opd", is_enabled: true }],
    });
    expect(r).toContain("settings");
  });

  it("enables only what the plan enables", () => {
    const r = resolveEnabledModules({
      ...base,
      planRows: [
        { module_key: "opd", is_enabled: true },
        { module_key: "ipd", is_enabled: false },
        { module_key: "insurance", is_enabled: false },
      ],
    });
    expect(r).toContain("opd");
    expect(r).not.toContain("ipd");
    expect(r).not.toContain("insurance");
  });

  it("defaults ai_suite ON when the plan has no ai_suite row", () => {
    const r = resolveEnabledModules({ ...base, planRows: [{ module_key: "opd", is_enabled: true }] });
    expect(r).toContain("ai_suite");
  });

  it("respects an explicit ai_suite = false", () => {
    const r = resolveEnabledModules({
      ...base,
      planRows: [{ module_key: "opd", is_enabled: true }, { module_key: "ai_suite", is_enabled: false }],
    });
    expect(r).not.toContain("ai_suite");
  });

  it("an admin override re-enables a plan-withheld module", () => {
    const r = resolveEnabledModules({
      ...base,
      planRows: [{ module_key: "insurance", is_enabled: false }],
      overrideRows: [{ module_key: "insurance", is_enabled: true }],
    });
    expect(r).toContain("insurance");
  });

  it("an admin override can withhold a plan-granted module", () => {
    const r = resolveEnabledModules({
      ...base,
      planRows: [{ module_key: "opd", is_enabled: true }],
      overrideRows: [{ module_key: "opd", is_enabled: false }],
    });
    expect(r).not.toContain("opd");
  });
});

describe("resolveEnabledModules — the add-on layer (pricing v3 Phase 2)", () => {
  const starter = [
    { module_key: "opd", is_enabled: true },
    { module_key: "insurance", is_enabled: false },
    { module_key: "accounts", is_enabled: false },
  ];

  it("a purchased add-on grants a module the plan withholds", () => {
    const r = resolveEnabledModules({ ...base, planRows: starter, addonKeys: ["insurance"] });
    expect(r).toContain("insurance");
  });

  it("grants only what was bought — an unpurchased add-on module stays withheld", () => {
    const r = resolveEnabledModules({ ...base, planRows: starter, addonKeys: ["insurance"] });
    expect(r).not.toContain("accounts");
  });

  it("no add-ons leaves plan behaviour completely unchanged", () => {
    const withEmpty = resolveEnabledModules({ ...base, planRows: starter, addonKeys: [] });
    const withUndef = resolveEnabledModules({ ...base, planRows: starter });
    expect(withEmpty).toEqual(withUndef);
    expect(withEmpty).not.toContain("insurance");
  });

  it("an admin override still beats a paid add-on (the drift case)", () => {
    // The hospital is paying for insurance but an admin has switched it off.
    // Access is denied — and addon_entitlement_drift surfaces it so the billing
    // inconsistency is visible rather than silent.
    const r = resolveEnabledModules({
      ...base,
      planRows: starter,
      addonKeys: ["insurance"],
      overrideRows: [{ module_key: "insurance", is_enabled: false }],
    });
    expect(r).not.toContain("insurance");
  });

  it("an add-on for a module the plan already grants is a no-op, not a duplicate", () => {
    const r = resolveEnabledModules({
      ...base,
      planRows: [{ module_key: "opd", is_enabled: true }],
      addonKeys: ["opd"],
    });
    expect(r.filter((k) => k === "opd")).toHaveLength(1);
  });
});

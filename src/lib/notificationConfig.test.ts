import { describe, it, expect } from "vitest";
import { mergeAlerts, DEFAULT_ALERTS } from "./notificationConfig";

/**
 * BUG-P2-003 was that this config persisted nothing. Now that it does, the risk moves to the
 * read side: a hospital that saved its routing before a new alert type shipped must still
 * receive the new alert, and must not be able to downgrade a critical alert's severity by
 * hand-editing stored JSON.
 */
describe("mergeAlerts", () => {
  it("returns the shipped defaults when nothing is stored", () => {
    expect(mergeAlerts(null)).toEqual(DEFAULT_ALERTS);
    expect(mergeAlerts(undefined)).toEqual(DEFAULT_ALERTS);
    expect(mergeAlerts("not an array")).toEqual(DEFAULT_ALERTS);
    expect(mergeAlerts({})).toEqual(DEFAULT_ALERTS);
  });

  it("applies a stored channel choice over the default", () => {
    const merged = mergeAlerts([{ type: "Critical Lab Value", channel: "whatsapp" }]);
    const rule = merged.find((a) => a.type === "Critical Lab Value");
    expect(rule?.channel).toBe("whatsapp");
  });

  it("keeps alert types the hospital has never seen", () => {
    // A hospital that saved when only one alert existed must still get the other nine.
    const merged = mergeAlerts([{ type: "Critical Lab Value", channel: "whatsapp" }]);
    expect(merged).toHaveLength(DEFAULT_ALERTS.length);
    expect(merged.map((a) => a.type)).toEqual(DEFAULT_ALERTS.map((a) => a.type));
  });

  it("refuses to take severity from storage", () => {
    // Whether Code Blue is critical is a product decision, not a hospital preference —
    // otherwise a stray edit could silently demote a life-safety alert.
    const merged = mergeAlerts([{ type: "Code Blue", severity: "normal", channel: "in_app" }]);
    const rule = merged.find((a) => a.type === "Code Blue");
    expect(rule?.severity).toBe("critical");
    expect(rule?.channel).toBe("in_app");
  });

  it("ignores stored entries for alert types that no longer exist", () => {
    const merged = mergeAlerts([{ type: "Retired Alert", channel: "both" }]);
    expect(merged.map((a) => a.type)).not.toContain("Retired Alert");
    expect(merged).toEqual(DEFAULT_ALERTS);
  });

  it("survives junk entries inside the stored array", () => {
    const merged = mergeAlerts([null, 42, "x", { type: "Drug Stockout", active: false }]);
    expect(merged).toHaveLength(DEFAULT_ALERTS.length);
    expect(merged.find((a) => a.type === "Drug Stockout")?.active).toBe(false);
  });

  it("can deactivate an alert", () => {
    const merged = mergeAlerts([{ type: "New Admission", active: false }]);
    expect(merged.find((a) => a.type === "New Admission")?.active).toBe(false);
    expect(merged.find((a) => a.type === "Code Blue")?.active).toBe(true);
  });
});

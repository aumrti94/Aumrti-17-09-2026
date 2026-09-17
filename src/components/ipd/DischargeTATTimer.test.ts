import { describe, it, expect } from "vitest";
import { DEFAULT_ALERT_HOURS, DEFAULT_ESCALATE_HOURS } from "./DischargeTATTimer";

/**
 * Phase 5 settings sweep — KNOWN-BUG-141.
 *
 * SettingsThresholdsPage.tsx's "Discharge TAT" fields were never saved at all (handleSave only
 * ever wrote deviceConfig), and even once fixed, the page's own placeholder defaults (3h/5h)
 * did not match this component's real hardcoded behaviour (2h/3h) — so a hospital that opened
 * Settings and saw "Alert if discharge > 3 hours" was looking at a number describing nothing
 * real. Both files now share DischargeTATTimer's actual defaults as the single source of truth
 * for "what a hospital that never touched this setting experiences." This test is the guard
 * against the two drifting apart again — it does not duplicate SettingsThresholdsPage's own
 * `defaults` object (a plain literal, not exported), so a future edit to one side without the
 * other fails silently unless checked by hand; recorded here as the explicit expectation.
 */
describe("DischargeTATTimer defaults — must match SettingsThresholdsPage's displayed defaults", () => {
  it("alert default is 2 hours", () => {
    expect(DEFAULT_ALERT_HOURS).toBe(2);
  });

  it("escalate default is 3 hours", () => {
    expect(DEFAULT_ESCALATE_HOURS).toBe(3);
  });

  it("alert is always stricter than escalate", () => {
    expect(DEFAULT_ALERT_HOURS).toBeLessThan(DEFAULT_ESCALATE_HOURS);
  });
});

import { describe, it, expect } from "vitest";
import { NON_AI_SERVICE_KEYS } from "./APIConfigHubPage";

/**
 * Phase 5 settings sweep — KNOWN-BUG-139 and KNOWN-BUG-144.
 *
 * This screen wrote to the SAME api_configurations row as two dedicated, correct screens —
 * SettingsRazorpayPage.tsx (service_key='razorpay') and, once GST/NIC IRP was wired up,
 * SettingsGSTPage.tsx (service_key='nic_irp') — with an incompatible shape. This screen's
 * saveApiKey() does a full `config` REPLACE, so saving anything here after configuring either
 * integration via its own dedicated screen would silently discard the real credentials that
 * screen writes and the corresponding edge function reads — an active data-corruption bug, not
 * a missing feature.
 *
 * The fix is "this screen must never touch either row again," which is exactly what
 * NON_AI_SERVICE_KEYS controls (it gates both which services render in the table AND which
 * service_key values saveApiKey()/testApiKey() can act on). This test is the one line standing
 * between that invariant and a regression.
 */
describe("APIConfigHubPage — collisions this screen must never reintroduce", () => {
  it("never lists razorpay or nic_irp as an editable service", () => {
    expect(NON_AI_SERVICE_KEYS).not.toContain("razorpay");
    expect(NON_AI_SERVICE_KEYS).not.toContain("nic_irp");
  });

  it("still manages the services that don't collide with a dedicated screen", () => {
    // Not a blanket "nothing changed" check — pins the actual remaining set, so removing one
    // of these (or silently re-adding razorpay/nic_irp) shows up as a diff here, not just in
    // behavior.
    expect(NON_AI_SERVICE_KEYS).toEqual(["wati", "abdm", "pmjay"]);
  });
});

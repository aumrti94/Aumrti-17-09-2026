import { describe, it, expect, beforeEach } from "vitest";
import { setAIEntitlement, clearAIEntitlement, isAIFeatureAllowed } from "./aiEntitlement";

describe("aiEntitlement — callAI choke-point gate", () => {
  beforeEach(() => clearAIEntitlement());

  it("fail-open when nothing is loaded", () => {
    expect(isAIFeatureAllowed("voice_scribe", "h1")).toBe(true);
  });

  it("fail-open when the cache is for a different hospital", () => {
    setAIEntitlement("h1", { master: false, disabled: new Set() });
    expect(isAIFeatureAllowed("voice_scribe", "h2")).toBe(true); // not h1 → fail-open
    expect(isAIFeatureAllowed("voice_scribe", "h1")).toBe(false); // h1 master off
  });

  it("master off blocks every feature", () => {
    setAIEntitlement("h1", { master: false, disabled: new Set() });
    expect(isAIFeatureAllowed("voice_scribe", "h1")).toBe(false);
    expect(isAIFeatureAllowed("denial_predictor", "h1")).toBe(false);
    expect(isAIFeatureAllowed(undefined, "h1")).toBe(false);
  });

  it("master on allows features except individually-disabled ones", () => {
    setAIEntitlement("h1", { master: true, disabled: new Set(["voice_scribe"]) });
    expect(isAIFeatureAllowed("voice_scribe", "h1")).toBe(false); // withheld
    expect(isAIFeatureAllowed("radiology_impression", "h1")).toBe(true); // allowed
    expect(isAIFeatureAllowed(undefined, "h1")).toBe(true); // no feature key, master on
  });
});

import { describe, it, expect } from "vitest";
import { getTriageModeLabel, EpidemicProtocol } from "./disaster-mode";

describe("getTriageModeLabel — displayed banner text for the active protocol", () => {
  it("labels a mass-casualty protocol distinctly", () => {
    const protocol = { triage_mode: "mass_casualty" } as EpidemicProtocol;
    expect(getTriageModeLabel(protocol)).toBe("Mass Casualty Incident (MCI)");
  });

  it("labels an epidemic protocol distinctly", () => {
    const protocol = { triage_mode: "epidemic" } as EpidemicProtocol;
    expect(getTriageModeLabel(protocol)).toBe("Epidemic Protocol");
  });

  it("falls back to Standard Triage for an unrecognised mode", () => {
    const protocol = { triage_mode: "something_else" } as EpidemicProtocol;
    expect(getTriageModeLabel(protocol)).toBe("Standard Triage");
  });

  it("shows Standard when there is no active protocol at all", () => {
    expect(getTriageModeLabel(null)).toBe("Standard");
  });
});

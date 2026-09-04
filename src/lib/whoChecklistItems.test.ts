import { describe, it, expect } from "vitest";
import { SIGNIN_ITEMS, TIMEOUT_ITEMS, SIGNOUT_ITEMS } from "./whoChecklistItems";

describe("WHO Surgical Safety Checklist item lists", () => {
  it.each([
    ["SIGNIN_ITEMS", SIGNIN_ITEMS],
    ["TIMEOUT_ITEMS", TIMEOUT_ITEMS],
    ["SIGNOUT_ITEMS", SIGNOUT_ITEMS],
  ])("%s has a unique key and a non-empty label for every item", (_name, items) => {
    const keys = items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const item of items) {
      expect(item.label.length).toBeGreaterThan(0);
    }
  });

  it("SIGNIN_ITEMS covers patient identity, site marking, and known allergies — the WHO Sign In phase essentials", () => {
    const keys = SIGNIN_ITEMS.map((i) => i.key);
    expect(keys).toContain("signin_patient_identity");
    expect(keys).toContain("signin_site_marked");
    expect(keys).toContain("signin_allergies_known");
  });

  it("TIMEOUT_ITEMS covers procedure and site re-confirmation — the WHO Time Out phase essentials", () => {
    const keys = TIMEOUT_ITEMS.map((i) => i.key);
    expect(keys).toContain("timeout_procedure_confirmed");
    expect(keys).toContain("timeout_site_confirmed");
  });

  it("SIGNOUT_ITEMS covers instrument and swab counts — the WHO Sign Out phase essentials", () => {
    const keys = SIGNOUT_ITEMS.map((i) => i.key);
    expect(keys).toContain("signout_instrument_count");
    expect(keys).toContain("signout_swab_count");
  });

  it("each phase's keys are prefixed with that phase's name, so a mis-filed item is obvious", () => {
    expect(SIGNIN_ITEMS.every((i) => i.key.startsWith("signin_"))).toBe(true);
    expect(TIMEOUT_ITEMS.every((i) => i.key.startsWith("timeout_"))).toBe(true);
    expect(SIGNOUT_ITEMS.every((i) => i.key.startsWith("signout_"))).toBe(true);
  });
});

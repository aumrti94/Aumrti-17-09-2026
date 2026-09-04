import { describe, it, expect } from "vitest";
import { PAYMENT_MODES } from "./paymentModes";

describe("PAYMENT_MODES — shared billing/OPD/registration payment options", () => {
  it("has a unique, stable value for every mode", () => {
    const values = PAYMENT_MODES.map((m) => m.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toEqual([
      "cash",
      "upi",
      "card",
      "net_banking",
      "cheque",
      "insurance",
      "pmjay",
      "advance_adjust",
    ]);
  });

  it("gives every mode a non-empty label", () => {
    for (const mode of PAYMENT_MODES) {
      expect(mode.label.length).toBeGreaterThan(0);
    }
  });

  it("covers the government-scheme payment path (PMJAY)", () => {
    expect(PAYMENT_MODES.some((m) => m.value === "pmjay")).toBe(true);
  });
});

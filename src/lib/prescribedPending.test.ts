import { describe, it, expect } from "vitest";
import { subtractOrdered } from "./prescribedPending";

describe("subtractOrdered", () => {
  it("keeps names that have not been ordered", () => {
    expect(subtractOrdered(["CBC", "LFT"], new Set(["cbc"]))).toEqual(["LFT"]);
  });

  it("matches case- and whitespace-insensitively", () => {
    // The prescription stores whatever the doctor picked; the order stores the master's
    // spelling. Comparing them raw re-offered tests that were already ordered.
    expect(subtractOrdered(["  HbA1c  "], new Set(["hba1c"]))).toEqual([]);
  });

  it("returns everything when nothing is ordered yet", () => {
    expect(subtractOrdered(["CBC", "KFT"], new Set())).toEqual(["CBC", "KFT"]);
  });

  it("returns nothing when everything is ordered", () => {
    expect(subtractOrdered(["CBC"], new Set(["cbc"]))).toEqual([]);
  });

  it("preserves the prescribed order", () => {
    expect(subtractOrdered(["TSH", "CBC", "LFT"], new Set(["cbc"]))).toEqual(["TSH", "LFT"]);
  });

  it("handles an empty prescription", () => {
    expect(subtractOrdered([], new Set(["cbc"]))).toEqual([]);
  });
});

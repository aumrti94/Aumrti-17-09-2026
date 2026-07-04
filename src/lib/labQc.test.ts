// Lab module completion plan, Phase 2 — unit tests for the Westgard rules extracted
// from LabQCDashboard into src/lib/labQc.ts.
import { describe, it, expect } from "vitest";
import { checkWestgardRules } from "./labQc";

const rules = (w: { rule: string }[]) => w.map(x => x.rule);

describe("checkWestgardRules", () => {
  it("returns nothing with fewer than 2 values or zero SD", () => {
    expect(checkWestgardRules([105], 100, 5)).toEqual([]);
    expect(checkWestgardRules([105, 90], 100, 0)).toEqual([]);
  });

  it("passes an in-control run", () => {
    expect(checkWestgardRules([101, 99, 102, 98], 100, 5)).toEqual([]);
  });

  it("fires 1-3s reject when latest exceeds 3 SD", () => {
    const w = checkWestgardRules([100, 120], 100, 5); // z = +4
    expect(rules(w)).toContain("1-3s");
    expect(w.find(x => x.rule === "1-3s")?.severity).toBe("reject");
  });

  it("fires 1-2s warning between 2 and 3 SD", () => {
    const w = checkWestgardRules([100, 112], 100, 5); // z = +2.4
    expect(rules(w)).toContain("1-2s");
    expect(w.find(x => x.rule === "1-2s")?.severity).toBe("warning");
  });

  it("fires 2-2s reject for two consecutive values beyond +2 SD (and -2 SD)", () => {
    expect(rules(checkWestgardRules([100, 111, 112], 100, 5))).toContain("2-2s");
    expect(rules(checkWestgardRules([100, 89, 88], 100, 5))).toContain("2-2s");
  });

  it("fires R-4s reject when consecutive values span more than 4 SD", () => {
    const w = checkWestgardRules([111, 89], 100, 5); // z: +2.2 → -2.2, range 4.4
    expect(rules(w)).toContain("R-4s");
  });

  it("fires 10x drift warning for 10 consecutive values on one side of the mean", () => {
    const above = Array.from({ length: 10 }, () => 101);
    const w = checkWestgardRules(above, 100, 5);
    expect(rules(w)).toContain("10x");
    expect(w.find(x => x.rule === "10x")?.severity).toBe("warning");
  });
});

import { describe, it, expect } from "vitest";
import {
  resolveEncounterAllowance, APPROACHING_THRESHOLD, DEFAULT_NEGATIVE_BUFFER,
} from "./encounterAllowance";

describe("resolveEncounterAllowance — not metered", () => {
  it("a NULL allowance means not metered, never zero-included", () => {
    // Every plan predating this feature has NULL. Reading that as "0 included"
    // would drop the whole existing base straight into a top-up prompt.
    const r = resolveEncounterAllowance({ used: 900, included: null });
    expect(r).toMatchObject({ metered: false, state: "not_metered", pctUsed: null, drawingCredits: false });
  });

  it("a zero allowance is treated as not metered, not as an exhausted one", () => {
    expect(resolveEncounterAllowance({ used: 5, included: 0 }).state).toBe("not_metered");
  });

  it("still reports the credit balance when not metered", () => {
    expect(resolveEncounterAllowance({ used: 0, included: null, creditBalance: 500 }).creditsLeft).toBe(500);
  });
});

describe("resolveEncounterAllowance — within the monthly allowance", () => {
  it("well under the allowance is ok", () => {
    const r = resolveEncounterAllowance({ used: 100, included: 400 });
    expect(r).toMatchObject({ state: "ok", allowanceLeft: 300, drawingCredits: false, pctUsed: 25 });
  });

  it("starts mentioning it exactly at the approaching threshold", () => {
    const r = resolveEncounterAllowance({ used: 400 * APPROACHING_THRESHOLD, included: 400 });
    expect(r.state).toBe("approaching");
  });

  it("stays quiet just below the threshold", () => {
    expect(resolveEncounterAllowance({ used: 319, included: 400 }).state).toBe("ok");
  });

  it("landing exactly on the allowance has not started drawing credits", () => {
    const r = resolveEncounterAllowance({ used: 400, included: 400, creditBalance: 500 });
    expect(r).toMatchObject({ state: "approaching", allowanceLeft: 0, drawingCredits: false, creditsLeft: 500 });
  });
});

describe("resolveEncounterAllowance — credits absorb the overage", () => {
  it("allowance is consumed before credits — a quiet month never burns them", () => {
    const r = resolveEncounterAllowance({ used: 250, included: 400, creditBalance: 500 });
    expect(r.creditsLeft).toBe(500);
    expect(r.drawingCredits).toBe(false);
  });

  it("draws on credits only for units past the allowance", () => {
    // 450 used, 400 included → 50 over → 500 credits become 450.
    const r = resolveEncounterAllowance({ used: 450, included: 400, creditBalance: 500 });
    expect(r).toMatchObject({ state: "using_credits", drawingCredits: true, creditsLeft: 450, allowanceLeft: 0 });
  });

  it("goes negative rather than blocking when credits run out", () => {
    const r = resolveEncounterAllowance({ used: 450, included: 400, creditBalance: 10 });
    expect(r.creditsLeft).toBe(-40);
    expect(r.state).toBe("negative");
    expect(r.belowBuffer).toBe(false); // within the tolerated buffer
  });

  it("escalates once past the negative buffer, but still never blocks", () => {
    const r = resolveEncounterAllowance({
      used: 400 + DEFAULT_NEGATIVE_BUFFER + 10, included: 400, creditBalance: 0,
    });
    expect(r.belowBuffer).toBe(true);
    expect(r.state).toBe("negative");
    // The contract that matters: there is no blocked/denied state at all.
    expect(["not_metered", "ok", "approaching", "using_credits", "negative"]).toContain(r.state);
  });

  it("respects a custom buffer", () => {
    const r = resolveEncounterAllowance({ used: 405, included: 400, creditBalance: 0, negativeBuffer: 2 });
    expect(r.belowBuffer).toBe(true);
  });
});

describe("resolveEncounterAllowance — input hygiene", () => {
  it("accepts numeric strings, as PostgREST delivers counts", () => {
    const r = resolveEncounterAllowance({ used: "450", included: "400", creditBalance: "500" });
    expect(r).toMatchObject({ metered: true, used: 450, included: 400, creditsLeft: 450 });
  });

  it("treats missing usage as zero, not NaN", () => {
    const r = resolveEncounterAllowance({ used: null, included: 400 });
    expect(r).toMatchObject({ used: 0, pctUsed: 0, state: "ok" });
  });

  it("clamps negative usage rather than crediting the hospital for it", () => {
    expect(resolveEncounterAllowance({ used: -20, included: 400 }).used).toBe(0);
  });
});

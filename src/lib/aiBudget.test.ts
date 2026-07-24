import { describe, it, expect } from "vitest";
import { resolveAiBudgetStatus, APPROACHING_THRESHOLD } from "./aiBudget";

describe("resolveAiBudgetStatus — not metered", () => {
  it("a NULL budget means not metered, never zero-allowed", () => {
    // Every plan predating this feature has NULL. Reading that as "0 included"
    // would put the entire existing customer base over budget on day one.
    const r = resolveAiBudgetStatus({ meteredCostInr: 4000, budgetInr: null });
    expect(r).toMatchObject({ budgeted: false, state: "ok", pctUsed: null, overageInr: 0 });
    expect(r.usedInr).toBe(4000);
  });

  it("a zero or negative budget is treated as not metered, not as a hard cap", () => {
    expect(resolveAiBudgetStatus({ meteredCostInr: 10, budgetInr: 0 }).budgeted).toBe(false);
    expect(resolveAiBudgetStatus({ meteredCostInr: 10, budgetInr: -5 }).state).toBe("ok");
  });
});

describe("resolveAiBudgetStatus — states", () => {
  const B = 2000; // ₹2,000 — the Professional plan's monthly AI allowance

  it("well under budget is ok", () => {
    const r = resolveAiBudgetStatus({ meteredCostInr: 500, budgetInr: B });
    expect(r).toMatchObject({ budgeted: true, state: "ok", overageInr: 0 });
    expect(r.pctUsed).toBe(25);
  });

  it("starts nudging exactly at the approaching threshold", () => {
    const r = resolveAiBudgetStatus({ meteredCostInr: B * APPROACHING_THRESHOLD, budgetInr: B });
    expect(r.state).toBe("approaching");
  });

  it("stays quiet just below the threshold", () => {
    const r = resolveAiBudgetStatus({ meteredCostInr: B * APPROACHING_THRESHOLD - 0.01, budgetInr: B });
    expect(r.state).toBe("ok");
  });

  it("landing exactly on the budget is within it, not over", () => {
    const r = resolveAiBudgetStatus({ meteredCostInr: B, budgetInr: B });
    expect(r.state).toBe("approaching");
    expect(r.overageInr).toBe(0);
    expect(r.pctUsed).toBe(100);
  });

  it("reports overage above the budget", () => {
    const r = resolveAiBudgetStatus({ meteredCostInr: 2500, budgetInr: B });
    expect(r).toMatchObject({ state: "over", overageInr: 500 });
    expect(r.pctUsed).toBe(125);
  });
});

describe("resolveAiBudgetStatus — safety exclusion", () => {
  it("safety spend is reported but never counted toward the cap", () => {
    // The invariant the whole design rests on: a hospital must never be pushed
    // over budget by its drug-interaction checks.
    const r = resolveAiBudgetStatus({ meteredCostInr: 800, budgetInr: 2000, safetyCostInr: 5000 });
    expect(r.safetyInr).toBe(5000);
    expect(r.usedInr).toBe(800);
    expect(r.state).toBe("ok");
    expect(r.overageInr).toBe(0);
  });

  it("omitting safety cost defaults it to zero rather than NaN", () => {
    const r = resolveAiBudgetStatus({ meteredCostInr: 500, budgetInr: 2000 });
    expect(r.safetyInr).toBe(0);
  });
});

describe("resolveAiBudgetStatus — input hygiene", () => {
  it("accepts numeric strings, as PostgREST delivers numerics", () => {
    const r = resolveAiBudgetStatus({ meteredCostInr: "1250.5000", budgetInr: "2000.00", safetyCostInr: "15.50" });
    expect(r).toMatchObject({ budgeted: true, usedInr: 1250.5, budgetInr: 2000, safetyInr: 15.5 });
  });

  it("treats null/undefined usage as zero spend", () => {
    const r = resolveAiBudgetStatus({ meteredCostInr: null, budgetInr: 2000 });
    expect(r).toMatchObject({ usedInr: 0, state: "ok", pctUsed: 0 });
  });
});

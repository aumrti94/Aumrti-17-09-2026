import { describe, it, expect } from "vitest";
import { PLATFORM_STATUS_PILL, computeHealthScore } from "./platform-utils";

describe("PLATFORM_STATUS_PILL", () => {
  it("has a style entry for every subscription status the platform actually uses", () => {
    for (const status of ["active", "trial", "suspended", "past_due", "cancelled", "no_subscription"]) {
      expect(PLATFORM_STATUS_PILL[status]).toBeDefined();
    }
  });
});

describe("computeHealthScore — hospital churn-risk score (ChurnRadar / HospitalsList)", () => {
  it("gives a new hospital (<14 days) a status-based base score, not a usage penalty", () => {
    // A brand-new active hospital shouldn't be scored down just for lacking usage history yet.
    const score = computeHealthScore({ created_at: new Date().toISOString(), status: "active" });
    expect(score).toBe(78);
  });

  it("scores a new but suspended hospital lower than a new active one", () => {
    const active = computeHealthScore({ created_at: new Date().toISOString(), status: "active" });
    const suspended = computeHealthScore({ created_at: new Date().toISOString(), status: "suspended" });
    expect(suspended).toBeLessThan(active);
  });

  it("gives an unrecognised status a neutral fallback score while still new", () => {
    const score = computeHealthScore({ created_at: new Date().toISOString(), status: "weird_status" });
    expect(score).toBe(55);
  });

  function daysAgo(days: number): string {
    return new Date(Date.now() - days * 86400000).toISOString();
  }

  it("rewards real usage signals for an established hospital", () => {
    const withUsage = computeHealthScore({
      created_at: daysAgo(200),
      status: "active",
      hasRecentOpd: true,
      hasRecentBilling: true,
    });
    const withoutUsage = computeHealthScore({
      created_at: daysAgo(200),
      status: "active",
      hasRecentOpd: false,
      hasRecentBilling: false,
    });
    expect(withUsage).toBeGreaterThan(withoutUsage);
  });

  it("rewards longer tenure for an otherwise-identical hospital", () => {
    const established = computeHealthScore({ created_at: daysAgo(200), status: "active" });
    const recent = computeHealthScore({ created_at: daysAgo(40), status: "active" });
    expect(established).toBeGreaterThan(recent);
  });

  it("scores a suspended, inactive, long-tenured hospital at the bottom of the scale", () => {
    const score = computeHealthScore({
      created_at: daysAgo(200),
      status: "suspended",
      hasRecentOpd: false,
      hasRecentBilling: false,
    });
    // 0 (activity) + 0 (payment) + 20 (tenure >180d) = 20
    expect(score).toBe(20);
  });

  it("caps the score at 100", () => {
    const score = computeHealthScore({
      created_at: daysAgo(1000),
      status: "active",
      hasRecentOpd: true,
      hasRecentBilling: true,
    });
    expect(score).toBeLessThanOrEqual(100);
  });
});

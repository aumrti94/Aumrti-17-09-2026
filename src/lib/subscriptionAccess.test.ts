import { describe, it, expect } from "vitest";
import {
  resolveSubscriptionAccess,
  SUBSCRIPTION_GRACE_DAYS,
} from "./subscriptionAccess";

const NOW = new Date("2026-07-22T10:00:00Z");
const DAY = 86_400_000;
/** Timestamp `d` days from NOW (negative = in the past). */
const at = (d: number) => new Date(NOW.getTime() + d * DAY).toISOString();

describe("resolveSubscriptionAccess", () => {
  it("allows writes when there is no subscription row (onboarding)", () => {
    expect(resolveSubscriptionAccess(null, NOW).blocked).toBe(false);
    expect(resolveSubscriptionAccess(undefined, NOW).blocked).toBe(false);
  });

  it("allows an active subscription", () => {
    expect(resolveSubscriptionAccess({ status: "active" }, NOW).blocked).toBe(false);
  });

  it("allows a trial with time left", () => {
    const a = resolveSubscriptionAccess({ status: "trial", trial_ends_at: at(5) }, NOW);
    expect(a.blocked).toBe(false);
    expect(a.inGrace).toBe(false);
  });

  it("allows writes inside the grace window but flags inGrace", () => {
    const a = resolveSubscriptionAccess({ status: "trial", trial_ends_at: at(-1) }, NOW);
    expect(a.blocked).toBe(false);
    expect(a.inGrace).toBe(true);
    expect(a.graceEndsAt?.getTime()).toBe(new Date(at(-1)).getTime() + SUBSCRIPTION_GRACE_DAYS * DAY);
  });

  it("still allows at the last moment of grace, blocks just past it", () => {
    // Boundary: trial ended exactly SUBSCRIPTION_GRACE_DAYS ago → grace ends exactly now.
    expect(
      resolveSubscriptionAccess({ status: "trial", trial_ends_at: at(-SUBSCRIPTION_GRACE_DAYS) }, NOW).blocked,
    ).toBe(false);
    expect(
      resolveSubscriptionAccess(
        { status: "trial", trial_ends_at: new Date(NOW.getTime() - SUBSCRIPTION_GRACE_DAYS * DAY - 1000).toISOString() },
        NOW,
      ).blocked,
    ).toBe(true);
  });

  it("blocks a trial that expired well past the grace window", () => {
    // The reported bug: this hospital kept billing patients for days after expiry.
    const a = resolveSubscriptionAccess({ status: "trial", trial_ends_at: at(-30) }, NOW);
    expect(a.blocked).toBe(true);
    expect(a.reason).toBe("trial_expired");
    expect(a.inGrace).toBe(false);
  });

  it("blocks suspended and cancelled immediately", () => {
    expect(resolveSubscriptionAccess({ status: "suspended" }, NOW)).toMatchObject({ blocked: true, reason: "suspended" });
    expect(resolveSubscriptionAccess({ status: "cancelled" }, NOW)).toMatchObject({ blocked: true, reason: "cancelled" });
  });

  it("does NOT block past_due until it has an anchor (past_due_since)", () => {
    expect(resolveSubscriptionAccess({ status: "past_due" }, NOW).blocked).toBe(false);
    expect(resolveSubscriptionAccess({ status: "past_due", past_due_since: null }, NOW).blocked).toBe(false);
  });

  it("allows past_due inside the buffer, blocks past it", () => {
    const inBuffer = resolveSubscriptionAccess({ status: "past_due", past_due_since: at(-1) }, NOW);
    expect(inBuffer.blocked).toBe(false);
    expect(inBuffer.inGrace).toBe(true);

    const expired = resolveSubscriptionAccess({ status: "past_due", past_due_since: at(-30) }, NOW);
    expect(expired.blocked).toBe(true);
    expect(expired.reason).toBe("past_due");
  });

  it("honours a configurable grace window for past_due", () => {
    // 5-day buffer: a failure 4 days ago is still allowed, 6 days ago is blocked.
    expect(resolveSubscriptionAccess({ status: "past_due", past_due_since: at(-4) }, NOW, 5).blocked).toBe(false);
    expect(resolveSubscriptionAccess({ status: "past_due", past_due_since: at(-6) }, NOW, 5).blocked).toBe(true);
  });

  it("honours a configurable grace window for trials", () => {
    // 0-day buffer: an expired trial blocks immediately.
    expect(resolveSubscriptionAccess({ status: "trial", trial_ends_at: at(-0.5) }, NOW, 0).blocked).toBe(true);
  });

  it("fails open on a null or unparseable trial_ends_at", () => {
    expect(resolveSubscriptionAccess({ status: "trial", trial_ends_at: null }, NOW).blocked).toBe(false);
    expect(resolveSubscriptionAccess({ status: "trial", trial_ends_at: "not-a-date" }, NOW).blocked).toBe(false);
  });

  it("fails open on an unknown status", () => {
    expect(resolveSubscriptionAccess({ status: "something_new" }, NOW).blocked).toBe(false);
  });

  it("is case-insensitive on status", () => {
    expect(resolveSubscriptionAccess({ status: "SUSPENDED" }, NOW).blocked).toBe(true);
  });
});

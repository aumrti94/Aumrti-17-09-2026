import { describe, it, expect, afterEach } from "vitest";
import { setSubscriptionLock, shouldBlockRequest } from "./subscriptionLock";

const REST = "https://abc.supabase.co/rest/v1";

afterEach(() => setSubscriptionLock(false));

describe("shouldBlockRequest", () => {
  it("blocks nothing while unlocked", () => {
    expect(shouldBlockRequest(`${REST}/patients`, "POST")).toBe(false);
  });

  it("blocks table writes when locked", () => {
    setSubscriptionLock(true);
    for (const m of ["POST", "PATCH", "PUT", "DELETE", "delete"]) {
      expect(shouldBlockRequest(`${REST}/bills`, m)).toBe(true);
    }
  });

  it("never blocks reads — an expired hospital keeps access to its own records", () => {
    setSubscriptionLock(true);
    expect(shouldBlockRequest(`${REST}/patients?select=*`, "GET")).toBe(false);
    expect(shouldBlockRequest(`${REST}/patients`, "HEAD")).toBe(false);
  });

  it("keeps the pay-us and login paths writable so the lock is recoverable", () => {
    setSubscriptionLock(true);
    expect(shouldBlockRequest(`${REST}/hospital_subscriptions`, "PATCH")).toBe(false);
    expect(shouldBlockRequest(`${REST}/platform_support_tickets`, "POST")).toBe(false);
    expect(shouldBlockRequest(`${REST}/users?id=eq.1`, "PATCH")).toBe(false);
    expect(shouldBlockRequest(`${REST}/audit_log`, "POST")).toBe(false);
  });

  it("leaves auth, edge functions and storage alone", () => {
    setSubscriptionLock(true);
    expect(shouldBlockRequest("https://abc.supabase.co/auth/v1/token", "POST")).toBe(false);
    expect(shouldBlockRequest("https://abc.supabase.co/functions/v1/ai-proxy", "POST")).toBe(false);
    expect(shouldBlockRequest("https://abc.supabase.co/storage/v1/object/x", "POST")).toBe(false);
  });

  it("lets RPCs through — they may be reads; RPC writes are caught by the DB trigger", () => {
    setSubscriptionLock(true);
    expect(shouldBlockRequest(`${REST}/rpc/recalculate_bill_totals`, "POST")).toBe(false);
  });

  it("ignores the query string when resolving the table", () => {
    setSubscriptionLock(true);
    expect(shouldBlockRequest(`${REST}/bills?id=eq.7&select=*`, "PATCH")).toBe(true);
  });
});

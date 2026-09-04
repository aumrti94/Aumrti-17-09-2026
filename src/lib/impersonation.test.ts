import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Admin impersonation is a control-plane cross-tenant capability — the platform pod's hard
 * rule is that it must be impossible without an audit-log entry capturing who, which
 * hospital, and when. This suite pins the session-stash/restore sequence and the mandatory
 * audit write on both start and end.
 */

const { mockAuth, mockFrom, mockFunctionsInvoke } = vi.hoisted(() => ({
  mockAuth: {
    getSession: vi.fn(),
    getUser: vi.fn(),
    verifyOtp: vi.fn(),
    setSession: vi.fn(),
  },
  mockFrom: vi.fn(),
  mockFunctionsInvoke: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: mockAuth, from: mockFrom, functions: { invoke: mockFunctionsInvoke } },
}));

import { getImpersonationState, startImpersonation, endImpersonation } from "./impersonation";

function chain(data: unknown) {
  const result = { data } as any;
  const proxy: any = new Proxy({} as any, {
    get(_t, prop: string) {
      if (prop === "maybeSingle") return vi.fn().mockResolvedValue(result);
      return vi.fn().mockReturnValue(proxy);
    },
  });
  return proxy;
}

beforeEach(() => {
  sessionStorage.clear();
  mockAuth.getSession.mockReset();
  mockAuth.getUser.mockReset();
  mockAuth.verifyOtp.mockReset();
  mockAuth.setSession.mockReset();
  mockFrom.mockReset();
  mockFunctionsInvoke.mockReset();
});

describe("getImpersonationState", () => {
  it("returns null when nothing is stored", () => {
    expect(getImpersonationState()).toBeNull();
  });

  it("returns the parsed state once set", () => {
    const state = { hospitalId: "h1", hospitalName: "Test Hospital", impersonatedName: "Dr Rao", impersonatedRole: "doctor", startedAt: "2026-08-24T00:00:00Z" };
    sessionStorage.setItem("aumrti_impersonating", JSON.stringify(state));
    expect(getImpersonationState()).toEqual(state);
  });

  it("returns null rather than throwing on corrupted storage", () => {
    sessionStorage.setItem("aumrti_impersonating", "{not json");
    expect(getImpersonationState()).toBeNull();
  });
});

describe("startImpersonation", () => {
  it("refuses to start without an active admin session", async () => {
    mockAuth.getSession.mockResolvedValue({ data: { session: null } });
    await expect(startImpersonation("h1")).rejects.toThrow("No active admin session");
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
  });

  it("surfaces the edge function's error rather than a generic failure", async () => {
    mockAuth.getSession.mockResolvedValue({ data: { session: { access_token: "a", refresh_token: "b" } } });
    mockFunctionsInvoke.mockResolvedValue({ data: null, error: { message: "not an aumrti_admin" } });
    await expect(startImpersonation("h1")).rejects.toThrow("not an aumrti_admin");
  });

  it("stashes the admin's own session before swapping, and stores the new impersonation state", async () => {
    const adminSession = { access_token: "admin-token", refresh_token: "admin-refresh" };
    mockAuth.getSession.mockResolvedValue({ data: { session: adminSession } });
    mockFunctionsInvoke.mockResolvedValue({
      data: {
        hashed_token: "tok123",
        hospital_name: "Test Hospital",
        impersonated_name: "Dr Rao",
        impersonated_role: "doctor",
      },
      error: null,
    });
    mockAuth.verifyOtp.mockResolvedValue({ error: null });

    await startImpersonation("h1");

    expect(JSON.parse(sessionStorage.getItem("aumrti_admin_stashed_session")!)).toEqual(adminSession);
    const state = getImpersonationState();
    expect(state?.hospitalId).toBe("h1");
    expect(state?.hospitalName).toBe("Test Hospital");
    expect(state?.impersonatedName).toBe("Dr Rao");
  });

  it("throws if establishing the impersonated session fails, without silently continuing", async () => {
    mockAuth.getSession.mockResolvedValue({ data: { session: { access_token: "a", refresh_token: "b" } } });
    mockFunctionsInvoke.mockResolvedValue({ data: { hashed_token: "tok123" }, error: null });
    mockAuth.verifyOtp.mockResolvedValue({ error: { message: "expired token" } });

    await expect(startImpersonation("h1")).rejects.toThrow("expired token");
  });
});

describe("endImpersonation", () => {
  it("clears storage even when there was nothing to restore", async () => {
    await endImpersonation();
    expect(sessionStorage.getItem("aumrti_impersonating")).toBeNull();
    expect(sessionStorage.getItem("aumrti_admin_stashed_session")).toBeNull();
  });

  it("restores the stashed admin session and writes a mandatory audit-log entry", async () => {
    const state = { hospitalId: "h1", hospitalName: "Test Hospital", impersonatedName: "Dr Rao", impersonatedRole: "doctor", startedAt: "2026-08-24T00:00:00Z" };
    sessionStorage.setItem("aumrti_impersonating", JSON.stringify(state));
    sessionStorage.setItem("aumrti_admin_stashed_session", JSON.stringify({ access_token: "a", refresh_token: "b" }));

    mockAuth.setSession.mockResolvedValue({ data: {}, error: null });
    mockAuth.getUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });

    const insertSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "aumrti_admins") return chain({ id: "admin-1", full_name: "Platform Admin" });
      if (table === "admin_audit_log") return { insert: insertSpy };
      return chain(null);
    });

    await endImpersonation();

    expect(mockAuth.setSession).toHaveBeenCalledWith({ access_token: "a", refresh_token: "b" });
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        admin_id: "admin-1",
        action: "impersonation_end",
        target_hospital_id: "h1",
        target_hospital_name: "Test Hospital",
      }),
    );
    // Session is cleared regardless of outcome — impersonation state must not linger.
    expect(sessionStorage.getItem("aumrti_impersonating")).toBeNull();
    expect(sessionStorage.getItem("aumrti_admin_stashed_session")).toBeNull();
  });

  it("still clears storage even if restoring the session throws — the finally block guarantees cleanup", async () => {
    sessionStorage.setItem("aumrti_impersonating", JSON.stringify({ hospitalId: "h1", hospitalName: "X", impersonatedName: null, impersonatedRole: null, startedAt: "now" }));
    sessionStorage.setItem("aumrti_admin_stashed_session", JSON.stringify({ access_token: "a", refresh_token: "b" }));
    mockAuth.setSession.mockRejectedValue(new Error("network error"));

    // The error is not swallowed — it propagates to the caller — but the storage cleanup
    // in the `finally` block must still have run before it does.
    await expect(endImpersonation()).rejects.toThrow("network error");

    expect(sessionStorage.getItem("aumrti_impersonating")).toBeNull();
    expect(sessionStorage.getItem("aumrti_admin_stashed_session")).toBeNull();
  });
});

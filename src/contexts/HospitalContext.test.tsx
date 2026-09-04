import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import React from "react";

const { mockGetSession, mockGetUser, mockSignOut, mockOnAuthStateChange, mockFrom, mockChannel, mockRemoveChannel } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetUser: vi.fn(),
  mockSignOut: vi.fn(),
  mockOnAuthStateChange: vi.fn(),
  mockFrom: vi.fn(),
  mockChannel: vi.fn(),
  mockRemoveChannel: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: mockGetSession, getUser: mockGetUser, signOut: mockSignOut, onAuthStateChange: mockOnAuthStateChange },
    from: mockFrom,
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
  },
}));

import { HospitalProvider } from "./HospitalContext";
import { useHospitalContext } from "@/hooks/useHospitalContext";

function makeChain(resolveValue: any) {
  const p: any = Promise.resolve(resolveValue);
  const self = () => p;
  for (const m of ["select", "eq", "insert", "maybeSingle"]) p[m] = self;
  return p;
}

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(HospitalProvider, null, children);

function noEntitlementTables() {
  return (table: string) => {
    if (table === "hospital_module_entitlements") return makeChain({ data: [] });
    if (table === "hospital_subscriptions") return makeChain({ data: null });
    if (table === "hospital_addons") return makeChain({ data: [] });
    if (table === "user_permission_overrides") return makeChain({ data: null });
    if (table === "audit_log") return { insert: () => Promise.resolve({ data: null }) };
    return undefined;
  };
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetUser.mockReset();
  mockSignOut.mockReset();
  mockOnAuthStateChange.mockReset();
  mockFrom.mockReset();
  mockChannel.mockReset();
  mockRemoveChannel.mockReset();
  sessionStorage.clear();
  mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  const chan: any = {};
  chan.on = vi.fn().mockReturnValue(chan);
  chan.subscribe = vi.fn().mockReturnValue(chan);
  mockChannel.mockReturnValue(chan);
});

describe("HospitalProvider", () => {
  it("resolves to a fully-null, not-loading identity when there is no session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    const { result } = renderHook(() => useHospitalContext(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hospitalId).toBeNull();
    expect(result.current.role).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("stops loading without touching identity when auth.getUser errors", async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid token" } });
    const { result } = renderHook(() => useHospitalContext(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hospitalId).toBeNull();
  });

  it("resolves hospitalId, role, and permissions for an active user with a session and no cache", async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth1" } }, error: null });
    const entitlementNoop = noEntitlementTables();
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { id: "u1", hospital_id: "h1", role: "doctor", full_name: "Dr Rao", is_active: true } });
      if (table === "role_permissions") return makeChain({ data: { permissions: { opd: { view: true } } } });
      const generic = entitlementNoop(table);
      if (generic) return generic;
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useHospitalContext(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.hospitalId).toBe("h1");
    expect(result.current.role).toBe("doctor");
    expect(result.current.fullName).toBe("Dr Rao");
    expect(result.current.permissions).toEqual({ opd: { view: true } });
  });

  it("signs the user out instead of granting access when their staff record is deactivated", async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { id: "u1", hospital_id: "h1", role: "doctor", full_name: "Dr Rao", is_active: false } });
      throw new Error(`unexpected table ${table}`);
    });
    mockSignOut.mockResolvedValue({ error: null });

    const { result } = renderHook(() => useHospitalContext(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockSignOut).toHaveBeenCalled();
    expect(result.current.hospitalId).toBeNull();
  });

  it("fails closed — clears any identity — when the users lookup itself errors", async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: null, error: { message: "multiple rows" } });
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useHospitalContext(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hospitalId).toBeNull();
    expect(result.current.role).toBeNull();
  });

  it("serves a cached identity immediately, then lets the background revalidation win once it lands", async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth1" } }, error: null });
    sessionStorage.setItem("hms_ctx_auth1", JSON.stringify({
      hospitalId: "h1", userId: "u1", role: "doctor", permissions: { cached: true }, fullName: "Cached Doc", loading: false,
    }));
    const entitlementNoop = noEntitlementTables();
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { id: "u1", hospital_id: "h1", role: "doctor", full_name: "Dr Rao (fresh)", is_active: true } });
      if (table === "role_permissions") return makeChain({ data: { permissions: { fresh: true } } });
      const generic = entitlementNoop(table);
      if (generic) return generic;
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useHospitalContext(), { wrapper });
    // Both the cache read and the background revalidation settle from already-resolved
    // mock promises within the same microtask flush, so only the final state is
    // observable here — the cache's real benefit (an instant paint before any network
    // round-trip lands) only shows up with genuine network latency, not synchronous mocks.
    await waitFor(() => expect(result.current.fullName).toBe("Dr Rao (fresh)"));
    expect(result.current.hospitalId).toBe("h1");
    expect(result.current.permissions).toEqual({ fresh: true });
    expect(result.current.loading).toBe(false);
  });

  it("resets identity on a SIGNED_OUT auth event", async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth1" } }, error: null });
    const entitlementNoop = noEntitlementTables();
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { id: "u1", hospital_id: "h1", role: "doctor", full_name: "Dr Rao", is_active: true } });
      if (table === "role_permissions") return makeChain({ data: null });
      const generic = entitlementNoop(table);
      if (generic) return generic;
      throw new Error(`unexpected table ${table}`);
    });

    let authCallback: any;
    mockOnAuthStateChange.mockImplementation((cb: any) => {
      authCallback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    const { result } = renderHook(() => useHospitalContext(), { wrapper });
    await waitFor(() => expect(result.current.hospitalId).toBe("h1"));

    act(() => authCallback("SIGNED_OUT", null));

    await waitFor(() => expect(result.current.hospitalId).toBeNull());
    expect(result.current.role).toBeNull();
  });
});

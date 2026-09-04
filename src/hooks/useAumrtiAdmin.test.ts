import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const { mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mockGetUser }, from: mockFrom },
}));

import { useAumrtiAdmin } from "./useAumrtiAdmin";

function makeChain(resolveValue: any) {
  const p: any = Promise.resolve(resolveValue);
  const self = () => p;
  for (const m of ["select", "eq", "maybeSingle"]) p[m] = self;
  return p;
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
});

describe("useAumrtiAdmin", () => {
  it("resolves isAdmin:true when the current auth user has an active admin row", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth1" } } });
    mockFrom.mockReturnValue(makeChain({ data: { id: "a1", auth_user_id: "auth1", full_name: "Root", email: "root@aumrti.io", is_active: true, created_at: "2026-01-01" } }));

    const { result } = renderHook(() => useAumrtiAdmin(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.admin?.full_name).toBe("Root");
  });

  it("resolves isAdmin:false with no admin object when there is no signed-in user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { result } = renderHook(() => useAumrtiAdmin(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.admin).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("never reports loading when disabled, so callers don't block on an opted-out query", () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth1" } } });
    const { result } = renderHook(() => useAumrtiAdmin({ enabled: false }), { wrapper });
    expect(result.current.isLoading).toBe(false);
    expect(mockGetUser).not.toHaveBeenCalled();
  });
});

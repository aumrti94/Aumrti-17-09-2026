import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const { mockRpc, mockUseHospitalId } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockUseHospitalId: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mockRpc } }));
vi.mock("@/hooks/useHospitalId", () => ({ useHospitalId: mockUseHospitalId }));

import { usePlatformFeatureFlag } from "./usePlatformFeatureFlag";

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  mockRpc.mockReset();
  mockUseHospitalId.mockReset();
  mockUseHospitalId.mockReturnValue({ hospitalId: "h1" });
});

describe("usePlatformFeatureFlag", () => {
  it("starts loading and defaults to disabled before the RPC resolves", () => {
    mockRpc.mockReturnValue(new Promise(() => {})); // never resolves within this test
    const { result } = renderHook(() => usePlatformFeatureFlag("new_dashboard"), { wrapper });
    expect(result.current).toEqual({ enabled: false, isLoading: true });
  });

  it("resolves to enabled:true when the RPC returns true", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    const { result } = renderHook(() => usePlatformFeatureFlag("new_dashboard"), { wrapper });
    await waitFor(() => expect(result.current).toEqual({ enabled: true, isLoading: false }));
    expect(mockRpc).toHaveBeenCalledWith("resolve_feature_flag", { p_key: "new_dashboard", p_hospital_id: "h1" });
  });

  it("resolves to enabled:false when the RPC returns a falsy value", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => usePlatformFeatureFlag("new_dashboard"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.enabled).toBe(false);
  });

  it("does not call the RPC when there is no hospital id yet", () => {
    mockUseHospitalId.mockReturnValue({ hospitalId: null });
    renderHook(() => usePlatformFeatureFlag("new_dashboard"), { wrapper });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("does not call the RPC for an empty flag key", () => {
    renderHook(() => usePlatformFeatureFlag(""), { wrapper });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const { mockUseHospitalContext, mockFrom, mockChannel, mockRemoveChannel } = vi.hoisted(() => ({
  mockUseHospitalContext: vi.fn(),
  mockFrom: vi.fn(),
  mockChannel: vi.fn(),
  mockRemoveChannel: vi.fn(),
}));
vi.mock("@/hooks/useHospitalContext", () => ({ useHospitalContext: mockUseHospitalContext }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mockFrom, channel: mockChannel, removeChannel: mockRemoveChannel },
}));

import { ProductModeProvider } from "./ProductModeContext";
import { useProductMode } from "@/hooks/useProductMode";

function makeChain(resolveValue: any) {
  const p: any = Promise.resolve(resolveValue);
  const self = () => p;
  for (const m of ["select", "eq", "maybeSingle"]) p[m] = self;
  return p;
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, React.createElement(ProductModeProvider, null, children));
}

beforeEach(() => {
  mockUseHospitalContext.mockReset();
  mockFrom.mockReset();
  mockChannel.mockReset();
  mockRemoveChannel.mockReset();
  sessionStorage.clear();
  const chan: any = {};
  chan.on = vi.fn().mockReturnValue(chan);
  chan.subscribe = vi.fn().mockReturnValue(chan);
  mockChannel.mockReturnValue(chan);
});

describe("ProductModeProvider", () => {
  it("stays loading while the hospital context itself is still loading", () => {
    mockUseHospitalContext.mockReturnValue({ hospitalId: null, loading: true });
    const { result } = renderHook(() => useProductMode(), { wrapper });
    expect(result.current.loadingMode).toBe(true);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("finishes loading with the hospital default when there is no hospital id at all", async () => {
    mockUseHospitalContext.mockReturnValue({ hospitalId: null, loading: false });
    const { result } = renderHook(() => useProductMode(), { wrapper });
    await waitFor(() => expect(result.current.loadingMode).toBe(false));
    expect(result.current.productMode).toBe("hospital");
  });

  it("fetches and caches the product mode for a hospital, then serves the next mount from cache without a network call", async () => {
    mockUseHospitalContext.mockReturnValue({ hospitalId: "h1", loading: false });
    mockFrom.mockReturnValue(makeChain({ data: { mode: "clinic" } }));

    const { result } = renderHook(() => useProductMode(), { wrapper });
    await waitFor(() => expect(result.current.loadingMode).toBe(false));
    expect(result.current.productMode).toBe("clinic");
    expect(mockFrom).toHaveBeenCalledTimes(1);

    mockFrom.mockClear();
    const { result: second } = renderHook(() => useProductMode(), { wrapper });
    await waitFor(() => expect(second.current.loadingMode).toBe(false));
    expect(second.current.productMode).toBe("clinic");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("refreshMode() clears the cache and refetches from the network", async () => {
    mockUseHospitalContext.mockReturnValue({ hospitalId: "h1", loading: false });
    mockFrom.mockReturnValueOnce(makeChain({ data: { mode: "hospital" } })).mockReturnValue(makeChain({ data: { mode: "pharmacy" } }));

    const { result } = renderHook(() => useProductMode(), { wrapper });
    await waitFor(() => expect(result.current.loadingMode).toBe(false));
    expect(result.current.productMode).toBe("hospital");

    await act(async () => {
      result.current.refreshMode();
    });
    await waitFor(() => expect(result.current.productMode).toBe("pharmacy"));
  });

  it("subscribes a realtime channel scoped to the hospital's product_modes changes", async () => {
    mockUseHospitalContext.mockReturnValue({ hospitalId: "h1", loading: false });
    mockFrom.mockReturnValue(makeChain({ data: { mode: "hospital" } }));

    renderHook(() => useProductMode(), { wrapper });
    await waitFor(() => expect(mockChannel).toHaveBeenCalledWith("platform_hms_sync_h1"));
  });
});

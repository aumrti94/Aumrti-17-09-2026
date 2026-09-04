import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const { mockUseHospitalId, mockFrom, mockRpc, mockChannel, mockRemoveChannel } = vi.hoisted(() => ({
  mockUseHospitalId: vi.fn(),
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockChannel: vi.fn(),
  mockRemoveChannel: vi.fn(),
}));
vi.mock("@/hooks/useHospitalId", () => ({ useHospitalId: mockUseHospitalId }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mockFrom, rpc: mockRpc, channel: mockChannel, removeChannel: mockRemoveChannel },
}));

import {
  useSubscriptionConfig,
  useModuleAccess,
  getModuleKeyFromRoute,
  getModuleKeyForPath,
  isModuleKeyAllowed,
} from "./useSubscriptionConfig";
import { CANONICAL_MODULE_KEYS } from "@/lib/moduleKeys";

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
  mockUseHospitalId.mockReset();
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockChannel.mockReset();
  mockRemoveChannel.mockReset();
  const chan: any = {};
  chan.on = vi.fn().mockReturnValue(chan);
  chan.subscribe = vi.fn().mockReturnValue(chan);
  mockChannel.mockReturnValue(chan);
  mockRpc.mockResolvedValue({ data: 7 });
});

describe("getModuleKeyFromRoute", () => {
  it("maps a known route to its module key", () => {
    expect(getModuleKeyFromRoute("/opd")).toBe("opd");
  });

  it("strips a query string before matching", () => {
    expect(getModuleKeyFromRoute("/opd?tab=queue")).toBe("opd");
  });

  it("returns null for an unmapped route", () => {
    expect(getModuleKeyFromRoute("/not-a-real-route")).toBeNull();
  });
});

describe("getModuleKeyForPath", () => {
  it("matches an exact base route", () => {
    expect(getModuleKeyForPath("/billing")).toBe("billing");
  });

  it("matches a sub-path via the longest prefix", () => {
    expect(getModuleKeyForPath("/ipd/icu/123")).toBe("ipd");
  });

  it("prefers the more specific route over a shorter shared prefix", () => {
    expect(getModuleKeyForPath("/billing/closure")).toBe("day_closure");
    expect(getModuleKeyForPath("/billing/closure/history")).toBe("day_closure");
  });

  it("returns null for a path with no gateable module", () => {
    expect(getModuleKeyForPath("/dashboard")).toBeNull();
  });

  it("strips a trailing slash and query string before matching", () => {
    expect(getModuleKeyForPath("/opd/?x=1")).toBe("opd");
  });
});

describe("isModuleKeyAllowed", () => {
  it("always allows an ALWAYS_ENABLED key regardless of the enabled list", () => {
    expect(isModuleKeyAllowed("dashboard", [])).toBe(true);
  });

  it("allows an untracked (non-canonical) key even when not in enabledModules", () => {
    expect(isModuleKeyAllowed("some_future_module", [])).toBe(true);
  });

  it("gates a canonical tracked key on membership in enabledModules", () => {
    expect(isModuleKeyAllowed("opd", ["opd", "ipd"])).toBe(true);
    expect(isModuleKeyAllowed("opd", ["ipd"])).toBe(false);
  });
});

describe("useSubscriptionConfig", () => {
  it("returns the loading default (all modules open) before hospitalId resolves", () => {
    mockUseHospitalId.mockReturnValue({ hospitalId: null });
    const { result } = renderHook(() => useSubscriptionConfig(), { wrapper });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.enabledModules).toEqual(CANONICAL_MODULE_KEYS);
  });

  it("treats a hospital with no subscription row as a fully permissive 30-day trial", async () => {
    mockUseHospitalId.mockReturnValue({ hospitalId: "h1" });
    mockFrom.mockImplementation((table: string) => {
      if (table === "hospital_subscriptions") return makeChain({ data: null, error: null });
      if (table === "hospital_feature_overrides") return makeChain({ data: [] });
      if (table === "hospital_pricing_overrides") return makeChain({ data: null });
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useSubscriptionConfig(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status).toBe("no_subscription");
    expect(result.current.trialDaysLeft).toBe(30);
    expect(result.current.enabledModules).toEqual(CANONICAL_MODULE_KEYS);
    expect(result.current.accessBlocked).toBe(false);
  });

  it("fails open (all modules enabled) when the subscription query errors", async () => {
    mockUseHospitalId.mockReturnValue({ hospitalId: "h1" });
    mockFrom.mockImplementation((table: string) => {
      if (table === "hospital_subscriptions") return makeChain({ data: null, error: { message: "db down" } });
      if (table === "hospital_feature_overrides") return makeChain({ data: [] });
      if (table === "hospital_pricing_overrides") return makeChain({ data: null });
      if (table === "entitlement_fail_open_events") return { insert: () => Promise.resolve({ data: null }) };
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useSubscriptionConfig(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });
    expect(result.current.error).toBeTruthy();
    expect(result.current.accessBlocked).toBe(false);
    expect(result.current.enabledModules).toEqual(CANONICAL_MODULE_KEYS);
  });
});

describe("useModuleAccess", () => {
  it("is optimistically true while the subscription config is still loading", () => {
    mockUseHospitalId.mockReturnValue({ hospitalId: null });
    const { result } = renderHook(() => useModuleAccess("oncology"), { wrapper });
    expect(result.current).toBe(true);
  });
});

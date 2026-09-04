import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const { mockFrom, mockUseHospitalId, mockUseSubscriptionConfig, mockIsModuleKeyAllowed } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockUseHospitalId: vi.fn(),
  mockUseSubscriptionConfig: vi.fn(),
  mockIsModuleKeyAllowed: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));
vi.mock("@/hooks/useHospitalId", () => ({ useHospitalId: mockUseHospitalId }));
vi.mock("@/hooks/useSubscriptionConfig", () => ({
  useSubscriptionConfig: mockUseSubscriptionConfig,
  isModuleKeyAllowed: mockIsModuleKeyAllowed,
}));

import { useAIFeatureFlag, invalidateAIFlagCache } from "./useAIFeatureFlag";

function hospitalChain(flags: Record<string, boolean> | null) {
  return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: flags ? { ai_feature_flags: flags } : null }) }) }) };
}

beforeEach(() => {
  mockFrom.mockReset();
  mockUseHospitalId.mockReset();
  mockUseSubscriptionConfig.mockReset();
  mockIsModuleKeyAllowed.mockReset();
  invalidateAIFlagCache();

  mockUseHospitalId.mockReturnValue({ hospitalId: "h1" });
  mockUseSubscriptionConfig.mockReturnValue({ enabledModules: [], isLoading: false });
  mockIsModuleKeyAllowed.mockReturnValue(true);
});

describe("useAIFeatureFlag", () => {
  it("defaults to the feature's built-in default before the hospital row loads", () => {
    mockFrom.mockReturnValue(hospitalChain(null));
    const { result } = renderHook(() => useAIFeatureFlag("clinical_note"));
    expect(result.current).toBe(true); // DEFAULTS.clinical_note is true
  });

  it("respects an explicit false flag once the hospital row loads", async () => {
    mockFrom.mockReturnValue(hospitalChain({ clinical_note: false }));
    const { result } = renderHook(() => useAIFeatureFlag("clinical_note"));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("is a hard floor: the platform AI-suite master overrides an enabled hospital flag", async () => {
    mockFrom.mockReturnValue(hospitalChain({ clinical_note: true }));
    mockIsModuleKeyAllowed.mockReturnValue(false); // ai_suite not allowed on this plan
    const { result } = renderHook(() => useAIFeatureFlag("clinical_note"));
    await waitFor(() => expect(mockFrom).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it("treats the master as open while the subscription config is still loading", () => {
    mockUseSubscriptionConfig.mockReturnValue({ enabledModules: [], isLoading: true });
    mockFrom.mockReturnValue(hospitalChain(null));
    const { result } = renderHook(() => useAIFeatureFlag("clinical_note"));
    expect(result.current).toBe(true); // not blocked just because the plan hasn't resolved yet
  });

  it("does not query when there is no hospital id yet", () => {
    mockUseHospitalId.mockReturnValue({ hospitalId: null });
    renderHook(() => useAIFeatureFlag("clinical_note"));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("reuses the cached flags for a second feature on the same hospital, without a second query", async () => {
    mockFrom.mockReturnValue(hospitalChain({ clinical_note: false, icd_suggest: false }));
    const first = renderHook(() => useAIFeatureFlag("clinical_note"));
    await waitFor(() => expect(first.result.current).toBe(false));

    mockFrom.mockClear();
    const second = renderHook(() => useAIFeatureFlag("icd_suggest"));
    await waitFor(() => expect(second.result.current).toBe(false));
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

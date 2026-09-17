import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

let mockHospitalId: string | null = "hosp-a";
let mockEnabledModules: string[] = ["ai_suite"];
let mockSubLoading = false;
let mockFlags: Record<string, boolean> = {};

vi.mock("@/hooks/useHospitalId", () => ({
  useHospitalId: () => ({ hospitalId: mockHospitalId }),
}));

vi.mock("@/hooks/useSubscriptionConfig", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useSubscriptionConfig")>("@/hooks/useSubscriptionConfig");
  return {
    ...actual,
    useSubscriptionConfig: () => ({ enabledModules: mockEnabledModules, isLoading: mockSubLoading }),
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockImplementation(() => Promise.resolve({ data: { ai_feature_flags: mockFlags } })),
    })),
  },
}));

import { useAIFeatureFlag, invalidateAIFlagCache } from "@/hooks/useAIFeatureFlag";
import { isModuleKeyAllowed } from "@/hooks/useSubscriptionConfig";

beforeEach(() => {
  mockHospitalId = "hosp-a";
  mockEnabledModules = ["ai_suite"];
  mockSubLoading = false;
  mockFlags = {};
  invalidateAIFlagCache();
});

describe("useAIFeatureFlag — AI Features settings screen toggles", () => {
  it("defaults to enabled (true) when the hospital has never configured the flag", async () => {
    const { result } = renderHook(() => useAIFeatureFlag("differential_dx"));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("an admin disabling the toggle (false) actually turns the feature off — the exact regression class this hook guards against", async () => {
    mockFlags = { differential_dx: false };
    const { result } = renderHook(() => useAIFeatureFlag("differential_dx"));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("two different saved flag values for the same feature key produce two different resolved states", async () => {
    mockFlags = { radiology_impression: true };
    const onHook = renderHook(() => useAIFeatureFlag("radiology_impression"));
    await waitFor(() => expect(onHook.result.current).toBe(true));

    invalidateAIFlagCache();
    mockFlags = { radiology_impression: false };
    const offHook = renderHook(() => useAIFeatureFlag("radiology_impression"));
    await waitFor(() => expect(offHook.result.current).toBe(false));
  });

  it("the platform ai_suite master is a hard floor — disabling it overrides an explicit hospital-admin true", async () => {
    mockFlags = { discharge_summary: true };
    mockEnabledModules = []; // ai_suite not in the enabled list
    const { result } = renderHook(() => useAIFeatureFlag("discharge_summary"));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("with no hospitalId, resolves to the feature default without querying (no crash)", () => {
    mockHospitalId = null;
    const { result } = renderHook(() => useAIFeatureFlag("clinical_note"));
    expect(result.current).toBe(true);
  });
});

describe("isModuleKeyAllowed — the AI Features master-floor primitive", () => {
  it("an always-enabled key is allowed regardless of the enabled-modules list", () => {
    expect(isModuleKeyAllowed("dashboard", [])).toBe(true);
  });

  it("a tracked canonical key is allowed only when present in enabledModules", () => {
    expect(isModuleKeyAllowed("ai_suite", ["ai_suite"])).toBe(true);
    expect(isModuleKeyAllowed("ai_suite", [])).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { mockUseSubscriptionConfig, mockIsModuleKeyAllowed, mockUseModuleAccess } = vi.hoisted(() => ({
  mockUseSubscriptionConfig: vi.fn(),
  mockIsModuleKeyAllowed: vi.fn(),
  mockUseModuleAccess: vi.fn(),
}));
vi.mock("@/hooks/useSubscriptionConfig", () => ({
  useSubscriptionConfig: mockUseSubscriptionConfig,
  isModuleKeyAllowed: mockIsModuleKeyAllowed,
}));
vi.mock("@/components/access/useModuleAccess", () => ({ useModuleAccess: mockUseModuleAccess }));

import { useAIFeature } from "./useAIFeature";

beforeEach(() => {
  mockUseSubscriptionConfig.mockReset();
  mockIsModuleKeyAllowed.mockReset();
  mockUseModuleAccess.mockReset();
});

describe("useAIFeature — UI visibility gate for an AI feature button", () => {
  it("is optimistically true while subscription config is still loading, to avoid a UI flash", () => {
    mockUseSubscriptionConfig.mockReturnValue({ enabledModules: [], isLoading: true });
    mockUseModuleAccess.mockReturnValue({ actionAllowed: () => false });
    const { result } = renderHook(() => useAIFeature("voice_scribe"));
    expect(result.current).toBe(true);
  });

  it("is true only when both the ai_suite master and the specific feature are allowed", () => {
    mockUseSubscriptionConfig.mockReturnValue({ enabledModules: ["ai_suite"], isLoading: false });
    mockIsModuleKeyAllowed.mockReturnValue(true);
    mockUseModuleAccess.mockReturnValue({ actionAllowed: (mod: string, key: string) => mod === "ai_suite" && key === "voice_scribe" });

    const { result } = renderHook(() => useAIFeature("voice_scribe"));
    expect(result.current).toBe(true);
  });

  it("is false when the ai_suite master is disabled, even if the feature itself would be allowed", () => {
    mockUseSubscriptionConfig.mockReturnValue({ enabledModules: [], isLoading: false });
    mockIsModuleKeyAllowed.mockReturnValue(false);
    mockUseModuleAccess.mockReturnValue({ actionAllowed: () => true });

    const { result } = renderHook(() => useAIFeature("voice_scribe"));
    expect(result.current).toBe(false);
  });

  it("is false when this specific feature is withheld, even if the master is on", () => {
    mockUseSubscriptionConfig.mockReturnValue({ enabledModules: ["ai_suite"], isLoading: false });
    mockIsModuleKeyAllowed.mockReturnValue(true);
    mockUseModuleAccess.mockReturnValue({ actionAllowed: () => false });

    const { result } = renderHook(() => useAIFeature("voice_scribe"));
    expect(result.current).toBe(false);
  });
});

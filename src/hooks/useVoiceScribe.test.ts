import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import React from "react";
import { VoiceScribeContext, useVoiceScribe } from "./useVoiceScribe";

describe("useVoiceScribe", () => {
  it("throws when used outside a VoiceScribeProvider", () => {
    const { result } = renderHook(() => {
      try {
        return useVoiceScribe();
      } catch (e) {
        return e;
      }
    });
    expect(result.current).toBeInstanceOf(Error);
    expect((result.current as Error).message).toBe("useVoiceScribe must be used inside VoiceScribeProvider");
  });

  it("returns the value supplied by a VoiceScribeContext.Provider", () => {
    const value = { isRecording: false } as any;
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(VoiceScribeContext.Provider, { value }, children);

    const { result } = renderHook(() => useVoiceScribe(), { wrapper });
    expect(result.current).toBe(value);
  });
});

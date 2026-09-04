import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePWAInstall } from "./usePWAInstall";

const originalMatchMedia = window.matchMedia;

function stubMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as any;
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe("usePWAInstall", () => {
  it("reports already installed when running in standalone display mode", () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => usePWAInstall());
    expect(result.current.isInstalled).toBe(true);
    expect(result.current.canInstall).toBe(false);
  });

  it("canInstall becomes true once beforeinstallprompt fires, in non-standalone mode", () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => usePWAInstall());
    expect(result.current.canInstall).toBe(false);

    act(() => {
      const evt = Object.assign(new Event("beforeinstallprompt"), {
        prompt: vi.fn().mockResolvedValue(undefined),
        userChoice: Promise.resolve({ outcome: "accepted" }),
      });
      window.dispatchEvent(evt);
    });

    expect(result.current.canInstall).toBe(true);
  });

  it("promptInstall() marks the app installed only when the user accepts", async () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => usePWAInstall());
    const userChoice = Promise.resolve<{ outcome: "accepted" | "dismissed" }>({ outcome: "accepted" });
    act(() => {
      const evt = Object.assign(new Event("beforeinstallprompt"), {
        prompt: vi.fn().mockResolvedValue(undefined),
        userChoice,
      });
      window.dispatchEvent(evt);
    });

    await act(async () => {
      await result.current.promptInstall();
    });

    expect(result.current.isInstalled).toBe(true);
    expect(result.current.canInstall).toBe(false);
  });

  it("promptInstall() leaves canInstall available when the user dismisses", async () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => usePWAInstall());
    act(() => {
      const evt = Object.assign(new Event("beforeinstallprompt"), {
        prompt: vi.fn().mockResolvedValue(undefined),
        userChoice: Promise.resolve({ outcome: "dismissed" }),
      });
      window.dispatchEvent(evt);
    });

    await act(async () => {
      await result.current.promptInstall();
    });

    expect(result.current.isInstalled).toBe(false);
    expect(result.current.canInstall).toBe(true);
  });

  it("promptInstall() is a no-op when there is no captured install event", async () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => usePWAInstall());
    await act(async () => {
      await expect(result.current.promptInstall()).resolves.toBeUndefined();
    });
    expect(result.current.isInstalled).toBe(false);
  });
});

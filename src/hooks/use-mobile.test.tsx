import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIsMobile } from "./use-mobile";

const originalInnerWidth = window.innerWidth;
const originalMatchMedia = window.matchMedia;

function setInnerWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
}

function stubMatchMedia() {
  const listeners: Array<() => void> = [];
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: (_event: string, cb: () => void) => listeners.push(cb),
    removeEventListener: (_event: string, cb: () => void) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
  }));
  return { fireChange: () => listeners.forEach((cb) => cb()) };
}

beforeEach(() => {
  setInnerWidth(originalInnerWidth);
});
afterEach(() => {
  window.matchMedia = originalMatchMedia;
  setInnerWidth(originalInnerWidth);
});

describe("useIsMobile — tablet-first breakpoint at 768px", () => {
  it("reports mobile when the viewport is under the breakpoint on mount", () => {
    setInnerWidth(500);
    stubMatchMedia();
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("reports not-mobile at or above the breakpoint on mount", () => {
    setInnerWidth(768);
    stubMatchMedia();
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("updates when the viewport crosses the breakpoint and the media query fires", () => {
    setInnerWidth(1024);
    const { fireChange } = stubMatchMedia();
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      setInnerWidth(400);
      fireChange();
    });
    expect(result.current).toBe(true);
  });
});

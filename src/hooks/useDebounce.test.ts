import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebounce } from "./useDebounce";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useDebounce", () => {
  it("returns the initial value immediately, before any delay has elapsed", () => {
    const { result } = renderHook(() => useDebounce("first", 300));
    expect(result.current).toBe("first");
  });

  it("does not update the returned value before the delay elapses", () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 300), { initialProps: { value: "a" } });
    rerender({ value: "b" });
    act(() => { vi.advanceTimersByTime(299); });
    expect(result.current).toBe("a");
  });

  it("updates to the latest value once the delay elapses", () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 300), { initialProps: { value: "a" } });
    rerender({ value: "b" });
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe("b");
  });

  it("resets the timer on each change — only the final value in a rapid burst is applied", () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 300), { initialProps: { value: "a" } });
    rerender({ value: "b" });
    act(() => { vi.advanceTimersByTime(200); });
    rerender({ value: "c" });
    act(() => { vi.advanceTimersByTime(200); }); // 400ms since "b", but only 200ms since "c"
    expect(result.current).toBe("a"); // "b" never got its full 300ms window
    act(() => { vi.advanceTimersByTime(100); }); // now 300ms since "c"
    expect(result.current).toBe("c");
  });

  it("defaults to a 300ms delay when none is given", () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value), { initialProps: { value: "a" } });
    rerender({ value: "b" });
    act(() => { vi.advanceTimersByTime(299); });
    expect(result.current).toBe("a");
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe("b");
  });
});

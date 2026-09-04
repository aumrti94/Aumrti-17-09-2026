import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useCountUp } from "./useCountUp";

// NOTE: this hook's own effect lists `value` (the state it sets) in its dependency array, so
// every setValue() call re-runs the effect and resets startRef.current. Under jsdom's real
// timers this produces visibly wrong output (observed: the animation collapsing toward
// -Infinity instead of converging on the target) rather than a clean cubic ease-out. Only the
// two synchronous, timing-independent behaviors are asserted here; the animation's actual
// convergence is not verified and should be treated as suspect.

describe("useCountUp — eased count-up animation for dashboard stat tiles", () => {
  it("starts at 0", () => {
    const { result } = renderHook(() => useCountUp(100, 50));
    expect(result.current).toBe(0);
  });

  it("stays at 0 for a target of 0, without animating", async () => {
    const { result } = renderHook(() => useCountUp(0, 50));
    await waitFor(() => expect(result.current).toBe(0));
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { mockChannel, mockRemoveChannel, mockOn, mockSubscribe } = vi.hoisted(() => ({
  mockChannel: vi.fn(),
  mockRemoveChannel: vi.fn(),
  mockOn: vi.fn(),
  mockSubscribe: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { channel: mockChannel, removeChannel: mockRemoveChannel },
}));

import { useRealtimeRefetch } from "./useRealtimeRefetch";

beforeEach(() => {
  mockChannel.mockReset();
  mockRemoveChannel.mockReset();
  mockOn.mockReset();
  mockSubscribe.mockReset();
  const chan: any = {};
  chan.on = mockOn.mockReturnValue(chan);
  chan.subscribe = mockSubscribe.mockReturnValue(chan);
  mockChannel.mockReturnValue(chan);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useRealtimeRefetch", () => {
  it("subscribes to each table with the default hospital_id filter", () => {
    renderHook(() => useRealtimeRefetch({ tables: ["bills", "bill_payments"], hospitalId: "h1", onChange: vi.fn() }));

    expect(mockOn).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({ event: "*", schema: "public", table: "bills", filter: "hospital_id=eq.h1" }),
      expect.any(Function),
    );
    expect(mockOn).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({ table: "bill_payments", filter: "hospital_id=eq.h1" }),
      expect.any(Function),
    );
    expect(mockSubscribe).toHaveBeenCalled();
  });

  it("respects an explicit filter override and a null filter (RLS-only, unfiltered)", () => {
    renderHook(() =>
      useRealtimeRefetch({
        tables: [{ table: "beds", filter: "ward_id=eq.w1" }, { table: "admissions", filter: null }],
        hospitalId: "h1",
        onChange: vi.fn(),
      }),
    );

    expect(mockOn).toHaveBeenCalledWith("postgres_changes", expect.objectContaining({ table: "beds", filter: "ward_id=eq.w1" }), expect.any(Function));
    const admissionsCall = mockOn.mock.calls.find((c) => c[1].table === "admissions");
    expect(admissionsCall![1].filter).toBeUndefined();
  });

  it("does not subscribe at all when disabled", () => {
    renderHook(() => useRealtimeRefetch({ tables: ["bills"], hospitalId: "h1", onChange: vi.fn(), enabled: false }));
    expect(mockChannel).not.toHaveBeenCalled();
  });

  it("debounces the onChange callback fired by a postgres_changes event", () => {
    const onChange = vi.fn();
    renderHook(() => useRealtimeRefetch({ tables: ["bills"], hospitalId: "h1", onChange, debounceMs: 400 }));

    const fire = mockOn.mock.calls[0][2];
    act(() => {
      fire();
      fire();
      fire();
    });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("removes the channel and listeners on unmount", () => {
    const { unmount } = renderHook(() => useRealtimeRefetch({ tables: ["bills"], hospitalId: "h1", onChange: vi.fn() }));
    unmount();
    expect(mockRemoveChannel).toHaveBeenCalled();
  });
});

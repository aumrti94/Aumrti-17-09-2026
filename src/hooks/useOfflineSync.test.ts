import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));

import { OfflineSyncContext, useOfflineSync, useOfflineWrite } from "./useOfflineSync";

beforeEach(() => {
  mockFrom.mockReset();
});

describe("useOfflineSync", () => {
  it("returns the safe online-by-default context outside a Provider", () => {
    const { result } = renderHook(() => useOfflineSync());
    expect(result.current.isOnline).toBe(true);
    expect(result.current.pendingCount).toBe(0);
    expect(result.current.syncing).toBe(false);
  });
});

describe("useOfflineWrite", () => {
  function providerWith(value: Partial<React.ComponentProps<typeof OfflineSyncContext.Provider>["value"]>) {
    const full = {
      isOnline: true,
      pendingCount: 0,
      syncing: false,
      lastSyncedAt: null,
      enqueueOperation: vi.fn().mockResolvedValue("op1"),
      triggerSync: vi.fn().mockResolvedValue(undefined),
      ...value,
    };
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(OfflineSyncContext.Provider, { value: full }, children);
  }

  it("writes an insert directly to supabase when online", async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert: insertSpy });
    const enqueueOperation = vi.fn();
    const wrapper = providerWith({ isOnline: true, enqueueOperation });

    const { result } = renderHook(() => useOfflineWrite(), { wrapper });
    await act(async () => {
      await result.current.write({ table: "nursing_vitals", operation: "insert", data: { hr: 80 } });
    });

    expect(insertSpy).toHaveBeenCalledWith({ hr: 80 });
    expect(enqueueOperation).not.toHaveBeenCalled();
  });

  it("writes an update directly, scoped by matchField/matchValue, when online", async () => {
    const eqSpy = vi.fn().mockResolvedValue({ error: null });
    const updateSpy = vi.fn().mockReturnValue({ eq: eqSpy });
    mockFrom.mockReturnValue({ update: updateSpy });
    const wrapper = providerWith({ isOnline: true });

    const { result } = renderHook(() => useOfflineWrite(), { wrapper });
    await act(async () => {
      await result.current.write({ table: "beds", operation: "update", data: { status: "occupied" }, matchField: "id", matchValue: "bed1" });
    });

    expect(updateSpy).toHaveBeenCalledWith({ status: "occupied" });
    expect(eqSpy).toHaveBeenCalledWith("id", "bed1");
  });

  it("throws when the direct online insert fails, instead of silently dropping the write", async () => {
    mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: { message: "constraint violation" } }) });
    const wrapper = providerWith({ isOnline: true });

    const { result } = renderHook(() => useOfflineWrite(), { wrapper });
    await expect(
      result.current.write({ table: "nursing_vitals", operation: "insert", data: {} }),
    ).rejects.toThrow("constraint violation");
  });

  it("queues the operation instead of hitting the network when offline", async () => {
    const enqueueOperation = vi.fn().mockResolvedValue("queued-1");
    const wrapper = providerWith({ isOnline: false, enqueueOperation });

    const { result } = renderHook(() => useOfflineWrite(), { wrapper });
    await act(async () => {
      await result.current.write({ table: "nursing_vitals", operation: "insert", data: { hr: 80 } });
    });

    expect(enqueueOperation).toHaveBeenCalledWith({ table: "nursing_vitals", operation: "insert", data: { hr: 80 } });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

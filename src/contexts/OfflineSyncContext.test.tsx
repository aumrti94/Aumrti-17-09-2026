import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import React from "react";

const { mockToast, mockCount, mockEnqueue, mockSyncOfflineQueue } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockCount: vi.fn(),
  mockEnqueue: vi.fn(),
  mockSyncOfflineQueue: vi.fn(),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/offlineQueue", () => ({
  offlineQueue: { count: mockCount, enqueue: mockEnqueue },
  syncOfflineQueue: mockSyncOfflineQueue,
}));

import { OfflineSyncProvider } from "./OfflineSyncContext";
import { useOfflineSync } from "@/hooks/useOfflineSync";

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(OfflineSyncProvider, null, children);

const originalOnLine = Object.getOwnPropertyDescriptor(window.Navigator.prototype, "onLine");

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value });
}

beforeEach(() => {
  mockToast.mockReset();
  mockCount.mockReset();
  mockEnqueue.mockReset();
  mockSyncOfflineQueue.mockReset();
  mockCount.mockResolvedValue(0);
  setOnline(true);
});

afterEach(() => {
  if (originalOnLine) Object.defineProperty(window.Navigator.prototype, "onLine", originalOnLine);
});

describe("OfflineSyncProvider", () => {
  it("reflects navigator.onLine and reports the initial pending queue count", async () => {
    mockCount.mockResolvedValue(3);
    const { result } = renderHook(() => useOfflineSync(), { wrapper });
    await waitFor(() => expect(result.current.pendingCount).toBe(3));
    expect(result.current.isOnline).toBe(true);
  });

  it("enqueueOperation queues the op and refreshes the pending count", async () => {
    mockEnqueue.mockResolvedValue("op-1");
    mockCount.mockResolvedValueOnce(0).mockResolvedValue(1);
    const { result } = renderHook(() => useOfflineSync(), { wrapper });
    await waitFor(() => expect(result.current.pendingCount).toBe(0));

    let id: string;
    await act(async () => {
      id = await result.current.enqueueOperation({ table: "nursing_vitals", operation: "insert", data: { hr: 80 } });
    });

    expect(id!).toBe("op-1");
    expect(mockEnqueue).toHaveBeenCalledWith({ table: "nursing_vitals", operation: "insert", data: { hr: 80 } });
    await waitFor(() => expect(result.current.pendingCount).toBe(1));
  });

  it("triggerSync does nothing while offline", async () => {
    setOnline(false);
    const { result } = renderHook(() => useOfflineSync(), { wrapper });
    await act(async () => {
      await result.current.triggerSync();
    });
    expect(mockSyncOfflineQueue).not.toHaveBeenCalled();
  });

  it("triggerSync does nothing when the queue is empty", async () => {
    mockCount.mockResolvedValue(0);
    const { result } = renderHook(() => useOfflineSync(), { wrapper });
    await act(async () => {
      await result.current.triggerSync();
    });
    expect(mockSyncOfflineQueue).not.toHaveBeenCalled();
  });

  it("triggerSync syncs a non-empty queue, toasts on success, and updates lastSyncedAt", async () => {
    mockCount.mockResolvedValue(2);
    mockSyncOfflineQueue.mockResolvedValue({ synced: 2, failed: 0, errors: [] });
    const { result } = renderHook(() => useOfflineSync(), { wrapper });
    await waitFor(() => expect(result.current.pendingCount).toBe(2));

    await act(async () => {
      await result.current.triggerSync();
    });

    expect(mockSyncOfflineQueue).toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Offline queue synced ✓" }));
    expect(result.current.lastSyncedAt).toBeInstanceOf(Date);
    expect(result.current.syncing).toBe(false);
  });

  it("does not toast when nothing actually synced", async () => {
    mockCount.mockResolvedValue(1);
    mockSyncOfflineQueue.mockResolvedValue({ synced: 0, failed: 0, errors: [] });
    const { result } = renderHook(() => useOfflineSync(), { wrapper });
    await waitFor(() => expect(result.current.pendingCount).toBe(1));

    await act(async () => {
      await result.current.triggerSync();
    });

    expect(mockToast).not.toHaveBeenCalled();
  });
});

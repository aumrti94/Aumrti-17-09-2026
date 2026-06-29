/**
 * OfflineSyncContext
 *
 * Provides:
 *  - isOnline: boolean
 *  - pendingCount: number (items in offline queue)
 *  - syncing: boolean
 *  - lastSyncedAt: Date | null
 *  - enqueueOperation: (op) => Promise<string>  — use anywhere instead of direct supabase calls
 *  - triggerSync: () => Promise<void>
 *
 * Wire this at the app root (inside AppShell or App.tsx).
 * The OfflineBanner component reads isOnline from window events (existing).
 * This provider adds queue management and auto-sync.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { offlineQueue, syncOfflineQueue, type QueuedOperation } from "@/lib/offlineQueue";
import { useToast } from "@/hooks/use-toast";

interface OfflineSyncState {
  isOnline:        boolean;
  pendingCount:    number;
  syncing:         boolean;
  lastSyncedAt:    Date | null;
  enqueueOperation: (op: Omit<QueuedOperation, "id" | "createdAt" | "retries">) => Promise<string>;
  triggerSync:     () => Promise<void>;
}

const OfflineSyncContext = createContext<OfflineSyncState>({
  isOnline:         true,
  pendingCount:     0,
  syncing:          false,
  lastSyncedAt:     null,
  enqueueOperation: async () => "",
  triggerSync:      async () => {},
});

export const useOfflineSync = () => useContext(OfflineSyncContext);

export const OfflineSyncProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOnline,     setIsOnline]     = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing,      setSyncing]      = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const syncingRef                      = useRef(false);
  const { toast }                       = useToast();

  // ── Update pending count ──────────────────────────────────────────────────
  const refreshCount = useCallback(async () => {
    const n = await offlineQueue.count();
    setPendingCount(n);
  }, []);

  // ── Sync on reconnect or manual trigger ──────────────────────────────────
  const triggerSync = useCallback(async () => {
    if (syncingRef.current || !navigator.onLine) return;
    const count = await offlineQueue.count();
    if (count === 0) return;

    syncingRef.current = true;
    setSyncing(true);

    const result = await syncOfflineQueue(supabase);

    setSyncing(false);
    syncingRef.current = false;
    setLastSyncedAt(new Date());
    await refreshCount();

    if (result.synced > 0) {
      toast({
        title: `Offline queue synced ✓`,
        description: `${result.synced} operation${result.synced > 1 ? "s" : ""} posted to server.`,
      });
    }
    if (result.failed > 0) {
      console.warn("Sync failures:", result.errors);
    }
  }, [refreshCount, toast]);

  // ── Online / offline listeners ────────────────────────────────────────────
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Delay slightly so the connection is stable
      setTimeout(() => triggerSync(), 2000);
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);
    refreshCount();

    return () => {
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [triggerSync, refreshCount]);

  // ── Periodic sync attempt every 60s (catches missed online events) ────────
  useEffect(() => {
    const interval = setInterval(() => {
      if (navigator.onLine) triggerSync();
    }, 60_000);
    return () => clearInterval(interval);
  }, [triggerSync]);

  // ── enqueueOperation ─────────────────────────────────────────────────────
  const enqueueOperation = useCallback(
    async (op: Omit<QueuedOperation, "id" | "createdAt" | "retries">) => {
      const id = await offlineQueue.enqueue(op);
      await refreshCount();
      return id;
    },
    [refreshCount]
  );

  return (
    <OfflineSyncContext.Provider
      value={{ isOnline, pendingCount, syncing, lastSyncedAt, enqueueOperation, triggerSync }}
    >
      {children}
      {/* Persistent sync status indicator — only visible when offline or syncing */}
      {(!isOnline || syncing || pendingCount > 0) && (
        <OfflineSyncBar
          isOnline={isOnline}
          syncing={syncing}
          pendingCount={pendingCount}
          onSync={triggerSync}
        />
      )}
    </OfflineSyncContext.Provider>
  );
};

// ── Sync status bar ───────────────────────────────────────────────────────────
const OfflineSyncBar: React.FC<{
  isOnline:    boolean;
  syncing:     boolean;
  pendingCount: number;
  onSync:      () => void;
}> = ({ isOnline, syncing, pendingCount, onSync }) => (
  <div
    className={`fixed bottom-0 left-0 right-0 z-50 px-4 py-2 flex items-center gap-3 text-[12px] font-medium transition-colors ${
      !isOnline
        ? "bg-red-600 text-white"
        : syncing
        ? "bg-blue-600 text-white"
        : pendingCount > 0
        ? "bg-amber-500 text-white"
        : "bg-emerald-600 text-white"
    }`}
  >
    <span className={`w-2 h-2 rounded-full ${!isOnline ? "bg-white animate-pulse" : "bg-white/70"}`} />

    {!isOnline ? (
      <span>
        Offline — {pendingCount > 0 ? `${pendingCount} operation${pendingCount > 1 ? "s" : ""} queued` : "changes will sync on reconnect"}
      </span>
    ) : syncing ? (
      <span>Syncing {pendingCount} offline operation{pendingCount > 1 ? "s" : ""}...</span>
    ) : pendingCount > 0 ? (
      <>
        <span>{pendingCount} unsynced operation{pendingCount > 1 ? "s" : ""}</span>
        <button
          onClick={onSync}
          className="ml-2 underline text-white/90 hover:text-white"
        >
          Sync now
        </button>
      </>
    ) : null}

    <span className="ml-auto text-[10px] opacity-70">Aumrti HMS Offline Mode</span>
  </div>
);

/**
 * useOfflineWrite — hook that transparently writes to Supabase when online
 * or queues the operation when offline.
 *
 * Example:
 *   const { write } = useOfflineWrite();
 *   await write({ table: "nursing_vitals", operation: "insert", data: { ... } });
 */
export function useOfflineWrite() {
  const { isOnline, enqueueOperation } = useOfflineSync();

  const write = useCallback(
    async (op: Omit<QueuedOperation, "id" | "createdAt" | "retries">) => {
      if (isOnline) {
        // Direct write — fast path
        if (op.operation === "insert") {
          const { error } = await supabase.from(op.table as any).insert(op.data as any);
          if (error) throw new Error(error.message);
        } else if (op.operation === "update" && op.matchField && op.matchValue !== undefined) {
          const { error } = await (supabase as any)
            .from(op.table)
            .update(op.data)
            .eq(op.matchField, op.matchValue);
          if (error) throw new Error(error.message);
        }
      } else {
        // Offline — queue it
        await enqueueOperation(op);
      }
    },
    [isOnline, enqueueOperation]
  );

  return { write, isOnline };
}

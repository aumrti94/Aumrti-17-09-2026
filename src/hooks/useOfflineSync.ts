import { createContext, useContext, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { QueuedOperation } from "@/lib/offlineQueue";

/**
 * Split out of OfflineSyncContext.tsx so that file exports only the Provider
 * component — a file mixing component and non-component exports silently
 * disables Fast Refresh for it.
 */
export interface OfflineSyncState {
  isOnline:        boolean;
  pendingCount:    number;
  syncing:         boolean;
  lastSyncedAt:    Date | null;
  enqueueOperation: (op: Omit<QueuedOperation, "id" | "createdAt" | "retries">) => Promise<string>;
  triggerSync:     () => Promise<void>;
}

export const OfflineSyncContext = createContext<OfflineSyncState>({
  isOnline:         true,
  pendingCount:     0,
  syncing:          false,
  lastSyncedAt:     null,
  enqueueOperation: async () => "",
  triggerSync:      async () => {},
});

export const useOfflineSync = () => useContext(OfflineSyncContext);

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

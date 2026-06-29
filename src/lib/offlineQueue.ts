/**
 * Offline Write Queue — IndexedDB backed
 *
 * Clinical staff on ward tablets can enter vitals and medication
 * administration records even when offline. Operations are queued in
 * IndexedDB and replayed against Supabase when connectivity returns.
 *
 * Usage:
 *   import { offlineQueue } from "@/lib/offlineQueue";
 *   await offlineQueue.enqueue({ table: "nursing_vitals", data: {...}, operation: "insert" });
 *   // When online: offlineQueue.sync() is called automatically via OfflineSyncProvider
 */

export type QueuedOperation = {
  id: string;           // uuid v4 — client-generated
  table: string;        // supabase table name
  operation: "insert" | "update";
  data: Record<string, unknown>;
  matchField?: string;  // for "update": field to match on (e.g. "id")
  matchValue?: unknown; // value to match
  createdAt: number;    // epoch ms
  retries: number;
  lastError?: string;
};

const DB_NAME    = "aumrti_offline";
const DB_VERSION = 1;
const STORE_NAME = "operation_queue";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("by_createdAt", "createdAt");
        store.createIndex("by_table", "table");
      }
    };
    req.onsuccess  = () => resolve(req.result);
    req.onerror    = () => reject(req.error);
  });
}

function tx(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  cb: (store: IDBObjectStore) => IDBRequest
): Promise<any> {
  return new Promise((resolve, reject) => {
    const t     = db.transaction(STORE_NAME, mode);
    const store = t.objectStore(STORE_NAME);
    const req   = cb(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

class OfflineQueue {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    this.db = await openDB();
  }

  async enqueue(op: Omit<QueuedOperation, "id" | "createdAt" | "retries">): Promise<string> {
    await this.init();
    const item: QueuedOperation = {
      ...op,
      id:        crypto.randomUUID(),
      createdAt: Date.now(),
      retries:   0,
    };
    await tx(this.db!, "readwrite", store => store.put(item));
    return item.id;
  }

  async getAll(): Promise<QueuedOperation[]> {
    await this.init();
    return new Promise((resolve, reject) => {
      const t     = this.db!.transaction(STORE_NAME, "readonly");
      const store = t.objectStore(STORE_NAME);
      const idx   = store.index("by_createdAt");
      const req   = idx.getAll();
      req.onsuccess = () => resolve(req.result as QueuedOperation[]);
      req.onerror   = () => reject(req.error);
    });
  }

  async remove(id: string): Promise<void> {
    await this.init();
    await tx(this.db!, "readwrite", store => store.delete(id));
  }

  async updateRetry(id: string, error: string): Promise<void> {
    await this.init();
    const item = await tx(this.db!, "readonly", store => store.get(id));
    if (!item) return;
    await tx(this.db!, "readwrite", store => store.put({
      ...item,
      retries:   item.retries + 1,
      lastError: error,
    }));
  }

  async count(): Promise<number> {
    await this.init();
    return tx(this.db!, "readonly", store => store.count());
  }

  async clear(): Promise<void> {
    await this.init();
    await tx(this.db!, "readwrite", store => store.clear());
  }
}

export const offlineQueue = new OfflineQueue();

// ── Sync engine — called when online status recovers ──────────────────────
export type SyncResult = {
  synced:  number;
  failed:  number;
  errors:  string[];
};

export async function syncOfflineQueue(
  supabaseClient: any
): Promise<SyncResult> {
  const pending = await offlineQueue.getAll();
  const result: SyncResult = { synced: 0, failed: 0, errors: [] };

  for (const op of pending) {
    // Skip items that have failed too many times (dead letter)
    if (op.retries >= 5) {
      result.failed++;
      result.errors.push(`[DEAD] ${op.table}/${op.id}: ${op.lastError}`);
      continue;
    }

    try {
      if (op.operation === "insert") {
        const { error } = await supabaseClient.from(op.table).insert(op.data);
        if (error) throw new Error(error.message);
      } else if (op.operation === "update" && op.matchField && op.matchValue !== undefined) {
        const { error } = await supabaseClient
          .from(op.table)
          .update(op.data)
          .eq(op.matchField, op.matchValue);
        if (error) throw new Error(error.message);
      }

      await offlineQueue.remove(op.id);
      result.synced++;
    } catch (err: any) {
      await offlineQueue.updateRetry(op.id, err.message || "Unknown error");
      result.failed++;
      result.errors.push(`${op.table}/${op.id}: ${err.message}`);
    }
  }

  return result;
}

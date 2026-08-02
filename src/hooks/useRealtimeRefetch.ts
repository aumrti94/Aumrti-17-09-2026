import { useEffect, useId, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * useRealtimeRefetch — one hook that keeps a screen's data live without a hard refresh.
 *
 * It combines the two mechanisms the app was previously hand-rolling per file:
 *
 *   1. Supabase Realtime — subscribes to `postgres_changes` on the given tables and
 *      calls `onChange` (a debounced full refetch) whenever a row changes. This is the
 *      instant, multi-user path (another user creates a bill → your list updates in ~1s).
 *
 *   2. Focus / reconnect fallback — also refetches when the tab regains visibility,
 *      the window regains focus, or the network reconnects. This covers the cases
 *      realtime can miss (filtered DELETEs without REPLICA IDENTITY FULL, a table not
 *      yet in the `supabase_realtime` publication, a dropped socket) so a screen is
 *      never stuck stale-until-hard-refresh.
 *
 * Reference implementations this generalises: `useDashboardData.ts` (debounced channel
 * refetch) and `useSubscriptionConfig.ts` (multi-table single channel).
 *
 * Usage:
 *   const { hospitalId } = useHospitalContext();
 *   useRealtimeRefetch({ tables: ["bills", "bill_payments"], hospitalId, onChange: fetchBills });
 *
 * For React-Query screens, pass an invalidator as onChange:
 *   onChange: () => queryClient.invalidateQueries({ queryKey: ["bills", hospitalId] })
 */

/** A table subscription. `filter: null` opts out of the default hospital_id filter (relies on RLS). */
export interface RealtimeTableSpec {
  table: string;
  /** postgres_changes event; defaults to "*" (INSERT + UPDATE + DELETE). */
  event?: "*" | "INSERT" | "UPDATE" | "DELETE";
  /**
   * Explicit realtime filter, e.g. `admission_id=eq.${id}`. When omitted, defaults to
   * `hospital_id=eq.${hospitalId}` if a hospitalId is provided. Pass `null` to subscribe
   * unfiltered (RLS still scopes which rows you receive).
   */
  filter?: string | null;
}

export interface UseRealtimeRefetchOptions {
  /** Tables to watch. Plain strings get the default hospital_id filter. */
  tables: Array<string | RealtimeTableSpec>;
  /** Current hospital id; used for the default per-table filter and to gate the subscription. */
  hospitalId: string | null | undefined;
  /** Called (debounced) on any change, on tab focus, and on reconnect. Usually your fetchX. */
  onChange: () => void;
  /** Skip subscribing while false (e.g. a modal that isn't open). Defaults to true. */
  enabled?: boolean;
  /** Debounce window in ms to batch bursts of events into one refetch. Defaults to 400. */
  debounceMs?: number;
  /**
   * Optional stable channel name. A unique suffix is always appended so two mounts of the
   * same screen never clobber each other's subscription.
   */
  channelName?: string;
}

function normalise(
  tables: Array<string | RealtimeTableSpec>,
  hospitalId: string | null | undefined,
): Required<RealtimeTableSpec>[] {
  return tables.map((t) => {
    const spec: RealtimeTableSpec = typeof t === "string" ? { table: t } : t;
    const filter =
      spec.filter === undefined
        ? hospitalId
          ? `hospital_id=eq.${hospitalId}`
          : undefined
        : spec.filter ?? undefined;
    return { table: spec.table, event: spec.event ?? "*", filter: filter as string };
  });
}

export function useRealtimeRefetch({
  tables,
  hospitalId,
  onChange,
  enabled = true,
  debounceMs = 400,
  channelName,
}: UseRealtimeRefetchOptions): void {
  const instanceId = useId();

  // Keep the latest onChange without re-subscribing on every render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable identity for the table set so the effect only re-runs when it truly changes.
  const specs = normalise(tables, hospitalId);
  const specKey = specs
    .map((s) => `${s.table}|${s.event}|${s.filter ?? ""}`)
    .sort()
    .join(";");

  useEffect(() => {
    if (!enabled || specs.length === 0) return;

    const fire = () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => onChangeRef.current(), debounceMs);
    };

    // --- Realtime channel (one per hook instance; unique name avoids collisions) ---
    const name = `${channelName ?? "rt"}:${instanceId}`;
    let channel = supabase.channel(name);
    // All `.on(...)` handlers MUST be registered before `.subscribe()` — supabase-js
    // silently ignores listeners added after subscribe.
    for (const s of specs) {
      const opts: Record<string, unknown> = { event: s.event, schema: "public", table: s.table };
      if (s.filter) opts.filter = s.filter;
      channel = channel.on("postgres_changes" as never, opts as never, fire as never);
    }
    channel.subscribe();

    // --- Focus / reconnect fallback ---
    const onVisible = () => {
      if (document.visibilityState === "visible") fire();
    };
    window.addEventListener("focus", fire);
    window.addEventListener("online", fire);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      window.removeEventListener("focus", fire);
      window.removeEventListener("online", fire);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
    // specKey captures the table/event/filter set; instanceId is stable per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey, enabled, debounceMs, channelName, instanceId]);
}

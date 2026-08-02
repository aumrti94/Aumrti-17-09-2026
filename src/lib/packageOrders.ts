/**
 * packageOrders — staging and releasing the lab / radiology orders a health package produces.
 *
 * THE RULE. A package's orders are created when it is BOOKED but must not reach the lab bench
 * or the radiographer until the package is PAID. Both worklists already filter
 * `.neq("billing_status", "unbilled")` (LabPage / RadiologyPage), and both sync helpers create
 * orders as "unbilled" — so staging needs no new column and no worklist change. Payment simply
 * flips those specific orders to "billed" and they appear.
 *
 * WHY THE IDS ARE STORED. Matching "which orders belong to this package" by patient + date +
 * clinical note is guesswork that breaks the moment a patient has two packages or an unrelated
 * order the same day. The booking records exactly which order ids it created.
 */

import { supabase } from "@/integrations/supabase/client";
import type { PackageComponent } from "@/lib/packageComponents";

/**
 * Reserved key inside `package_bookings.components_done`.
 *
 * That column doubles as the station-progress map (see TodaysCheckupsTab.advanceStation, which
 * spreads it and adds one key per completed station). The leading underscores keep this entry
 * out of the station count — readers filter keys starting with "__".
 */
export const STAGED_ORDERS_KEY = "__staged_orders";

export interface StagedOrders {
  lab: string[];
  radiology: string[];
}

/** PURE. Pull the staged order ids out of a booking's components_done blob. Never throws. */
export function readStagedOrders(componentsDone: unknown): StagedOrders {
  const empty: StagedOrders = { lab: [], radiology: [] };
  if (!componentsDone || typeof componentsDone !== "object") return empty;
  const blob = (componentsDone as Record<string, unknown>)[STAGED_ORDERS_KEY];
  if (!blob || typeof blob !== "object") return empty;
  const b = blob as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return { lab: arr(b.lab), radiology: arr(b.radiology) };
}

/** PURE. Station-progress keys only — excludes the reserved staging entry. */
export function stationKeys(componentsDone: unknown): string[] {
  if (!componentsDone || typeof componentsDone !== "object") return [];
  return Object.keys(componentsDone as Record<string, unknown>).filter((k) => !k.startsWith("__"));
}

/**
 * Resolve components to the master's CURRENT name.
 *
 * Components carry the name captured when the package was built. If a test is later renamed in
 * the master, that stale name no longer matches and the order is silently skipped. Where a
 * component carries `source_id` we re-read the live name; legacy components without one fall
 * back to their stored name.
 */
export async function resolveComponentNames(
  hospitalId: string,
  components: PackageComponent[],
  table: "lab_test_master" | "radiology_study_master",
  nameColumn: "test_name" | "study_name"
): Promise<string[]> {
  if (components.length === 0) return [];
  const ids = components.map((c) => c.source_id).filter((id): id is string => !!id);

  const live = new Map<string, string>();
  if (ids.length > 0) {
    const { data } = await (supabase as any)
      .from(table)
      .select(`id, ${nameColumn}`)
      .eq("hospital_id", hospitalId)
      .in("id", ids);
    for (const row of (data as any[]) || []) live.set(row.id, row[nameColumn]);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of components) {
    const name = (c.source_id && live.get(c.source_id)) || c.name;
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

export interface ReleaseResult {
  lab: number;
  radiology: number;
}

/**
 * Release a paid package's staged orders into the Lab and Radiology worklists.
 *
 * Called after a payment settles a bill. Safe to call more than once: the update is filtered on
 * `billing_status = "unbilled"`, so an already-released order is not touched again.
 *
 * Never throws — a failure here must not roll back a payment that has been physically taken.
 * It returns zero counts and logs, and the orders can be released by a later payment or by
 * hand.
 */
export async function releasePackageOrders(billId: string): Promise<ReleaseResult> {
  const none: ReleaseResult = { lab: 0, radiology: 0 };
  if (!billId) return none;
  try {
    const { data: bookings } = await (supabase as any)
      .from("package_bookings")
      .select("id, components_done")
      .eq("bill_id", billId);

    if (!bookings?.length) return none;

    const labIds: string[] = [];
    const radIds: string[] = [];
    for (const b of bookings as any[]) {
      const staged = readStagedOrders(b.components_done);
      labIds.push(...staged.lab);
      radIds.push(...staged.radiology);
    }

    let lab = 0;
    let radiology = 0;

    if (labIds.length > 0) {
      const { data } = await (supabase as any)
        .from("lab_orders")
        .update({ billing_status: "billed", billed: true } as never)
        .in("id", labIds)
        .eq("billing_status", "unbilled")
        .select("id");
      lab = ((data as any[]) || []).length;
    }

    if (radIds.length > 0) {
      const { data } = await (supabase as any)
        .from("radiology_orders")
        .update({ billing_status: "billed", billed: true } as never)
        .in("id", radIds)
        .eq("billing_status", "unbilled")
        .select("id");
      radiology = ((data as any[]) || []).length;
    }

    return { lab, radiology };
  } catch (err) {
    console.error("releasePackageOrders failed:", err);
    return none;
  }
}

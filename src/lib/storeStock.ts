import { supabase } from "@/integrations/supabase/client";

// Ward Store Realization — Phase 3/4 helper.
// Moves real stock for ward/sub-store indent ISSUES and RETURNS:
//  - issue:  deduct FEFO from the supplying store (central -> inventory_stock,
//            sub-store -> store_stock) and increment the requesting store's store_stock.
//  - return: deduct FEFO from the returning store's store_stock and add back to the
//            supplying store (central -> inventory_stock, sub-store -> store_stock).
// Only items linked to the inventory master (item_id) move real stock; unlinked legacy
// free-text lines are skipped here (their audit movement is still logged by the caller).

interface Batch {
  id: string;
  batch_number: string | null;
  expiry_date: string | null;
  quantity_available: number;
  cost_price: number | null;
  is_consignment?: boolean | null;
  consignment_vendor_id?: string | null;
}

const BATCH_COLS = "id, batch_number, expiry_date, quantity_available, cost_price, is_consignment, consignment_vendor_id";

export interface StoreMoveItem {
  item_id: string | null;
  item_name: string;
  quantity: number;
}

export interface StoreMoveResult {
  ok: boolean;
  shortages: { item_name: string; requested: number; available: number }[];
}

export interface StoreIssueContext {
  hospitalId: string;
  supplierStoreId: string;     // to_store_id (the store that issues stock)
  supplierIsCentral: boolean;  // supplier store type === 'central'
  requesterStoreId: string;    // from_store_id (the store receiving stock)
  movedById: string | null;    // public.users.id of the actor
  indentId: string;
  indentNumber?: string | null;
}

export interface StoreReturnContext {
  hospitalId: string;
  returningStoreId: string;    // from_store_id (ward returning stock)
  supplierStoreId: string;     // to_store_id (destination the stock goes back to)
  supplierIsCentral: boolean;
  movedById: string | null;
  indentId: string;
  indentNumber?: string | null;
}

// ---- FEFO-ordered reads -------------------------------------------------------

async function centralBatches(hospitalId: string, itemId: string): Promise<Batch[]> {
  const { data } = await (supabase as any)
    .from("inventory_stock")
    .select(BATCH_COLS)
    .eq("hospital_id", hospitalId)
    .eq("item_id", itemId)
    .gt("quantity_available", 0)
    .order("expiry_date", { ascending: true });
  return data || [];
}

async function subStoreBatches(hospitalId: string, storeId: string, itemId: string): Promise<Batch[]> {
  const { data } = await (supabase as any)
    .from("store_stock")
    .select(BATCH_COLS)
    .eq("hospital_id", hospitalId)
    .eq("store_id", storeId)
    .eq("item_id", itemId)
    .gt("quantity_available", 0)
    .order("expiry_date", { ascending: true });
  return data || [];
}

// ---- Increment a destination, matching the exact batch (or null-batch) ---------

async function addToStoreStock(hospitalId: string, storeId: string, itemId: string, batch: Batch, qty: number) {
  let q = (supabase as any)
    .from("store_stock")
    .select("id, quantity_available")
    .eq("hospital_id", hospitalId)
    .eq("store_id", storeId)
    .eq("item_id", itemId);
  q = batch.batch_number ? q.eq("batch_number", batch.batch_number) : q.is("batch_number", null);
  const { data: existing } = await q.limit(1).maybeSingle();

  if (existing) {
    await (supabase as any)
      .from("store_stock")
      .update({ quantity_available: existing.quantity_available + qty, last_movement_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await (supabase as any).from("store_stock").insert({
      hospital_id: hospitalId,
      store_id: storeId,
      item_id: itemId,
      batch_number: batch.batch_number,
      expiry_date: batch.expiry_date,
      quantity_available: qty,
      cost_price: batch.cost_price,
      is_consignment: batch.is_consignment ?? false,
      consignment_vendor_id: batch.consignment_vendor_id ?? null,
      last_movement_at: new Date().toISOString(),
    });
  }
}

async function addToCentralStock(hospitalId: string, itemId: string, batch: Batch, qty: number) {
  let q = (supabase as any)
    .from("inventory_stock")
    .select("id, quantity_available")
    .eq("hospital_id", hospitalId)
    .eq("item_id", itemId);
  q = batch.batch_number ? q.eq("batch_number", batch.batch_number) : q.is("batch_number", null);
  const { data: existing } = await q.limit(1).maybeSingle();

  if (existing) {
    await (supabase as any)
      .from("inventory_stock")
      .update({ quantity_available: existing.quantity_available + qty })
      .eq("id", existing.id);
  } else {
    await (supabase as any).from("inventory_stock").insert({
      hospital_id: hospitalId,
      item_id: itemId,
      batch_number: batch.batch_number,
      expiry_date: batch.expiry_date,
      quantity_available: qty,
      cost_price: batch.cost_price,
      is_consignment: batch.is_consignment ?? false,
      consignment_vendor_id: batch.consignment_vendor_id ?? null,
    });
  }
}

async function logCentralTxn(
  hospitalId: string, itemId: string, qty: number, unitRate: number | null,
  indentId: string, movedById: string | null, kind: "store_issue" | "store_return", indentNumber?: string | null
) {
  await (supabase as any).from("stock_transactions").insert({
    hospital_id: hospitalId,
    item_id: itemId,
    transaction_type: kind,
    quantity: qty,
    unit_rate: unitRate,
    reference_id: indentId,
    reference_type: "store_indent",
    created_by: movedById,
    notes: `Store ${kind === "store_issue" ? "issue" : "return"}${indentNumber ? ` — ${indentNumber}` : ""}`,
  });
}

// Plan FEFO takes across a source's batches; returns takes + shortage (if any).
export function planTakes(rows: Batch[], qty: number) {
  let remaining = qty;
  const takes: { batch: Batch; take: number }[] = [];
  for (const row of rows) {
    if (remaining <= 0) break;
    const take = Math.min(row.quantity_available, remaining);
    remaining -= take;
    takes.push({ batch: row, take });
  }
  const available = rows.reduce((s, r) => s + r.quantity_available, 0);
  return { takes, short: remaining > 0, available };
}

// ---- Public API ---------------------------------------------------------------

/**
 * Validate availability (all-or-nothing) then move stock for a store ISSUE.
 * Returns { ok:false, shortages } without moving anything if any linked item is short.
 */
export async function issueStoreStock(ctx: StoreIssueContext, items: StoreMoveItem[]): Promise<StoreMoveResult> {
  const linked = items.filter((i) => i.item_id && i.quantity > 0);
  if (linked.length === 0) return { ok: true, shortages: [] };

  const plans: { item: StoreMoveItem; takes: { batch: Batch; take: number }[] }[] = [];
  const shortages: StoreMoveResult["shortages"] = [];
  for (const item of linked) {
    const rows = ctx.supplierIsCentral
      ? await centralBatches(ctx.hospitalId, item.item_id as string)
      : await subStoreBatches(ctx.hospitalId, ctx.supplierStoreId, item.item_id as string);
    const { takes, short, available } = planTakes(rows, item.quantity);
    if (short) shortages.push({ item_name: item.item_name, requested: item.quantity, available });
    plans.push({ item, takes });
  }
  if (shortages.length > 0) return { ok: false, shortages };

  for (const plan of plans) {
    const itemId = plan.item.item_id as string;
    for (const { batch, take } of plan.takes) {
      // deduct supplier
      const table = ctx.supplierIsCentral ? "inventory_stock" : "store_stock";
      await (supabase as any).from(table).update({ quantity_available: batch.quantity_available - take }).eq("id", batch.id);
      // increment requester
      await addToStoreStock(ctx.hospitalId, ctx.requesterStoreId, itemId, batch, take);
      // ledger central moves
      if (ctx.supplierIsCentral) {
        await logCentralTxn(ctx.hospitalId, itemId, -take, batch.cost_price, ctx.indentId, ctx.movedById, "store_issue", ctx.indentNumber);
      }
    }
  }
  return { ok: true, shortages: [] };
}

/**
 * Validate availability then move stock for a store RETURN: deduct FEFO from the
 * returning store's store_stock and add back to the supplier. All-or-nothing.
 */
export async function returnStoreStock(ctx: StoreReturnContext, items: StoreMoveItem[]): Promise<StoreMoveResult> {
  const linked = items.filter((i) => i.item_id && i.quantity > 0);
  if (linked.length === 0) return { ok: true, shortages: [] };

  const plans: { item: StoreMoveItem; takes: { batch: Batch; take: number }[] }[] = [];
  const shortages: StoreMoveResult["shortages"] = [];
  for (const item of linked) {
    const rows = await subStoreBatches(ctx.hospitalId, ctx.returningStoreId, item.item_id as string);
    const { takes, short, available } = planTakes(rows, item.quantity);
    if (short) shortages.push({ item_name: item.item_name, requested: item.quantity, available });
    plans.push({ item, takes });
  }
  if (shortages.length > 0) return { ok: false, shortages };

  for (const plan of plans) {
    const itemId = plan.item.item_id as string;
    for (const { batch, take } of plan.takes) {
      // deduct returning ward
      await (supabase as any)
        .from("store_stock")
        .update({ quantity_available: batch.quantity_available - take, last_movement_at: new Date().toISOString() })
        .eq("id", batch.id);
      // add back to supplier
      if (ctx.supplierIsCentral) {
        await addToCentralStock(ctx.hospitalId, itemId, batch, take);
        await logCentralTxn(ctx.hospitalId, itemId, take, batch.cost_price, ctx.indentId, ctx.movedById, "store_return", ctx.indentNumber);
      } else {
        await addToStoreStock(ctx.hospitalId, ctx.supplierStoreId, itemId, batch, take);
      }
    }
  }
  return { ok: true, shortages: [] };
}

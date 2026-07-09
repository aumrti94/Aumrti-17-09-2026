import { supabase } from "@/integrations/supabase/client";

// Shared central-inventory (inventory_stock) FEFO stock movement helpers.
// Extracted from the identical loops in OT EndCaseModal and inventory IndentsPanel so
// consumption/issue flows deduct oldest-expiry batches first and log the ledger uniformly.

export interface StockLedgerMeta {
  transactionType: string;
  referenceId?: string | null;
  referenceType?: string | null;
  departmentId?: string | null;
  createdBy?: string | null;
  notes?: string | null;
  unitRate?: number | null;
}

export interface FefoResult {
  deducted: number; // qty actually removed (may be < requested if short)
  value: number;    // sum(take * cost_price)
  short: number;    // requested - deducted
}

/**
 * Deduct `qty` FEFO from central `inventory_stock` across batches (oldest expiry first),
 * then log a single `stock_transactions` row (negative quantity). Returns actual deducted
 * qty + value; never deducts more than what's on hand.
 */
export async function deductCentralFEFO(params: {
  hospitalId: string; itemId: string; qty: number; ledger: StockLedgerMeta;
}): Promise<FefoResult> {
  const { hospitalId, itemId, qty, ledger } = params;
  const { data: rows } = await (supabase as any)
    .from("inventory_stock")
    .select("id, quantity_available, cost_price")
    .eq("hospital_id", hospitalId)
    .eq("item_id", itemId)
    .gt("quantity_available", 0)
    .order("expiry_date", { ascending: true });

  let remaining = qty;
  let value = 0;
  for (const r of (rows || [])) {
    if (remaining <= 0) break;
    const take = Math.min(r.quantity_available, remaining);
    remaining -= take;
    value += take * (r.cost_price || 0);
    await (supabase as any).from("inventory_stock").update({ quantity_available: r.quantity_available - take }).eq("id", r.id);
  }
  const deducted = qty - remaining;

  await (supabase as any).from("stock_transactions").insert({
    hospital_id: hospitalId,
    item_id: itemId,
    transaction_type: ledger.transactionType,
    quantity: -deducted,
    unit_rate: ledger.unitRate ?? null,
    reference_id: ledger.referenceId ?? null,
    reference_type: ledger.referenceType ?? null,
    department_id: ledger.departmentId ?? null,
    created_by: ledger.createdBy ?? null,
    notes: ledger.notes ?? null,
  });

  return { deducted, value, short: remaining };
}

/**
 * Reverse a prior consumption: add `qty` back to the earliest-expiry batch of an item and
 * log a positive `stock_transactions` row. Used when a consumed line is removed/corrected.
 */
export async function reverseCentral(params: {
  hospitalId: string; itemId: string; qty: number; ledger: StockLedgerMeta;
}): Promise<void> {
  const { hospitalId, itemId, qty, ledger } = params;
  const { data: rows } = await (supabase as any)
    .from("inventory_stock")
    .select("id, quantity_available")
    .eq("hospital_id", hospitalId)
    .eq("item_id", itemId)
    .order("expiry_date", { ascending: true })
    .limit(1);
  if (rows?.[0]) {
    await (supabase as any).from("inventory_stock").update({ quantity_available: rows[0].quantity_available + qty }).eq("id", rows[0].id);
  }
  await (supabase as any).from("stock_transactions").insert({
    hospital_id: hospitalId,
    item_id: itemId,
    transaction_type: ledger.transactionType,
    quantity: qty,
    reference_id: ledger.referenceId ?? null,
    reference_type: ledger.referenceType ?? null,
    created_by: ledger.createdBy ?? null,
    notes: ledger.notes ?? null,
  });
}

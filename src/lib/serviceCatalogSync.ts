import { supabase } from "@/integrations/supabase/client";

/**
 * Service Catalog Sync — Phase 1 (foundation).
 *
 * Bi-directional mirror between module-owned price rows and the central
 * Service Catalog (service_master), so the Settings → Services & Fees page can
 * surface and edit them WITHOUT changing how each module enters or bills prices.
 *
 * Direction A (module → catalog): mirrorWardToCatalog() upserts a linked
 * service_master row (source_table/source_id) whenever a ward is saved.
 *
 * Direction B (catalog → module): propagateCatalogFeeToSource() writes a fee
 * edited in the catalog back to the owning module table (e.g. wards.rate_per_day),
 * keeping the module's existing billing path correct.
 *
 * All operations are additive and idempotent. wards.rate_per_day remains the
 * source of truth for IPD bed-day billing (see src/lib/ipdBilling.ts).
 */

export interface WardMirrorInput {
  id: string;
  name: string;
  rate_per_day?: number | string | null;
}

/**
 * Mirror a ward's per-day tariff into service_master (category 'bed').
 * Finds the existing mirror row by (hospital_id, source_table='wards', source_id)
 * and updates it, or inserts one. Never modifies the ward row itself.
 */
export async function mirrorWardToCatalog(
  hospitalId: string,
  ward: WardMirrorInput
): Promise<void> {
  if (!hospitalId || !ward?.id) return;
  const fee = Number(ward.rate_per_day) || 0;
  const name = `${ward.name} (per day)`;
  const client = supabase as any;

  const { data: existing } = await client
    .from("service_master")
    .select("id")
    .eq("hospital_id", hospitalId)
    .eq("source_table", "wards")
    .eq("source_id", ward.id)
    .maybeSingle();

  if (existing) {
    await client.from("service_master").update({ name, fee }).eq("id", existing.id);
  } else {
    await client.from("service_master").insert({
      hospital_id: hospitalId,
      name,
      category: "bed",
      fee,
      item_type: "bed_charge",
      source_table: "wards",
      source_id: ward.id,
      is_active: true,
    });
  }
}

/**
 * Write a fee edited on a catalog mirror row back to its owning module table.
 * Returns true if the edit was propagated to a source row.
 */
export async function propagateCatalogFeeToSource(
  row: { source_table?: string | null; source_id?: string | null } | null | undefined,
  newFee: number
): Promise<boolean> {
  if (!row?.source_table || !row?.source_id) return false;
  const client = supabase as any;
  if (row.source_table === "wards") {
    await client.from("wards").update({ rate_per_day: newFee }).eq("id", row.source_id);
    return true;
  }
  return false;
}

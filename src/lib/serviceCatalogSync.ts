import { supabase } from "@/integrations/supabase/client";

/**
 * Service Catalog Sync.
 *
 * Mirrors module-owned price rows into the central Service Catalog
 * (service_master), so Settings → Services & Fees and the Billing line-item
 * picker can surface them WITHOUT changing how each module enters or bills
 * prices.
 *
 * Direction A (module → catalog) now runs in the database: Phase 2
 * (20261008000136) put AFTER INSERT/UPDATE/DELETE triggers on every source
 * table — wards, lab_test_master, lab_test_groups, radiology_study_master,
 * health_packages and specialized service_rates. Phase 1's client-side
 * mirrorWardToCatalog() was removed with it: a client mirror only fires on the
 * two screens that remember to call it, and it wrote a ward item_type
 * ('bed_charge') that the GST engine does not model.
 *
 * Direction B (catalog → module): propagateCatalogFeeToSource() writes a fee
 * edited in the catalog back to the owning module table (e.g. wards.rate_per_day),
 * keeping the module's existing billing path correct.
 *
 * Each module table remains the source of truth for its own billing path —
 * wards.rate_per_day still drives IPD bed-day billing (see src/lib/ipdBilling.ts).
 */

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

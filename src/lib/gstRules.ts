// Indian GST rules for healthcare services per Notification 12/2017-CT(Rate) + amendments

export const GST_RATE_RULES: Record<string, number> = {
  consultation: 0,
  procedure: 0,
  surgery: 0,
  room_charge: 0,       // ≤ ₹5000/day: 0%; > ₹5000/day: 5% — checked at item level
  room_charge_luxury: 5,
  room_charge_icu: 0,   // ICU/NICU/PICU: exempt at any rate (CBIC clarification) — see getRoomChargeGSTRate
  lab: 0,
  radiology: 0,
  nursing: 0,
  blood: 0,
  oxygen: 5,            // Medical oxygen: 5%
  ambulance: 0,
  pharmacy: 12,         // Drugs: 12% default (5% on essential/scheduled formulations)
  consumable: 12,
  cosmetic: 18,
  cafeteria: 5,
  parking: 18,
  package: 0,           // Packages follow composite supply rule — 0% if health services
  service: 18,
  other: 18,
};

// Single source of truth for the pharmacy GST fallback used when a drug/batch has no
// gst_percent configured — matches drug_master.gst_percent's own column default of 12.
// Previously DispensingWorkspace.tsx had a stray `|| 5` fallback at one call site while
// every other dispensing path (IP load, retail search) fell back to 12 — the same drug
// could be billed at a different GST rate depending on which screen dispensed it.
export const DEFAULT_PHARMACY_GST_PERCENT = 12;

export function getDefaultGSTRate(itemType: string, unitRate?: number): number {
  if (itemType === "room_charge" && unitRate && unitRate > 5000) return 5;
  return GST_RATE_RULES[itemType] ?? 0;
}

/** The shape resolveServiceGstPercent needs off a service_master row. */
export interface CatalogServiceGstInput {
  item_type?: string | null;
  gst_applicable?: boolean | null;
  gst_percent?: number | string | null;
  /** NULL for hospital-authored rows; the owning table for trigger-maintained mirrors. */
  source_table?: string | null;
}

/**
 * The GST rate that actually lands on a bill line for a catalog service.
 *
 * Two populations live in service_master and they need opposite rules:
 *
 *  - Hospital-authored rows (source_table IS NULL) come from Settings › Services & Fees,
 *    where "GST applicable" is a deliberate choice the hospital made. That choice is
 *    authoritative: unchecked means 0%, full stop. Previously the toggle was ignored
 *    entirely — item_type defaults to 'service' (18% here), and the Add Service drawer
 *    never wrote item_type, so EVERY service created from it was billed at 18% while
 *    the UI displayed "GST: No".
 *
 *  - Mirrored rows (source_table NOT NULL) are maintained by the catalog-sync triggers
 *    in 20261008000136, which never set gst_applicable — so they all carry the column
 *    default false. Reading the toggle for them would zero out rates that are a matter
 *    of law, e.g. a non-ICU room above ₹5,000/day must attract 5%. These keep the
 *    statutory default derived from item_type.
 */
export function resolveServiceGstPercent(
  svc: CatalogServiceGstInput,
  unitRate?: number,
): number {
  const configured = Number(svc.gst_percent);
  const hasConfigured = Number.isFinite(configured) && configured > 0;

  // Hospital-authored: purely toggle-driven. Note that gst_applicable=true with a 0
  // percent is a legitimate saved state meaning "0%" — SettingsServicesPage writes
  // `form.gst_applicable ? (parseFloat(form.gst_percent) || 0) : 0` and its dropdown
  // offers 0% explicitly — so this must NOT fall through to the statutory rate. This
  // matches every other catalog-pricing path (serviceBilling, chargePosting,
  // ipdBilling), which all read `gst_applicable ? gst_percent : 0`.
  if (svc.source_table == null) {
    if (!svc.gst_applicable) return 0;
    return hasConfigured ? configured : 0;
  }

  // Module-owned mirror: an explicit rate if the module set one, else statute.
  return hasConfigured ? configured : getDefaultGSTRate(svc.item_type || "other", unitRate);
}

// ICU/CCU/ICCU/NICU rooms are fully GST-exempt regardless of room rent, per CBIC
// clarifications on Notification 12/2017-CT(Rate). SICU/PICU are treated as ICU-equivalent
// (clearly intensive-care by name) though not individually named in the circular. HDU is
// deliberately excluded — not covered by the ICU exemption, so it follows the ordinary rule.
const ICU_EQUIVALENT_BED_CATEGORIES = new Set(["icu", "nicu", "sicu", "picu", "ccu", "iccu"]);

/**
 * Authoritative source for room-charge GST — deterministic from bed category + rate, not
 * dependent on whether a hospital happens to have configured a matching service_rates /
 * service_master row (GST here is a matter of law, not hospital-configurable pricing).
 */
export function getRoomChargeGSTRate(bedCategory: string | null | undefined, ratePerDay: number): number {
  const category = (bedCategory || "").toLowerCase();
  if (ICU_EQUIVALENT_BED_CATEGORIES.has(category)) return 0;
  return ratePerDay > 5000 ? 5 : 0;
}

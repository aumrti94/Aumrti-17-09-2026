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

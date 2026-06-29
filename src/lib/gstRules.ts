// Indian GST rules for healthcare services per Notification 12/2017-CT(Rate) + amendments

export const GST_RATE_RULES: Record<string, number> = {
  consultation: 0,
  procedure: 0,
  surgery: 0,
  room_charge: 0,       // ≤ ₹5000/day: 0%; > ₹5000/day: 5% — checked at item level
  room_charge_luxury: 5,
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

export function getDefaultGSTRate(itemType: string, unitRate?: number): number {
  if (itemType === "room_charge" && unitRate && unitRate > 5000) return 5;
  return GST_RATE_RULES[itemType] ?? 0;
}

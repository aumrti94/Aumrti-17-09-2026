// ─── IPC care-bundle definitions ──────────────────────────────────────────────
//
// Shared source for the IPC module's device and bundle entry. The maintenance set
// is lifted from NursingKardexTab, which is the more complete of the two existing
// copies (it covers all six device types); the insertion set comes from
// IPDDeviceTab, which is the only place that had one.
//
// NOTE — deliberately NOT unified with IPDDeviceTab's own maintenance definitions.
// The two sets disagree on both the number and the identity of the elements
// (`urinary_catheter` is 4 items here and 5 there; `central_line` shares only
// `hand_hygiene`), so merging them changes the denominator — and therefore the
// score — for new checklists versus historical ones on the same chart. That is a
// clinical decision for the infection-control lead, not a refactor. Until then the
// bedside tabs keep their own definitions and this module serves the IPC module.
//
// The percentage rule here mirrors public.ipc_bundle_elements_compliance in
// 20261012000010_ipc_bundle_compliance_pct.sql. If you change one, change both.

export interface BundleElement {
  key: string;
  label: string;
}

export const DEVICE_LABELS: Record<string, string> = {
  central_line: "Central Line",
  peripheral_line: "Peripheral Line",
  urinary_catheter: "Urinary Catheter",
  ventilator: "Ventilator",
  tracheostomy: "Tracheostomy",
  others: "Other Device",
};

export const DEVICE_TYPES = Object.entries(DEVICE_LABELS).map(([value, label]) => ({ value, label }));

/** Daily maintenance bundle, per device type. */
export const MAINTENANCE_BUNDLES: Record<string, BundleElement[]> = {
  central_line: [
    { key: "hand_hygiene", label: "Hand hygiene performed before access" },
    { key: "max_barrier", label: "Maximum sterile barrier precautions maintained" },
    { key: "chlorhexidine", label: "Chlorhexidine skin antisepsis applied" },
    { key: "optimal_site", label: "Catheter at optimal site (femoral avoided)" },
    { key: "unnecessary_removed", label: "Necessity reviewed — central line still required" },
  ],
  urinary_catheter: [
    { key: "hand_hygiene", label: "Hand hygiene performed" },
    { key: "perineal_care", label: "Perineal care performed today" },
    { key: "drainage_unobstructed", label: "Drainage bag unobstructed and below bladder level" },
    { key: "catheter_secured", label: "Catheter properly secured to prevent traction" },
  ],
  ventilator: [
    { key: "hand_hygiene", label: "Hand hygiene performed" },
    { key: "hob_elevation", label: "Head of bed elevated 30–45°" },
    { key: "oral_care", label: "Oral care with chlorhexidine performed" },
    { key: "sedation_vacation", label: "Sedation vacation assessed / SAT performed" },
    { key: "cuff_pressure", label: "Cuff pressure checked (20–30 cmH₂O)" },
  ],
  peripheral_line: [
    { key: "hand_hygiene", label: "Hand hygiene performed" },
    { key: "site_inspection", label: "Insertion site checked — no signs of phlebitis" },
    { key: "dressing_intact", label: "Dressing clean, dry, and intact" },
    { key: "necessity_reviewed", label: "Necessity reviewed — peripheral line still required" },
  ],
  tracheostomy: [
    { key: "hand_hygiene", label: "Hand hygiene performed" },
    { key: "stoma_care", label: "Stoma site assessed and cared for" },
    { key: "inner_cannula", label: "Inner cannula cleaned or replaced" },
    { key: "ties_secure", label: "Tracheostomy ties secure (1-finger space)" },
  ],
  others: [
    { key: "hand_hygiene", label: "Hand hygiene performed" },
    { key: "site_care", label: "Device site assessed and cared for" },
    { key: "necessity_reviewed", label: "Necessity reviewed — device still required" },
  ],
};

/** Insertion bundle — only device types that have one appear here. */
export const INSERT_BUNDLES: Record<string, BundleElement[]> = {
  central_line: [
    { key: "hand_hygiene", label: "Hand hygiene performed before insertion" },
    { key: "full_barrier", label: "Full barrier precautions (sterile gloves, gown, mask, large drape)" },
    { key: "chlorhexidine", label: "Chlorhexidine-based skin antisepsis allowed to dry" },
    { key: "optimal_site", label: "Optimal insertion site selected (subclavian preferred)" },
    { key: "necessity", label: "Necessity of central line confirmed by physician" },
  ],
};

export type BundleType = "insert" | "maintenance" | "removal";

export function bundleElements(deviceType: string, bundleType: BundleType): BundleElement[] {
  if (bundleType === "insert") return INSERT_BUNDLES[deviceType] ?? [];
  return MAINTENANCE_BUNDLES[deviceType] ?? MAINTENANCE_BUNDLES.others;
}

export function hasInsertBundle(deviceType: string): boolean {
  return (INSERT_BUNDLES[deviceType]?.length ?? 0) > 0;
}

/**
 * Percentage of bundle elements met.
 *
 * Unanswered elements count against compliance — an item nobody confirmed was not
 * confirmed. This matches NursingKardexTab and the SQL fallback trigger.
 * Returns null for an empty definition so "unknown" never masquerades as 0%.
 */
export function computeCompliancePct(
  answers: Record<string, boolean | null | undefined>,
  elements: BundleElement[],
): number | null {
  if (elements.length === 0) return null;
  const met = elements.filter(e => answers[e.key] === true).length;
  return Math.round((met / elements.length) * 100);
}

/** Every element present as an explicit boolean, so unticked reads as false, not absent. */
export function toElementsJson(
  answers: Record<string, boolean | null | undefined>,
  elements: BundleElement[],
): Record<string, boolean> {
  return Object.fromEntries(elements.map(e => [e.key, answers[e.key] === true]));
}

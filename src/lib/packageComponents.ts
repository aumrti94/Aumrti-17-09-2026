/**
 * packageComponents — the shape stored in `health_packages.components` (jsonb).
 *
 * WHY THE EXTRA FIELDS. The original shape was `{name, type, estimated_mins, sequence}` — free
 * text with no id and no price. Everything downstream therefore had to guess: BookPackageModal
 * matched names against lab_test_master, TodaysCheckupsTab did an `ilike '%name%'`, and a typo
 * in the package silently produced no order at all. Carrying the master's id makes order
 * creation an exact lookup, and carrying the fee lets the modal show what the bundle is worth.
 *
 * BACKWARD COMPATIBLE. `source_id` / `source_table` / `fee` are optional. Packages created
 * before this change still parse, still render in the catalogue, and still resolve by name.
 */

export type PackageComponentType = "lab_test" | "radiology" | "consultation" | "service";

export type PackageComponentSource =
  | "lab_test_master"
  | "radiology_study_master"
  | "service_master";

export interface PackageComponent {
  name: string;
  type: PackageComponentType;
  estimated_mins: number;
  sequence: number;
  /** Master row id. Absent on packages created before master-backed picking. */
  source_id?: string | null;
  source_table?: PackageComponentSource | null;
  /** Master fee captured at selection time — what the component was "worth". */
  fee?: number;
}

/** Default minutes per component type, used to estimate how long a checkup takes. */
export const DEFAULT_MINS: Record<PackageComponentType, number> = {
  lab_test: 10,
  radiology: 20,
  consultation: 15,
  service: 15,
};

/** PURE. Coerce whatever is in the jsonb column into a usable array. Never throws. */
export function parseComponents(value: unknown): PackageComponent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): PackageComponent[] => {
    // Very old rows may be bare strings. Keep them rather than dropping a real component.
    if (typeof raw === "string") {
      return raw.trim()
        ? [{ name: raw.trim(), type: "service", estimated_mins: 15, sequence: 0 }]
        : [];
    }
    if (!raw || typeof raw !== "object") return [];
    const c = raw as Record<string, unknown>;
    const name = typeof c.name === "string" ? c.name : "";
    if (!name.trim()) return [];
    const type = (["lab_test", "radiology", "consultation", "service"] as const)
      .includes(c.type as PackageComponentType) ? (c.type as PackageComponentType) : "service";
    return [{
      name,
      type,
      estimated_mins: Number(c.estimated_mins) || DEFAULT_MINS[type],
      sequence: Number(c.sequence) || 0,
      source_id: typeof c.source_id === "string" ? c.source_id : null,
      source_table: typeof c.source_table === "string"
        ? (c.source_table as PackageComponentSource)
        : null,
      fee: Number(c.fee) || 0,
    }];
  });
}

/** PURE. Components of one type, in sequence order. */
export function componentsOfType(
  components: PackageComponent[],
  type: PackageComponentType
): PackageComponent[] {
  return components.filter((c) => c.type === type).sort((a, b) => a.sequence - b.sequence);
}

/** PURE. What the bundle would cost if bought item by item. */
export function componentsTotal(components: PackageComponent[]): number {
  return components.reduce((s, c) => s + (Number(c.fee) || 0), 0);
}

/**
 * PURE. Discount the package represents against its components.
 * Returns null when there is nothing meaningful to compare (no fees captured, or the package
 * is priced at or above its parts — the caller flags that case separately).
 */
export function packageDiscountPercent(componentsWorth: number, price: number): number | null {
  if (!(componentsWorth > 0) || !(price >= 0)) return null;
  if (price >= componentsWorth) return null;
  return Math.round(((componentsWorth - price) / componentsWorth) * 100);
}

/** PURE. Renumber `sequence` 1..n after an add/remove so the checkup order stays sane. */
export function resequence(components: PackageComponent[]): PackageComponent[] {
  return components.map((c, i) => ({ ...c, sequence: i + 1 }));
}

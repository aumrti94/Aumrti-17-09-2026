import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { getConfigDefaults } from "@/constants/configValueDefaults";

export interface ConfigValue {
  id:         string;
  value:      string;
  label:      string;
  sort_order: number;
  is_system:  boolean;
  hospital_id: string | null;
  metadata?:  Record<string, unknown> | null;
}

/** Rows as they come back from the table, before the active filter is applied. */
export type ConfigRow = ConfigValue & { is_active: boolean };

/**
 * Precedence for a given `value`, highest wins:
 *   2 — hospital-specific row (an override or a custom addition)
 *   1 — system row stored in the table (hospital_id IS NULL)
 *   0 — hardcoded default from configValueDefaults.ts
 * Ranking explicitly rather than relying on row order: the query sorts by
 * sort_order/label, so an override that keeps the system row's sort_order has no
 * guaranteed position.
 */
function rank(row: ConfigRow): number {
  if (row.hospital_id !== null)      return 2;
  if (!row.id.startsWith("default:")) return 1;
  return 0;
}

/**
 * Folds the table rows for a category onto the hardcoded defaults and drops
 * anything switched off. Exported so the precedence rules can be pinned by tests
 * without standing up React Query.
 */
export function mergeConfigValues(category: string, rows: ConfigRow[]): ConfigValue[] {
  const byValue = new Map<string, ConfigRow>();

  for (const d of getConfigDefaults(category)) {
    byValue.set(d.value, {
      id:          `default:${category}:${d.value}`,
      hospital_id: null,
      value:       d.value,
      label:       d.label,
      sort_order:  d.sort_order,
      is_system:   true,
      is_active:   true,
      metadata:    null,
    });
  }

  for (const row of rows) {
    const existing = byValue.get(row.value);
    if (!existing || rank(row) > rank(existing)) byValue.set(row.value, row);
  }

  return [...byValue.values()]
    .filter(r => r.is_active !== false)
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label))
    .map(({ is_active: _is_active, ...v }) => v);
}

/**
 * Returns the merged, active config values for a category.
 * Hospital-specific overrides take precedence over system defaults, which in turn
 * take precedence over the hardcoded defaults — so a category that was never
 * seeded still renders a usable dropdown instead of an empty one.
 * Results are stable across renders (React Query cache, 5-min stale).
 *
 * Usage:
 *   const routes = useConfigValues("drug_routes");
 *   routes.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)
 */
export function useConfigValues(category: string): ConfigValue[] {
  const { hospitalId } = useHospitalId();

  const { data = [] } = useQuery<ConfigValue[]>({
    queryKey: ["config-values", category, hospitalId ?? "system"],
    queryFn: async () => {
      const filterExpr = hospitalId
        ? `hospital_id.eq.${hospitalId},hospital_id.is.null`
        : "hospital_id.is.null";

      // is_active is filtered below rather than in the query: disabling a system
      // value stores a hospital row with is_active = false, and filtering it out
      // server-side would leave the system row underneath visible — the value
      // would stay in the dropdown despite being switched off.
      const { data: rows, error } = await (supabase as any)
        .from("hospital_config_values")
        .select("id, hospital_id, value, label, sort_order, is_system, is_active, metadata")
        .eq("category", category)
        .or(filterExpr)
        .order("sort_order", { ascending: true })
        .order("label",      { ascending: true });

      if (error) throw error;

      return mergeConfigValues(category, (rows ?? []) as ConfigRow[]);
    },
    staleTime: 5 * 60 * 1000, // 5 minutes — config values rarely change
    gcTime:    15 * 60 * 1000,
  });

  return data;
}

/**
 * Returns just the string values (for legacy arrays still used in logic,
 * not in dropdowns). Prefer useConfigValues for JSX rendering.
 */
export function useConfigValueStrings(category: string): string[] {
  return useConfigValues(category).map(v => v.value);
}

/**
 * Returns just the labels keyed by value — useful for display lookups.
 * e.g. labelMap["oral"] === "Oral (PO)"
 */
export function useConfigLabelMap(category: string): Record<string, string> {
  const values = useConfigValues(category);
  const map: Record<string, string> = {};
  for (const v of values) map[v.value] = v.label;
  return map;
}

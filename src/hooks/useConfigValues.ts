import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";

export interface ConfigValue {
  id:         string;
  value:      string;
  label:      string;
  sort_order: number;
  is_system:  boolean;
  hospital_id: string | null;
  metadata?:  Record<string, unknown> | null;
}

/**
 * Returns the merged, active config values for a category.
 * Hospital-specific overrides take precedence over system defaults.
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

      const { data: rows, error } = await (supabase as any)
        .from("hospital_config_values")
        .select("id, hospital_id, value, label, sort_order, is_system, metadata")
        .eq("category", category)
        .eq("is_active", true)
        .or(filterExpr)
        .order("sort_order", { ascending: true })
        .order("label",      { ascending: true });

      if (error) throw error;

      // Deduplicate: hospital-specific row wins over system default for same value.
      // After ordering, hospital-specific rows (hospital_id IS NOT NULL) come first
      // because NULL sorts last in Postgres ASC. We rely on that ordering here.
      const seen = new Set<string>();
      const merged: ConfigValue[] = [];
      for (const row of (rows ?? []) as ConfigValue[]) {
        if (!seen.has(row.value)) {
          seen.add(row.value);
          merged.push(row);
        }
      }
      return merged;
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

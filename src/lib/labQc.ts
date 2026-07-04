// Lab QC / Westgard rule evaluation.
// Lab module completion plan, Phase 2 — extracted from LabQCDashboard.tsx so the
// result-entry workspace can surface a non-blocking QC warning without duplicating
// the rule logic. The rules themselves are unchanged.
import { supabase } from "@/integrations/supabase/client";

export interface WestgardWarning {
  rule: string;
  severity: "warning" | "reject";
  message: string;
}

export const checkWestgardRules = (qcValues: number[], mean: number, sd: number): WestgardWarning[] => {
  const warnings: WestgardWarning[] = [];
  const n = qcValues.length;
  if (n < 2 || sd === 0) return warnings;

  const latest = qcValues[n - 1];
  const zscore = (latest - mean) / sd;

  // 1-3s rule
  if (Math.abs(zscore) > 3)
    warnings.push({ rule: "1-3s", severity: "reject", message: "Latest QC value exceeds 3 SD — run rejected" });

  // 1-2s rule
  if (Math.abs(zscore) > 2 && Math.abs(zscore) <= 3)
    warnings.push({ rule: "1-2s", severity: "warning", message: "Latest QC value exceeds 2 SD — check equipment" });

  // 2-2s rule
  if (n >= 2) {
    const prev = qcValues[n - 2];
    const prevZ = (prev - mean) / sd;
    if (zscore > 2 && prevZ > 2)
      warnings.push({ rule: "2-2s", severity: "reject", message: "Two consecutive QC values exceed +2 SD — systematic error" });
    if (zscore < -2 && prevZ < -2)
      warnings.push({ rule: "2-2s", severity: "reject", message: "Two consecutive QC values below -2 SD — systematic error" });
  }

  // R-4s rule
  if (n >= 2) {
    const prev = qcValues[n - 2];
    const prevZ = (prev - mean) / sd;
    if (Math.abs(zscore - prevZ) > 4)
      warnings.push({ rule: "R-4s", severity: "reject", message: "Range between consecutive values > 4 SD — random error" });
  }

  // 10x rule
  if (n >= 10) {
    const last10 = qcValues.slice(-10);
    const allAbove = last10.every(v => v > mean);
    const allBelow = last10.every(v => v < mean);
    if (allAbove || allBelow)
      warnings.push({ rule: "10x", severity: "warning", message: "10 consecutive values on same side of mean — drift detected" });
  }

  return warnings;
};

/**
 * Evaluate the most recent QC run for a test against Westgard rules.
 * Groups by (analyzer, level) and evaluates the group of the latest entry,
 * mirroring how LabQCDashboard charts per analyzer+level.
 * Returns [] when there is no QC data — absence of QC is not treated as a failure
 * (the warning is advisory; result entry must never be blocked by it).
 */
export async function getLatestQcWarnings(
  hospitalId: string,
  testName: string
): Promise<WestgardWarning[]> {
  try {
    const { data } = await (supabase as any)
      .from("lab_qc_entries")
      .select("analyzer, level, value, mean, sd, recorded_at")
      .eq("hospital_id", hospitalId)
      .ilike("test_name", testName)
      .order("recorded_at", { ascending: false })
      .limit(30);
    if (!data?.length) return [];

    const latest = data[0];
    const group = data
      .filter((e: any) => e.analyzer === latest.analyzer && e.level === latest.level)
      .reverse(); // chronological
    const values = group.map((e: any) => Number(e.value));
    return checkWestgardRules(values, Number(latest.mean), Number(latest.sd));
  } catch {
    return []; // advisory only — never let a QC lookup failure disturb result entry
  }
}

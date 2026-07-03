/**
 * ED triage reassessment SLA targets (minutes). Based on common ED triage
 * reassessment windows: P1 continuous, P2 ~10 min, P3 ~30 min, P4 ~60 min.
 * Used only to flag patients waiting past their reassessment window — no DB changes.
 */
const REASSESS_TARGET_MIN: Record<string, number> = {
  P1: 0,   // continuous monitoring
  P2: 10,
  P3: 30,
  P4: 60,
};

export function reassessmentTargetMinutes(triage: string): number | null {
  return triage in REASSESS_TARGET_MIN ? REASSESS_TARGET_MIN[triage] : null;
}

/**
 * Is this patient overdue for reassessment? Uses time-in-ED as a proxy for time
 * since last assessment (no reassessment timestamp is stored). Only flags visits
 * that are still awaiting attention.
 */
export function isReassessmentOverdue(triage: string, minutesInEd: number, disposition: string | null | undefined): boolean {
  const target = reassessmentTargetMinutes(triage);
  if (target == null) return false;
  if (disposition && disposition !== "awaiting") return false;
  return minutesInEd >= Math.max(target, 1);
}

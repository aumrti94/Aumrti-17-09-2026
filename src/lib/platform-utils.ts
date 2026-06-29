// ─── Platform shared utilities ────────────────────────────────────────────────
// Used by src/pages/platform/* and src/components/platform/*
// Consolidates duplicated constants and helpers.

// ── Status pill colour map (subscription status → Tailwind classes) ──────────
export const PLATFORM_STATUS_PILL: Record<string, string> = {
  active:          "bg-emerald-500/20 text-emerald-600",
  trial:           "bg-blue-500/20 text-blue-600",
  suspended:       "bg-red-500/20 text-red-600",
  past_due:        "bg-amber-500/20 text-amber-600",
  cancelled:       "bg-muted text-muted-foreground",
  no_subscription: "bg-muted text-muted-foreground",
};

// ── Indian currency formatting ───────────────────────────────────────────────
// Uses Indian numbering system: lakhs (L) and crores (Cr).
export function fmtINR(n: number): string {
  if (n >= 10_00_000) return `₹${(n / 10_00_000).toFixed(1)}Cr`;
  if (n >= 1_00_000)  return `₹${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000)     return `₹${(n / 1_000).toFixed(0)}K`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

// ── Hospital health score computation ────────────────────────────────────────
// Shared between ChurnRadarPage, HospitalsListPage
export interface HealthScoreInput {
  created_at: string;
  status: string;
  hasRecentOpd?: boolean;
  hasRecentBilling?: boolean;
}

export function computeHealthScore(h: HealthScoreInput): number {
  const ageDays = (Date.now() - new Date(h.created_at).getTime()) / 86400000;
  const hasOpd  = h.hasRecentOpd ?? false;
  const hasBill = h.hasRecentBilling ?? false;

  // New hospitals (< 14 days) — don't penalise for no activity yet
  if (ageDays < 14) {
    const newBase: Record<string, number> = { active: 78, trial: 72, past_due: 30, suspended: 10 };
    return newBase[h.status] ?? 55;
  }

  let score = 0;

  // Activity signals (50 pts) — real usage data
  if (hasOpd)  score += 30;
  if (hasBill) score += 20;

  // Payment health (30 pts)
  const statusScore: Record<string, number> = {
    active: 30, trial: 20, past_due: 8, suspended: 0, cancelled: 0, no_subscription: 0,
  };
  score += statusScore[h.status] ?? 0;

  // Tenure (20 pts) — established customers are more likely to stay
  if (ageDays > 180)      score += 20;
  else if (ageDays > 90)  score += 15;
  else if (ageDays > 30)  score += 10;
  else                    score += 5;

  return Math.min(100, score);
}

// ── Recharts theme-aware tooltip style ───────────────────────────────────────
// Uses CSS custom properties so it works in both light and dark mode (L3 fix).
export const RECHARTS_TOOLTIP_STYLE = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 11,
  color: "hsl(var(--foreground))",
};

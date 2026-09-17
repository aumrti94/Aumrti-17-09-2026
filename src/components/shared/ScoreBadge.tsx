import React from "react";

/**
 * Hospital health-score badge (0-100, tiered Healthy/Monitor/At Risk).
 *
 * Deliberately NOT folded into `StatusBadge`: StatusBadge renders a single
 * pill from a discrete status string, while this renders two coupled pieces
 * — the raw numeric score AND a derived tier label — driven by a continuous
 * 0-100 input, not an enum. Forcing it through `StatusBadge`'s `status: string`
 * prop would mean either dropping the number or string-encoding it
 * (`"score-72"`) and teaching StatusBadge a numeric-range special case just
 * for this one caller. Kept as its own small presentational component
 * instead, moved here so it's reusable beyond HospitalsListPage.
 */
export interface ScoreBadgeProps {
  score: number;
}

export const ScoreBadge: React.FC<ScoreBadgeProps> = ({ score }) => {
  const color =
    score >= 70
      ? "text-emerald-600 bg-emerald-500/10 border-emerald-500/30"
      : score >= 40
      ? "text-amber-600 bg-amber-500/10 border-amber-500/30"
      : "text-red-500 bg-red-500/10 border-red-500/30";
  const label = score >= 70 ? "Healthy" : score >= 40 ? "Monitor" : "At Risk";
  return (
    <div className="flex items-center gap-2">
      <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-full border ${color}`}>
        {score}
      </span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
};

export default ScoreBadge;

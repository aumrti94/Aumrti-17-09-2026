/**
 * NEWS2 — National Early Warning Score 2
 * Canonical implementation per Royal College of Physicians (UK) guidelines,
 * adopted by NABH 6th Edition for inpatient deterioration detection.
 *
 * Score thresholds:
 *   0–4  : Low risk     — routine monitoring
 *   5–6  : Medium risk  — urgent clinical review
 *   7    : High risk    — emergency clinical review
 *   ≥ 8  : Critical     — immediate emergency response (often ICU)
 */

export interface VitalsInput {
  respiratory_rate: number;       // breaths per minute
  spo2: number;                   // %
  on_supplemental_o2: boolean;
  systolic_bp: number;            // mmHg
  heart_rate: number;             // bpm
  consciousness: string;          // 'A' = Alert, anything else (C/V/P/U) = altered
  temperature: number;            // Celsius
}

export type NEWS2Level = "low" | "medium" | "high" | "critical";

export function calculateNEWS2(v: VitalsInput): number {
  let score = 0;

  // Respiratory Rate
  if (v.respiratory_rate <= 8) score += 3;
  else if (v.respiratory_rate <= 11) score += 1;
  else if (v.respiratory_rate <= 20) score += 0;
  else if (v.respiratory_rate <= 24) score += 2;
  else score += 3;

  // SpO2 (Scale 1 — non-hypercapnic)
  if (!v.on_supplemental_o2) {
    if (v.spo2 <= 91) score += 3;
    else if (v.spo2 <= 93) score += 2;
    else if (v.spo2 <= 95) score += 1;
  }

  // Supplemental O2
  if (v.on_supplemental_o2) score += 2;

  // Temperature (°C)
  if (v.temperature <= 35) score += 3;
  else if (v.temperature <= 36) score += 1;
  else if (v.temperature <= 38) score += 0;
  else if (v.temperature <= 39) score += 1;
  else score += 2;

  // Systolic BP
  if (v.systolic_bp <= 90) score += 3;
  else if (v.systolic_bp <= 100) score += 2;
  else if (v.systolic_bp <= 110) score += 1;
  else if (v.systolic_bp <= 219) score += 0;
  else score += 3;

  // Heart Rate
  if (v.heart_rate <= 40) score += 3;
  else if (v.heart_rate <= 50) score += 1;
  else if (v.heart_rate <= 90) score += 0;
  else if (v.heart_rate <= 110) score += 1;
  else if (v.heart_rate <= 130) score += 2;
  else score += 3;

  // Consciousness (ACVPU)
  if (v.consciousness !== "A") score += 3;

  return score;
}

export function getNEWS2Level(score: number): NEWS2Level {
  if (score <= 4) return "low";
  if (score <= 6) return "medium";
  if (score === 7) return "high";
  return "critical";
}

/** Tailwind class helpers for badge colouring. */
export function getNEWS2BadgeClasses(score: number): string {
  const level = getNEWS2Level(score);
  switch (level) {
    case "low":
      return "bg-emerald-100 text-emerald-700";
    case "medium":
      return "bg-amber-100 text-amber-700";
    case "high":
      return "bg-red-100 text-red-700 animate-pulse";
    case "critical":
      return "bg-red-200 text-red-800 animate-pulse";
  }
}

export function getNEWS2Label(score: number): string {
  const level = getNEWS2Level(score);
  switch (level) {
    case "low":      return `NEWS2: ${score} — Low`;
    case "medium":   return `NEWS2: ${score} — Medium Risk — Escalate`;
    case "high":     return `NEWS2: ${score} — HIGH RISK — Immediate Review`;
    case "critical": return `NEWS2: ${score} — CRITICAL — Emergency Response`;
  }
}

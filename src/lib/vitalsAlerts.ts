import { calculateNEWS2 as calculateNEWS2Canonical } from "./news2";

interface VitalsInput {
  bp_systolic?: number;
  bp_diastolic?: number;
  pulse?: number;
  temperature?: number; // Fahrenheit
  spo2?: number;
  respiratory_rate?: number;
}

interface VitalsAlert {
  parameter: string;
  value: number;
  severity: "warning" | "critical";
  message: string;
}

export function checkVitalsThresholds(vitals: VitalsInput): VitalsAlert[] {
  const alerts: VitalsAlert[] = [];

  if (vitals.bp_systolic) {
    if (vitals.bp_systolic >= 180)
      alerts.push({ parameter: "BP Systolic", value: vitals.bp_systolic, severity: "critical", message: "Hypertensive crisis — immediate attention required" });
    else if (vitals.bp_systolic >= 140)
      alerts.push({ parameter: "BP Systolic", value: vitals.bp_systolic, severity: "warning", message: "Elevated blood pressure" });
    else if (vitals.bp_systolic <= 90)
      alerts.push({ parameter: "BP Systolic", value: vitals.bp_systolic, severity: "critical", message: "Hypotension — immediate attention required" });
  }

  if (vitals.spo2) {
    if (vitals.spo2 < 90)
      alerts.push({ parameter: "SpO2", value: vitals.spo2, severity: "critical", message: "Severe hypoxemia — urgent O₂ intervention" });
    else if (vitals.spo2 < 94)
      alerts.push({ parameter: "SpO2", value: vitals.spo2, severity: "warning", message: "Low oxygen saturation" });
  }

  if (vitals.pulse) {
    if (vitals.pulse > 130)
      alerts.push({ parameter: "Pulse", value: vitals.pulse, severity: "critical", message: "Severe tachycardia" });
    else if (vitals.pulse > 100)
      alerts.push({ parameter: "Pulse", value: vitals.pulse, severity: "warning", message: "Tachycardia" });
    else if (vitals.pulse < 50)
      alerts.push({ parameter: "Pulse", value: vitals.pulse, severity: "critical", message: "Severe bradycardia" });
  }

  if (vitals.temperature) {
    if (vitals.temperature >= 104)
      alerts.push({ parameter: "Temperature", value: vitals.temperature, severity: "critical", message: "High fever — cooling measures needed" });
    else if (vitals.temperature >= 100.4)
      alerts.push({ parameter: "Temperature", value: vitals.temperature, severity: "warning", message: "Fever" });
    else if (vitals.temperature < 95)
      alerts.push({ parameter: "Temperature", value: vitals.temperature, severity: "critical", message: "Hypothermia" });
  }

  if (vitals.respiratory_rate) {
    if (vitals.respiratory_rate > 25)
      alerts.push({ parameter: "RR", value: vitals.respiratory_rate, severity: "critical", message: "Tachypnea — respiratory distress" });
    else if (vitals.respiratory_rate < 8)
      alerts.push({ parameter: "RR", value: vitals.respiratory_rate, severity: "critical", message: "Bradypnea — ventilation assessment needed" });
  }

  return alerts;
}

// Thin wrapper around the canonical NEWS2 formula (src/lib/news2.ts) — converts the Fahrenheit
// temperature this screen collects to Celsius, and always scores as room-air/alert since this
// formula never captured supplemental-O2 status or consciousness (matches its prior behaviour
// exactly — it never added the +2 O2 term or an ACVPU term either).
export function calculateNEWS2(vitals: VitalsInput): number {
  return calculateNEWS2Canonical({
    respiratory_rate: vitals.respiratory_rate,
    spo2: vitals.spo2,
    on_supplemental_o2: false,
    systolic_bp: vitals.bp_systolic,
    heart_rate: vitals.pulse,
    consciousness: "A",
    temperature: vitals.temperature != null ? (vitals.temperature - 32) * 5 / 9 : undefined,
  });
}

/**
 * Returns a Tailwind color class for a vital parameter value.
 * "normal" = default, "warning" = amber, "critical" = red
 */
export function vitalSeverityClass(param: string, value: number | null | undefined): string {
  if (value == null) return "";
  switch (param) {
    case "bp_systolic":
      if (value >= 180 || value <= 90) return "text-destructive font-bold";
      if (value >= 140) return "text-amber-600 font-semibold";
      return "";
    case "spo2":
      if (value < 90) return "text-destructive font-bold";
      if (value < 94) return "text-amber-600 font-semibold";
      return "";
    case "pulse":
      if (value > 130 || value < 50) return "text-destructive font-bold";
      if (value > 100) return "text-amber-600 font-semibold";
      return "";
    case "temperature":
      if (value >= 104 || value < 95) return "text-destructive font-bold";
      if (value >= 100.4) return "text-amber-600 font-semibold";
      return "";
    case "respiratory_rate":
      if (value > 25 || value < 8) return "text-destructive font-bold";
      return "";
    default:
      return "";
  }
}

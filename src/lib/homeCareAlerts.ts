/**
 * Tele-monitoring alert thresholds for home care.
 *
 * Extracted from HomeTeleMonitoringTab so the Home Care header KPI and the
 * readings table agree on what "alert" means. Previously the header counted
 * every reading with alert_sent = false, which is not the same thing at all.
 *
 * Thresholds are calibrated for Indian adult home-care patients and reviewed
 * by clinical (@ramesh). Change them here only — never inline at a call site.
 */

export interface TeleReadingVitals {
  bp_systolic?: number | null;
  bp_diastolic?: number | null;
  pulse?: number | null;
  blood_sugar?: number | null;
  spo2?: number | null;
}

export const TELE_ALERT_THRESHOLDS = {
  bpSystolicHigh:   160,   // mmHg
  bpDiastolicHigh:  100,   // mmHg
  spo2Low:          92,    // %
  bloodSugarHigh:   250,   // mg/dL
  bloodSugarLow:    60,    // mg/dL
} as const;

/** True when any recorded vital breaches a home-care escalation threshold. */
export function hasAlert(r: TeleReadingVitals): boolean {
  if (r.bp_systolic && r.bp_systolic > TELE_ALERT_THRESHOLDS.bpSystolicHigh) return true;
  if (r.bp_diastolic && r.bp_diastolic > TELE_ALERT_THRESHOLDS.bpDiastolicHigh) return true;
  if (r.spo2 && r.spo2 < TELE_ALERT_THRESHOLDS.spo2Low) return true;
  if (r.blood_sugar && (
    r.blood_sugar > TELE_ALERT_THRESHOLDS.bloodSugarHigh ||
    r.blood_sugar < TELE_ALERT_THRESHOLDS.bloodSugarLow
  )) return true;
  return false;
}

/** Human-readable reasons a reading tripped — used in the escalation message. */
export function alertReasons(r: TeleReadingVitals): string[] {
  const out: string[] = [];
  if (r.bp_systolic && r.bp_systolic > TELE_ALERT_THRESHOLDS.bpSystolicHigh) {
    out.push(`BP systolic ${r.bp_systolic} mmHg`);
  }
  if (r.bp_diastolic && r.bp_diastolic > TELE_ALERT_THRESHOLDS.bpDiastolicHigh) {
    out.push(`BP diastolic ${r.bp_diastolic} mmHg`);
  }
  if (r.spo2 && r.spo2 < TELE_ALERT_THRESHOLDS.spo2Low) {
    out.push(`SpO2 ${r.spo2}%`);
  }
  if (r.blood_sugar && r.blood_sugar > TELE_ALERT_THRESHOLDS.bloodSugarHigh) {
    out.push(`Blood sugar ${r.blood_sugar} mg/dL`);
  }
  if (r.blood_sugar && r.blood_sugar < TELE_ALERT_THRESHOLDS.bloodSugarLow) {
    out.push(`Blood sugar ${r.blood_sugar} mg/dL (hypoglycaemia)`);
  }
  return out;
}

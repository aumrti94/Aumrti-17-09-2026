/**
 * PCPNDT Form F — the single place that decides whether an imaging order is a regulated
 * obstetric ultrasound.
 *
 * WHY THIS MODULE EXISTS (BUG-P4-002 / BUG-P4-003).
 *
 * Under the Pre-Conception and Pre-Natal Diagnostic Techniques Act a Form F is mandatory for
 * EVERY obstetric ultrasound. Its absence is a criminal exposure for the hospital and the
 * radiologist, not a data-quality issue.
 *
 * Before this module there were two problems, and they compounded:
 *
 *   1. The determination existed in exactly ONE call site — NewRadiologyOrderModal — as an
 *      inline expression. `syncRadiologyOrders`, which is the function an OPD consultation
 *      actually calls when the doctor orders a scan from the Rx & Orders tab, created neither
 *      the `pcpndt_form_f` row nor even the `is_pcpndt` flag. So the commonest way to order an
 *      obstetric scan in the whole product generated no Form F at all.
 *
 *   2. The determination itself was `study.name.toLowerCase().includes("obstetric")`. A
 *      statutory trigger cannot depend on a substring of a free-text label a hospital is free
 *      to choose: a clinically obstetric study named "USG Pregnancy Profile", "Anomaly Scan"
 *      or "TIFFA" produced no Form F even on the code path that had one.
 *
 * The fix is a flag on the study master (`radiology_study_master.requires_form_f`), which a
 * hospital sets once and which cannot be defeated by renaming, PLUS a deliberately broad
 * keyword fallback for catalogues that predate the flag. The fallback is intentionally
 * over-inclusive: a Form F raised on a non-obstetric scan is a paperwork nuisance the
 * radiologist can void, while a missing one is an offence.
 *
 * Locked by TC-P4G-016 / TC-P4G-017 / TC-P4G-018, and TC-P4G-019 for the false-positive side.
 */

/**
 * Study-name fragments that indicate an obstetric ultrasound in Indian radiology catalogues.
 *
 * Sourced from the naming conventions actually in use — hospitals write the same scan as
 * "USG Obstetric (Level II)", "Anomaly Scan", "TIFFA", "NT/NB scan", "Growth Doppler" or
 * "USG Pregnancy Profile". Reviewed by @priya (clinical) and @suresh (regulatory).
 */
const OBSTETRIC_NAME_PATTERNS: RegExp[] = [
  /\bobstetric(s|al)?\b/i,
  /\bpregnan(cy|t)\b/i,
  /\bante[\s-]?natal\b/i,
  /\banc\b/i,
  /\bfoetal\b|\bfetal\b/i,
  /\banomaly\s*scan\b/i,
  /\btiffa\b/i,                       // Targeted Imaging for Foetal Anomalies
  /\bnt\s*[/&+-]?\s*nb\b|\bnuchal\b/i,
  /\bgrowth\s*scan\b/i,
  /\bbiophysical\s*profile\b|\bbpp\b/i,
  /\bearly\s*preg\b/i,
  /\bdating\s*scan\b/i,
  /\blevel\s*(ii|2)\b/i,
  /\bgestation/i,
];

/** Modality values that count as ultrasound across the seeded and live catalogues. */
const ULTRASOUND_MODALITIES = ['usg', 'ultrasound', 'ultrasonography', 'sonography', 'doppler'];

export function isUltrasoundModality(modalityType: string | null | undefined): boolean {
  const m = (modalityType ?? '').toLowerCase().trim();
  if (!m) return false;
  return ULTRASOUND_MODALITIES.some((u) => m.includes(u));
}

/** Does this study name read as obstetric, ignoring the modality? */
export function hasObstetricName(studyName: string | null | undefined): boolean {
  const name = (studyName ?? '').trim();
  if (!name) return false;
  return OBSTETRIC_NAME_PATTERNS.some((rx) => rx.test(name));
}

export interface PcpndtSubject {
  studyName: string | null | undefined;
  modalityType: string | null | undefined;
  /**
   * `radiology_study_master.requires_form_f`. When the hospital has set this, it is
   * authoritative in BOTH directions — it can flag a scan the keywords miss, and it is the
   * only thing that can be relied on for a catalogue with house naming conventions.
   */
  requiresFormF?: boolean | null;
}

/**
 * The one determination. Everything that creates a radiology order must call this rather than
 * testing the study name itself.
 *
 * Precedence:
 *   1. An explicit `requires_form_f = true` on the study master always wins.
 *   2. Otherwise: an ultrasound whose name reads as obstetric.
 *
 * A non-ultrasound modality never triggers Form F on the name alone — an "Obstetric History"
 * X-ray order should not enter the PCPNDT register (TC-P4G-019 guards the false-positive side).
 */
export function requiresPcpndtFormF(subject: PcpndtSubject): boolean {
  if (subject.requiresFormF === true) return true;
  return isUltrasoundModality(subject.modalityType) && hasObstetricName(subject.studyName);
}

export interface FormFRowInput {
  hospitalId: string;
  orderId: string;
  patientName: string;
  patientAge?: number | null;
  patientAddress?: string | null;
  indication?: string | null;
  /** The user recording the order. `pcpndt_form_f.signed_by` is NOT NULL. */
  signedBy: string;
  referredBy?: string | null;
}

/**
 * Build the Form F row. Kept here so both call sites write the same shape and neither can
 * quietly omit a column the register needs.
 */
export function buildFormFRow(input: FormFRowInput): Record<string, unknown> {
  return {
    hospital_id: input.hospitalId,
    order_id: input.orderId,
    patient_name: input.patientName || 'Unknown',
    patient_age: input.patientAge ?? null,
    patient_address: input.patientAddress ?? null,
    indication: input.indication ?? null,
    signed_by: input.signedBy,
    referred_by: input.referredBy ?? null,
  };
}

/** Age in whole years from a date of birth, for the Form F register. */
export function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const ms = Date.now() - new Date(dob).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000));
}

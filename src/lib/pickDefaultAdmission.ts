/**
 * Chooses which admission an ancillary order should attach to. Lifted out of
 * AdmissionLinker.tsx so that file exports only its component — a file mixing
 * component and non-component exports silently disables Fast Refresh for it.
 */
export interface ActiveAdmission {
  id: string;
  admission_number: string | null;
  admission_type: string | null;
}

export function isDaycare(a: ActiveAdmission): boolean {
  return (a.admission_type || "").toLowerCase() === "daycare";
}

/** PURE. The default pick: an explicitly requested admission, else inpatient over day care, else most recent. */
export function pickDefaultAdmission(
  admissions: ActiveAdmission[],
  preferredId?: string | null
): ActiveAdmission | null {
  if (admissions.length === 0) return null;
  if (preferredId) {
    const wanted = admissions.find((a) => a.id === preferredId);
    if (wanted) return wanted;
  }
  return admissions.find((a) => !isDaycare(a)) ?? admissions[0];
}

/**
 * NDPS compliance checks before dispensing Schedule X drugs.
 * Returns { ok: true } or { ok: false, reason: string }.
 */
export function validateNDPSDispense(params: {
  secondPharmacistId?: string;
  currentUserId: string;
  patientAddress?: string;
}): { ok: boolean; reason?: string } {
  const { secondPharmacistId, currentUserId, patientAddress } = params;

  if (!secondPharmacistId) {
    return { ok: false, reason: "Second pharmacist verification is required for NDPS drugs" };
  }

  if (secondPharmacistId === currentUserId) {
    return { ok: false, reason: "Second pharmacist must be a different person (not self)" };
  }

  if (!patientAddress || patientAddress.trim().length === 0) {
    return { ok: false, reason: "Patient address must be recorded for NDPS dispensing" };
  }

  return { ok: true };
}

/**
 * GST / HSN validation before bill finalisation.
 * Returns list of line items missing HSN codes.
 */
export function validateGSTLineItems(lineItems: { description: string; gst_percent: number; hsn_code: string | null }[]): string[] {
  return lineItems
    .filter(i => i.gst_percent > 0 && !i.hsn_code)
    .map(i => i.description);
}

/**
 * DPDP consent text for patient registration.
 */
export function getDPDPConsentText(hospitalName: string): string {
  return `I consent to ${hospitalName} collecting and processing my health data for treatment purposes, as required by the Digital Personal Data Protection Act, 2023.`;
}

// GST split helpers for procurement (purchase side).
// India: intra-state supply -> CGST + SGST (half each); inter-state -> IGST (full).
// State is decided by the 2-digit GST state code (first 2 chars of GSTIN, or an
// explicitly stored state_code).

export function stateCodeFromGstin(gstin?: string | null): string | null {
  if (!gstin || gstin.length < 2) return null;
  const code = gstin.slice(0, 2);
  return /^\d{2}$/.test(code) ? code : null;
}

/** Resolve a usable state code from an explicit code, falling back to the GSTIN prefix. */
export function resolveStateCode(stateCode?: string | null, gstin?: string | null): string | null {
  if (stateCode && /^\d{2}$/.test(stateCode.trim())) return stateCode.trim();
  return stateCodeFromGstin(gstin);
}

export interface GstSplit {
  gst: number;   // total tax
  cgst: number;
  sgst: number;
  igst: number;
  interState: boolean;
}

export function splitGst(params: {
  amount: number;            // taxable value
  gstPercent: number;
  sellerStateCode?: string | null;
  buyerStateCode?: string | null;
}): GstSplit {
  const { amount, gstPercent, sellerStateCode, buyerStateCode } = params;
  const gst = (amount * gstPercent) / 100;
  // Only treat as inter-state when both codes are known and differ; otherwise default
  // to intra-state (CGST/SGST), the safe assumption when a state code is missing.
  const interState = !!sellerStateCode && !!buyerStateCode && sellerStateCode !== buyerStateCode;
  if (interState) return { gst, cgst: 0, sgst: 0, igst: gst, interState: true };
  return { gst, cgst: gst / 2, sgst: gst / 2, igst: 0, interState: false };
}

/**
 * Pure ABDM validation helpers — no side effects, easily unit-testable.
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Validates a 14-digit ABHA number (with or without dashes). */
export function validateAbhaId(abhaId: string): ValidationResult {
  const digits = abhaId.replace(/[-\s]/g, "");
  if (!digits) return { valid: false, error: "ABHA ID is required" };
  if (!/^\d+$/.test(digits)) return { valid: false, error: "ABHA ID must contain only digits (and optional dashes)" };
  if (digits.length !== 14) return { valid: false, error: `ABHA ID must be 14 digits (got ${digits.length})` };
  return { valid: true };
}

/** Validates an ABHA address (phr-address@abdm format or bare address part). */
export function validateAbhaAddress(addr: string): ValidationResult {
  const bare = addr.includes("@") ? addr.split("@")[0] : addr;
  if (!bare) return { valid: false, error: "ABHA address is required" };
  if (bare.length < 8) return { valid: false, error: "ABHA address must be at least 8 characters" };
  if (bare.length > 18) return { valid: false, error: "ABHA address must be at most 18 characters" };
  if (!/^[a-zA-Z0-9._]+$/.test(bare))
    return { valid: false, error: "Only letters, digits, dots and underscores allowed" };
  if (/^[._]/.test(bare) || /[._]$/.test(bare))
    return { valid: false, error: "Address cannot start or end with dot or underscore" };
  return { valid: true };
}

/** Validates a mobile number for ABHA registration (10 digits, starts 6–9). */
export function validateMobileForAbha(mobile: string): ValidationResult {
  const digits = mobile.replace(/\D/g, "");
  if (digits.length !== 10) return { valid: false, error: "Enter a valid 10-digit mobile number" };
  if (!/^[6-9]/.test(digits)) return { valid: false, error: "Mobile number must start with 6, 7, 8 or 9" };
  return { valid: true };
}

/** Validates Aadhaar format (12 digits, not starting with 0 or 1). */
export function validateAadhaarFormat(aadhaar: string): ValidationResult {
  const digits = aadhaar.replace(/\s/g, "");
  if (!/^\d+$/.test(digits)) return { valid: false, error: "Aadhaar must contain only digits" };
  if (digits.length !== 12) return { valid: false, error: `Aadhaar must be 12 digits (got ${digits.length})` };
  if (/^[01]/.test(digits)) return { valid: false, error: "Aadhaar number cannot start with 0 or 1" };
  return { valid: true };
}

/** Formats a raw 14-digit string as XX-XXXX-XXXX-XXXX. */
export function formatAbhaNumber(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `${d.slice(0, 2)}-${d.slice(2)}`;
  if (d.length <= 10) return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}-${d.slice(10)}`;
}

/** Validates an HPR ID (8–14 digits). */
export function validateHprId(hprId: string): ValidationResult {
  const digits = hprId.replace(/\D/g, "");
  if (!digits) return { valid: false, error: "HPR ID is required" };
  if (digits.length < 8 || digits.length > 14)
    return { valid: false, error: "HPR ID must be 8–14 digits" };
  return { valid: true };
}

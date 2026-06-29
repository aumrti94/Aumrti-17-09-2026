/**
 * src/lib/phi-crypto.ts — Browser-side PHI Display Masking for Aumrti HMS
 *
 * ⚠️  THIS MODULE DOES NOT HOLD OR PERFORM DECRYPTION.
 *
 * Decryption happens exclusively in Edge Functions (server-side) using the
 * DEK stored in Supabase Vault. The browser NEVER sees key material.
 *
 * This module provides:
 *  1. `maskPHI()` — mask a plaintext or partially-visible value for display
 *     (e.g., show last 4 digits of phone, first name only).
 *  2. `isPHIEncrypted()` — detect whether a DB value is already encrypted
 *     (has the `v{n}:` version prefix).
 *  3. `phiDisplayValue()` — resolve what to show in a UI component given a
 *     potentially-encrypted column value.
 *
 * USAGE:
 *   import { maskPHI, phiDisplayValue } from "@/lib/phi-crypto";
 *
 *   // In a React component:
 *   <span>{maskPHI(patient.phone, 'phone')}</span>
 *   // Renders: "98765 ****10"
 *
 *   // For records fetched from the DB where enc migration is in progress:
 *   <span>{phiDisplayValue(row.phone, row.phone_enc, 'phone')}</span>
 */

// ── PHI field types supported for masking ─────────────────────────────────

export type PHIFieldType = "phone" | "aadhaar" | "name" | "email" | "address" | "dob";

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Mask a plaintext PHI value for safe display in the UI.
 *
 * Rules per Indian clinical context:
 * - phone   : last 4 digits visible, rest masked  → "98765 ****10" (but actual last 2)
 * - aadhaar : last 4 digits visible                → "**** **** 1234"
 * - name    : first name only, surname masked      → "Ramesh ****"
 * - email   : first 2 chars + domain              → "ra****@gmail.com"
 * - address : city/district visible, rest masked   → "**** Nagpur"
 * - dob     : show year only                       → "****-**-1985" → year visible
 *
 * @param value - The plaintext PHI value (or already-masked value).
 * @param type  - The field type for context-specific masking.
 * @returns     Masked string safe for display in UI.
 */
export function maskPHI(value: string | null | undefined, type: PHIFieldType): string {
  if (!value) return "—";
  const v = value.trim();
  if (!v) return "—";

  // If the value is already an encrypted blob (v1:...) — show placeholder
  if (isPHIEncrypted(v)) return getEncryptedPlaceholder(type);

  switch (type) {
    case "phone": {
      // Indian mobile: 10 digits. Show first 5 + last 2, mask middle 3
      const digits = v.replace(/\D/g, "");
      if (digits.length >= 10) {
        return `${digits.slice(0, 5)} *** ${digits.slice(-2)}`;
      }
      return `${v.slice(0, 2)}${"*".repeat(Math.max(0, v.length - 4))}${v.slice(-2)}`;
    }

    case "aadhaar": {
      // 12-digit Aadhaar: show last 4 only
      const digits = v.replace(/\D/g, "");
      if (digits.length === 12) {
        return `**** **** ${digits.slice(-4)}`;
      }
      return `****-****-${v.slice(-4)}`;
    }

    case "name": {
      // Show first name, mask surname(s)
      const parts = v.trim().split(/\s+/);
      if (parts.length === 1) return v; // Single name — show it
      const [firstName, ...rest] = parts;
      return `${firstName} ${"*".repeat(rest.join(" ").length)}`;
    }

    case "email": {
      const atIdx = v.indexOf("@");
      if (atIdx < 0) return `${v.slice(0, 2)}****`;
      const local = v.slice(0, atIdx);
      const domain = v.slice(atIdx); // includes @
      const visible = Math.min(2, local.length);
      return `${local.slice(0, visible)}${"*".repeat(local.length - visible)}${domain}`;
    }

    case "address": {
      // Show last word (typically city/district), mask the rest
      const words = v.trim().split(/\s+/);
      if (words.length <= 2) return v; // Short address — show it
      const city = words.slice(-1)[0];
      return `**** ${city}`;
    }

    case "dob": {
      // Show year only: 1985-03-12 → ****-**-1985 (year at end)
      const match = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (match) return `${match[3]}/**/${match[1]}`; // DD/MM/YYYY with year
      return `****${v.slice(-4)}`;
    }

    default:
      return `${v.slice(0, 2)}****`;
  }
}

/**
 * Detect whether a value stored in the DB is an encrypted PHI blob.
 *
 * Encrypted values have the format: `v{version}:{base64payload}`
 * e.g. `v1:aGVsbG8gd29ybGQ...`
 */
export function isPHIEncrypted(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^v\d+:[A-Za-z0-9+/]+=*$/.test(value.trim());
}

/**
 * Resolve the display value for a UI component given a column that may be
 * in the middle of the encryption migration (some rows plaintext, some encrypted).
 *
 * During the backfill window, a row may have:
 *  - `phone` = "9876543210"    (old plaintext — not yet migrated)
 *  - `phone_enc` = "v1:abc..."  (new encrypted — migrated)
 *
 * Pass BOTH values; this function returns the appropriate masked display string.
 *
 * @param plaintextValue  - The legacy plaintext column value (may be null after migration).
 * @param encryptedValue  - The new `_enc` column value (null before migration).
 * @param type            - PHI field type for masking.
 * @returns               Display-safe string.
 */
export function phiDisplayValue(
  plaintextValue: string | null | undefined,
  encryptedValue: string | null | undefined,
  type: PHIFieldType
): string {
  // Prefer encrypted column — if it exists, the plaintext column may have been nulled
  if (encryptedValue && !isPHIEncrypted(encryptedValue)) {
    // Shouldn't happen (enc column should always be encrypted), but handle gracefully
    return maskPHI(encryptedValue, type);
  }

  if (encryptedValue && isPHIEncrypted(encryptedValue)) {
    // Row has been migrated — show placeholder until server-decrypts it for privileged views
    return getEncryptedPlaceholder(type);
  }

  // Fall back to masking the plaintext value (pre-migration)
  return maskPHI(plaintextValue, type);
}

/**
 * Returns a role-specific placeholder shown when a field is encrypted
 * and the browser cannot decrypt it.
 *
 * For privileged roles (doctor, admin), the actual value should be fetched
 * via the `upsert-patient-phi` or `decrypt-phi-field` Edge Function.
 * For non-privileged roles, this placeholder is the final display value.
 */
export function getEncryptedPlaceholder(type: PHIFieldType): string {
  switch (type) {
    case "phone":   return "●●● ●●● ●●●●";
    case "aadhaar": return "**** **** ****";
    case "name":    return "Protected Name";
    case "email":   return "●●●@●●●.com";
    case "address": return "[Address Protected]";
    case "dob":     return "**/**/****";
    default:        return "[Protected]";
  }
}

// ── Utility: normalize phone for consistent hashing ───────────────────────

/**
 * Normalize an Indian mobile number for consistent HMAC hashing.
 * Strips +91 prefix, spaces, and dashes. Returns 10-digit string.
 *
 * IMPORTANT: apply this SAME normalization before calling the server-side
 * `hashPHI()` function so that search hashes match across entry methods.
 *
 * @example
 *   normalizePhone("+91 98765-43210")  // "9876543210"
 *   normalizePhone("09876543210")       // "9876543210"
 */
export function normalizePhone(phone: string): string {
  const stripped = phone.replace(/[\s\-\(\)]/g, "").replace(/^\+91/, "").replace(/^0/, "");
  return stripped;
}

/**
 * Normalize an Aadhaar number for consistent hashing.
 * Removes spaces and dashes.
 *
 * @example
 *   normalizeAadhaar("1234 5678 9012")  // "123456789012"
 */
export function normalizeAadhaar(aadhaar: string): string {
  return aadhaar.replace(/[\s\-]/g, "");
}

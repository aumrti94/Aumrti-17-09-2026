// @ts-nocheck
// PHI Redactor — DPDP Act 2023 compliance (Sprint 7C)
//
// Apply to ANY text that may appear in function logs or audit records.
// Do NOT apply to the actual AI request payload — clinical accuracy requires full context.
// ONLY apply at persistence and logging boundaries.

const PHI_RULES: Array<{ pattern: RegExp; replacement: string }> = [
  // Indian mobile numbers (10 digits starting 6-9, with optional +91 prefix)
  { pattern: /(?:\+91[-\s]?)?[6-9]\d{9}\b/g, replacement: "[MOBILE]" },
  // Aadhaar-like 12-digit numbers (with or without spaces/dashes)
  { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, replacement: "[AADHAAR]" },
  // Email addresses
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: "[EMAIL]" },
  // Encrypted PHI blobs — versioned AES-GCM ciphertext: v{n}:{base64}
  // Redact to prevent large base64 blobs from flooding logs.
  { pattern: /v\d+:[A-Za-z0-9+\/]{20,}={0,2}/g, replacement: "[PHI-ENCRYPTED]" },
  // JSON string fields that commonly carry PHI — redact the value, keep the key
  {
    pattern: /"(?:patient_name|full_name|guardian_name|father_name|mother_name|spouse_name|name)"\s*:\s*"[^"]+"/g,
    replacement: '"name":"[REDACTED]"',
  },
  {
    pattern: /"(?:mobile|phone|contact|telephone|cell|phone_enc|ec_phone_enc)"\s*:\s*"[^"]+"/g,
    replacement: '"phone":"[REDACTED]"',
  },
  {
    pattern: /"(?:address|village|locality|street|city|district|address_enc)"\s*:\s*"[^"]+"/g,
    replacement: '"address":"[REDACTED]"',
  },
  {
    pattern: /"(?:aadhaar|aadhar|uid|national_id|aadhaar_enc)"\s*:\s*"[^"]+"/g,
    replacement: '"aadhaar":"[REDACTED]"',
  },
  // Encrypted column names with their ciphertext values
  {
    pattern: /"(?:name_enc|result_enc|notes_enc|prompt_enc|last_message_enc|signature_data_enc|patient_name_enc)"\s*:\s*"[^"]+"/g,
    replacement: '"phi_enc":"[PHI-ENCRYPTED]"',
  },
  // Hash columns (HMAC digests — 64 hex chars)
  {
    pattern: /"(?:phone_hash|name_hash|aadhaar_hash|ec_phone_hash)"\s*:\s*"[0-9a-f]{64}"/g,
    replacement: '"phi_hash":"[HMAC]"',
  },
];

const MAX_LOG_LENGTH = 500;

/**
 * Strips Indian PHI patterns from a string before it is written to logs or audit records.
 * Truncates to MAX_LOG_LENGTH after redaction to keep logs manageable.
 */
export function sanitizeForLog(text: string): string {
  if (!text) return text;
  let out = text;
  for (const { pattern, replacement } of PHI_RULES) {
    out = out.replace(pattern, replacement);
  }
  if (out.length > MAX_LOG_LENGTH) {
    out = out.slice(0, MAX_LOG_LENGTH) + "…[truncated]";
  }
  return out;
}

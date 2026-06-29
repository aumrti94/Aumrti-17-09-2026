/**
 * _shared/abdm-encrypt.ts — RSA-OAEP encryption utilities for ABDM.
 *
 * The NHA V3 spec requires all Personally Identifiable Information (PII)
 * such as Aadhaar numbers to be encrypted with the gateway's RSA public
 * key before transmission.
 *
 * Uses the Web Crypto API (`crypto.subtle`) which is available natively in
 * Deno — no third-party crypto library needed.
 *
 * Import in any edge function that handles Aadhaar-based ABHA creation:
 *
 *   import {
 *     fetchAbdmPublicKey,
 *     encryptWithAbdmKey,
 *   } from "../_shared/abdm-encrypt.ts";
 *
 * NHA docs ref: ABDM Integration Guide v3 — Section 6.1 Data Encryption
 */

/**
 * Fetch the current RSA public key from the ABDM gateway.
 *
 * The key rotates periodically; do not cache it for more than one session.
 * Call this once per ABHA creation flow and pass the result to
 * {@link encryptWithAbdmKey}.
 *
 * @param abdmBaseUrl - From `hospital_abdm_config.abdm_base_url`,
 *   e.g. `"https://dev.abdm.gov.in"`.
 * @param token - Valid bearer token from `getAbdmToken()`.
 * @param isProduction - Determines the `X-CM-ID` header value.
 * @returns PEM-encoded RSA public key string.
 *
 * NHA endpoint: GET {abdmBaseUrl}/v3/profile/public/certificate
 */
export async function fetchAbdmPublicKey(
  abdmBaseUrl: string,
  token: string,
  isProduction = false,
): Promise<string> {
  const res = await fetch(`${abdmBaseUrl}/v3/profile/public/certificate`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "X-CM-ID": isProduction ? "abdm" : "sbx",
      "REQUEST-ID": crypto.randomUUID(),
      "TIMESTAMP": new Date().toISOString(),
      "Accept": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `fetchAbdmPublicKey failed (${res.status} ${res.statusText}): ${body.slice(0, 200)}`,
    );
  }

  const data = await res.json() as Record<string, unknown>;

  // NHA may return the key under different field names depending on API version
  const pem =
    (data.publicKey as string) ??
    (data.cert as string) ??
    (data.certificate as string) ??
    null;

  if (!pem) {
    throw new Error(
      `ABDM public key not found in certificate response. Keys received: ${
        Object.keys(data).join(", ")
      }`,
    );
  }

  return pem;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Decode a PEM-encoded SubjectPublicKeyInfo block to an `ArrayBuffer`
 * suitable for `crypto.subtle.importKey("spki", ...)`.
 */
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/-----BEGIN RSA PUBLIC KEY-----/g, "")
    .replace(/-----END RSA PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");

  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buf[i] = binary.charCodeAt(i);
  }
  return buf.buffer;
}

/**
 * Encode an `ArrayBuffer` as base64url (URL-safe, no `=` padding).
 * This is the encoding NHA expects for encrypted payloads.
 */
function bufferToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Encrypt a UTF-8 string using the ABDM gateway's RSA-OAEP public key.
 *
 * Typical use:
 * ```ts
 * const pubKey = await fetchAbdmPublicKey(baseUrl, token);
 * const encryptedAadhaar = await encryptWithAbdmKey("123456789012", pubKey);
 * // encryptedAadhaar is a base64url string — send it in the API body
 * ```
 *
 * @param data - Plaintext to encrypt, e.g. a 12-digit Aadhaar number.
 * @param publicKeyPem - PEM string returned by {@link fetchAbdmPublicKey}.
 * @returns base64url-encoded RSA-OAEP ciphertext.
 *
 * NHA docs ref: Section 6.1 — RSA/ECB/OAEPWithSHA-256AndMGF1Padding
 */
export async function encryptWithAbdmKey(
  data: string,
  publicKeyPem: string,
): Promise<string> {
  let keyBuffer: ArrayBuffer;
  try {
    keyBuffer = pemToArrayBuffer(publicKeyPem);
  } catch (e) {
    throw new Error(`encryptWithAbdmKey: invalid PEM key — ${e}`);
  }

  const cryptoKey = await crypto.subtle.importKey(
    "spki",
    keyBuffer,
    { name: "RSA-OAEP", hash: { name: "SHA-256" } },
    false,       // not extractable
    ["encrypt"],
  );

  const plaintext = new TextEncoder().encode(data);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    cryptoKey,
    plaintext,
  );

  return bufferToBase64Url(ciphertext);
}

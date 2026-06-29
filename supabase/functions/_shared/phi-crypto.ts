/**
 * _shared/phi-crypto.ts — PHI Field-Level Encryption for Aumrti HMS
 *
 * Provides AES-256-GCM encryption/decryption and HMAC-SHA256 search hashing
 * for Protected Health Information (PHI) columns.
 *
 * DESIGN PRINCIPLES:
 *  • Hospital-scoped DEKs — each hospital's data is encrypted under a unique key.
 *  • Keys are fetched from the `phi_encryption_keys` table via service-role client.
 *  • The master KEK (Key Encryption Key) lives ONLY in Supabase Vault secrets
 *    (env var: PHI_MASTER_KEY). This module wraps/unwraps DEKs using the KEK.
 *  • DEK is cached in a module-level Map for the duration of the Edge Function
 *    invocation only — never persisted to disk or logs.
 *  • The `hashPHI()` function produces a deterministic HMAC-SHA256 digest used
 *    as a search index alongside the encrypted column. The HMAC key is derived
 *    from the DEK — NOT the same key as encryption — so a search hash cannot
 *    be used to decrypt the value.
 *
 * USAGE in Edge Functions:
 *   import { encryptPHI, decryptPHI, hashPHI } from "../_shared/phi-crypto.ts";
 *
 *   const enc = await encryptPHI("9876543210", hospitalId);
 *   const hash = await hashPHI("9876543210", hospitalId);
 *   // Store enc in phone_enc, hash in phone_hash
 *
 *   const plain = await decryptPHI(enc, hospitalId);   // "9876543210"
 *
 * DPDP Act 2023 §8(4) compliance. CERT-In Health Sector Guidelines — AES-256.
 *
 * @module phi-crypto
 */

// @ts-nocheck — Deno types; ts-nocheck keeps IDE quiet in a Node-typed project

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Types ──────────────────────────────────────────────────────────────────

interface DEKCacheEntry {
  /** Raw 32-byte AES-256 key material */
  keyBytes: Uint8Array;
  /** CryptoKey for AES-GCM encrypt/decrypt */
  aesKey: CryptoKey;
  /** CryptoKey for HMAC-SHA256 search hashing */
  hmacKey: CryptoKey;
  /** Key version, for ciphertext header */
  version: number;
}

// ── Module-level DEK cache (lives only for the Edge Function invocation) ───
const dekCache = new Map<string, DEKCacheEntry>();

// ── Supabase service-role client ───────────────────────────────────────────
function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("phi-crypto: SUPABASE_URL / SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Master KEK: fetched from Supabase Vault secret PHI_MASTER_KEY ──────────
// Format: hex-encoded 32 bytes (64 hex chars)
async function getMasterKey(): Promise<CryptoKey> {
  const hex = Deno.env.get("PHI_MASTER_KEY");
  if (!hex || hex.length !== 64) {
    throw new Error(
      "phi-crypto: PHI_MASTER_KEY secret is missing or not 64 hex chars. " +
      "Set it with: supabase secrets set PHI_MASTER_KEY=$(openssl rand -hex 32)"
    );
  }
  const raw = hexToBytes(hex);
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ── Fetch and unwrap DEK for a hospital ───────────────────────────────────
async function loadDEK(hospitalId: string): Promise<DEKCacheEntry> {
  if (dekCache.has(hospitalId)) return dekCache.get(hospitalId)!;

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("phi_encryption_keys")
    .select("encrypted_dek, key_version")
    .eq("hospital_id", hospitalId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw new Error(`phi-crypto: DEK fetch failed — ${error.message}`);

  if (!data) {
    // No DEK yet — generate and store a new one
    return await generateAndStoreDEK(hospitalId);
  }

  // Unwrap the DEK using the master KEK
  const masterKey = await getMasterKey();
  const encryptedDekBytes = base64ToBytes(data.encrypted_dek);
  // Format: iv[12] || ciphertext[32] || authTag[16] = 60 bytes total
  const iv = encryptedDekBytes.slice(0, 12);
  const dekCiphertext = encryptedDekBytes.slice(12);

  const dekRaw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    masterKey,
    dekCiphertext,
  );

  const keyBytes = new Uint8Array(dekRaw);

  const [aesKey, hmacKey] = await Promise.all([
    crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]),
    // Derive a separate HMAC key from the DEK bytes + a domain separator
    deriveHmacKey(keyBytes),
  ]);

  const entry: DEKCacheEntry = { keyBytes, aesKey, hmacKey, version: data.key_version };
  dekCache.set(hospitalId, entry);
  return entry;
}

// ── Generate a brand-new DEK for a hospital ────────────────────────────────
async function generateAndStoreDEK(hospitalId: string): Promise<DEKCacheEntry> {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32)); // 256-bit DEK
  const masterKey = await getMasterKey();

  // Wrap the DEK under the KEK
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedDek = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    masterKey,
    keyBytes,
  );

  // Store: iv || ciphertext as base64
  const combined = new Uint8Array(12 + wrappedDek.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(wrappedDek), 12);
  const encryptedDek = bytesToBase64(combined);

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("phi_encryption_keys")
    .insert({
      hospital_id: hospitalId,
      encrypted_dek: encryptedDek,
      key_version: 1,
      is_active: true,
    })
    .select("key_version")
    .maybeSingle();

  if (error) throw new Error(`phi-crypto: DEK storage failed — ${error.message}`);

  const [aesKey, hmacKey] = await Promise.all([
    crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]),
    deriveHmacKey(keyBytes),
  ]);

  const entry: DEKCacheEntry = { keyBytes, aesKey, hmacKey, version: data?.key_version ?? 1 };
  dekCache.set(hospitalId, entry);
  return entry;
}

// ── Derive a separate HMAC key from the DEK (domain separation) ───────────
async function deriveHmacKey(dekBytes: Uint8Array): Promise<CryptoKey> {
  // HKDF to derive a 256-bit HMAC key with a different domain label
  const baseKey = await crypto.subtle.importKey("raw", dekBytes, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("aumrti-phi-hmac-v1"),
      info: new TextEncoder().encode("search-hash"),
    },
    baseKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Encrypt a PHI plaintext string using the hospital's active DEK (AES-256-GCM).
 *
 * @param plaintext - The PHI value to encrypt (e.g. phone number, full name).
 * @param hospitalId - Hospital UUID — selects the correct DEK.
 * @returns base64-encoded ciphertext in the format:
 *          `v{version}:{base64(iv[12] || ciphertext || authTag[16])}`
 *
 * Example: `v1:aGVsbG8gd29ybGQ...`
 */
export async function encryptPHI(plaintext: string, hospitalId: string): Promise<string> {
  if (!plaintext) return "";
  const dek = await loadDEK(hospitalId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    dek.aesKey,
    encoded,
  );

  const combined = new Uint8Array(12 + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), 12);

  return `v${dek.version}:${bytesToBase64(combined)}`;
}

/**
 * Decrypt a PHI ciphertext string produced by `encryptPHI()`.
 *
 * Supports multi-version decryption: if `encrypted_dek` row for the version
 * is still in the DB (within 90-day retention window after rotation), it will
 * be loaded and used.
 *
 * @param ciphertext - Value previously returned by `encryptPHI()`.
 * @param hospitalId - Hospital UUID.
 * @returns Plaintext PHI string.
 */
export async function decryptPHI(ciphertext: string, hospitalId: string): Promise<string> {
  if (!ciphertext) return "";

  // Parse version prefix
  const colonIdx = ciphertext.indexOf(":");
  if (colonIdx === -1) throw new Error("phi-crypto: invalid ciphertext format (no version prefix)");

  const versionStr = ciphertext.slice(1, colonIdx); // strip leading 'v'
  const version = parseInt(versionStr, 10);
  const b64Payload = ciphertext.slice(colonIdx + 1);

  // Load DEK — if the version doesn't match the active key, load by version
  let dek = await loadDEK(hospitalId);

  if (dek.version !== version) {
    dek = await loadDEKByVersion(hospitalId, version);
  }

  const combined = base64ToBytes(b64Payload);
  const iv = combined.slice(0, 12);
  const ciphertextBytes = combined.slice(12);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    dek.aesKey,
    ciphertextBytes,
  );

  return new TextDecoder().decode(plaintext);
}

/**
 * Compute a deterministic HMAC-SHA256 hash of a PHI value.
 * Used as a searchable index alongside the encrypted column.
 *
 * The HMAC key is derived from the DEK via HKDF with a domain separator,
 * so the hash CANNOT be used to decrypt the value.
 *
 * @param plaintext - The PHI value to hash (normalised before hashing).
 * @param hospitalId - Hospital UUID.
 * @returns hex-encoded HMAC digest (64 chars).
 */
export async function hashPHI(plaintext: string, hospitalId: string): Promise<string> {
  if (!plaintext) return "";
  // Normalise: trim whitespace, lowercase for phone/Aadhaar consistency
  const normalised = plaintext.trim().toLowerCase().replace(/[\s\-]/g, "");
  const dek = await loadDEK(hospitalId);
  const data = new TextEncoder().encode(normalised);
  const sig = await crypto.subtle.sign("HMAC", dek.hmacKey, data);
  return bytesToHex(new Uint8Array(sig));
}

// ── Internal: load DEK by specific version (for rotation / old ciphertext) ─
async function loadDEKByVersion(hospitalId: string, version: number): Promise<DEKCacheEntry> {
  const cacheKey = `${hospitalId}:v${version}`;
  if (dekCache.has(cacheKey)) return dekCache.get(cacheKey)!;

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("phi_encryption_keys")
    .select("encrypted_dek, key_version")
    .eq("hospital_id", hospitalId)
    .eq("key_version", version)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`phi-crypto: DEK v${version} not found for hospital ${hospitalId}`);
  }

  const masterKey = await getMasterKey();
  const encryptedDekBytes = base64ToBytes(data.encrypted_dek);
  const iv = encryptedDekBytes.slice(0, 12);
  const dekCiphertext = encryptedDekBytes.slice(12);

  const dekRaw = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, masterKey, dekCiphertext);
  const keyBytes = new Uint8Array(dekRaw);

  const [aesKey, hmacKey] = await Promise.all([
    crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]),
    deriveHmacKey(keyBytes),
  ]);

  const entry: DEKCacheEntry = { keyBytes, aesKey, hmacKey, version };
  dekCache.set(cacheKey, entry);
  return entry;
}

// ── Binary ↔ string helpers ────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

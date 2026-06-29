/**
 * abdm-fhir-package
 *
 * Retrieves (or builds) a FHIR bundle for a care context, then optionally
 * encrypts it using ABDM's ECDH-X25519 + AES-256-GCM scheme.
 *
 * Without key_material → returns { bundle: FHIRBundle }  (used by debug/preview)
 * With key_material    → returns encrypted ABDM health-data entry
 *
 * Encryption algorithm (NHA ABDM spec 2024):
 *   1. Generate ephemeral X25519 key pair
 *   2. ECDH with gateway's dhPublicKey → raw shared secret
 *   3. XOR our 32-byte nonce with gateway's 32-byte nonce → xnonce
 *   4. HKDF-SHA256(secret, salt=xnonce, info="", length=32) → AES key
 *   5. AES-256-GCM encrypt(plaintext, key, iv=ourNonce[0:12]) → ciphertext
 *   6. Return base64(iv ∥ ciphertext) + our public key + our nonce
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Crypto helpers ────────────────────────────────────────────────────────────

function b64ToBytes(b64: string): Uint8Array {
  // Accept both standard and URL-safe base64, with or without padding
  const std = b64.replace(/-/g, "+").replace(/_/g, "/");
  const padded = std + "=".repeat((4 - (std.length % 4)) % 4);
  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const len = Math.min(a.length, b.length);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = a[i] ^ b[i];
  return out;
}

async function sha256Hex(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Encrypt plaintext with ABDM ECDH-X25519 + AES-256-GCM.
 * Returns the full ABDM-compliant encrypted entry.
 */
async function encryptFhirBundle(
  plaintext: string,
  gatewayDhPublicKeyB64: string,
  gatewayNonceB64: string,
): Promise<{
  content: string;
  media: string;
  checksum: string;
  keyMaterial: {
    cryptoAlg: string;
    curve: string;
    dhPublicKey: { expiry: string; parameters: string; keyValue: string };
    nonce: string;
  };
}> {
  // ── 1. Generate ephemeral X25519 key pair ──────────────────────────────────
  const ourKeyPair = await crypto.subtle.generateKey(
    { name: "X25519" } as AlgorithmIdentifier,
    true,
    ["deriveBits"],
  );

  // ── 2. Import gateway's public key ─────────────────────────────────────────
  const gatewayPubKeyBytes = b64ToBytes(gatewayDhPublicKeyB64);
  const gatewayPublicKey = await crypto.subtle.importKey(
    "raw",
    gatewayPubKeyBytes,
    { name: "X25519" } as AlgorithmIdentifier,
    false,
    [],
  );

  // ── 3. ECDH → raw shared secret (32 bytes for X25519) ─────────────────────
  const sharedBits = await crypto.subtle.deriveBits(
    { name: "X25519", public: gatewayPublicKey } as AlgorithmIdentifier,
    ourKeyPair.privateKey,
    256,
  );

  // ── 4. Generate our nonce (32 random bytes) ────────────────────────────────
  const ourNonce = crypto.getRandomValues(new Uint8Array(32));
  const gatewayNonce = b64ToBytes(gatewayNonceB64).slice(0, 32);
  // Pad to 32 bytes if gateway nonce is shorter
  const gatewayNonce32 = new Uint8Array(32);
  gatewayNonce32.set(gatewayNonce);

  // ── 5. XOR nonces → HKDF salt ─────────────────────────────────────────────
  const xnonce = xorBytes(ourNonce, gatewayNonce32);

  // ── 6. HKDF-SHA256 to derive AES-256 key ──────────────────────────────────
  const hkdfKeyMaterial = await crypto.subtle.importKey(
    "raw",
    sharedBits,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const aesKeyBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: xnonce,
      info: new Uint8Array(0),
    } as HkdfParams,
    hkdfKeyMaterial,
    256,
  );
  const aesKey = await crypto.subtle.importKey(
    "raw",
    aesKeyBits,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );

  // ── 7. AES-256-GCM encrypt ────────────────────────────────────────────────
  // IV = first 12 bytes of our nonce (standard GCM IV size)
  const iv = ourNonce.slice(0, 12);
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    aesKey,
    plaintextBytes,
  );

  // Prepend IV to ciphertext so the HIU can decrypt without out-of-band IV
  const ivAndCipher = new Uint8Array(iv.length + ciphertext.byteLength);
  ivAndCipher.set(iv, 0);
  ivAndCipher.set(new Uint8Array(ciphertext), iv.length);

  // ── 8. Export our public key ───────────────────────────────────────────────
  const ourPublicKeyRaw = await crypto.subtle.exportKey("raw", ourKeyPair.publicKey);

  // ── 9. Checksum of plaintext ───────────────────────────────────────────────
  const checksum = await sha256Hex(plaintext);

  return {
    content: bytesToB64(ivAndCipher),
    media: "application/fhir+json",
    checksum,
    keyMaterial: {
      cryptoAlg: "ECDH",
      curve: "Curve25519",
      dhPublicKey: {
        expiry: new Date(Date.now() + 3_600_000).toISOString(),
        parameters: "Curve25519/32byte random key",
        keyValue: bytesToB64(new Uint8Array(ourPublicKeyRaw)),
      },
      nonce: bytesToB64(ourNonce),
    },
  };
}

// ─── Bundle action mapper ──────────────────────────────────────────────────────

function actionFromCareContext(reference: string, contextType: string): string {
  if (reference.startsWith("OPD-")) return "opd_consultation";
  if (reference.startsWith("IPD-")) return "discharge_summary";
  if (reference.startsWith("LAB-")) return "lab_report";
  if (reference.startsWith("RAD-")) return "radiology_report";
  // Fallback by context_type
  if (contextType === "OPDRecord") return "opd_consultation";
  if (contextType === "DischargeSummaryRecord") return "discharge_summary";
  if (contextType === "DiagnosticReportRecord") return "lab_report";
  return "opd_consultation";
}

function sourceIdFromReference(reference: string): string {
  // e.g. "LAB-{uuid}" → "{uuid}"
  const dash = reference.indexOf("-");
  return dash >= 0 ? reference.slice(dash + 1) : reference;
}

// ─── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json() as {
      // Identify the care context — at least one of these groups required:
      care_context_id?: string;          // UUID of abdm_care_contexts row
      care_context_reference?: string;   // e.g. "LAB-{uuid}"
      // Direct build (bypass care-context lookup):
      hospital_id?: string;
      context_type?: string;
      source_id?: string;
      // Optional encryption
      key_material?: {
        dhPublicKey: { keyValue: string };
        nonce: string;
      };
    };

    // ── Resolve care context ───────────────────────────────────────────────
    let ccRow: Record<string, unknown> | null = null;

    if (body.care_context_id) {
      const { data } = await sb
        .from("abdm_care_contexts")
        .select("id, reference, context_type, source_id, hospital_id, fhir_bundle")
        .eq("id", body.care_context_id)
        .maybeSingle();
      ccRow = data as Record<string, unknown> | null;
    } else if (body.care_context_reference && body.hospital_id) {
      const { data } = await sb
        .from("abdm_care_contexts")
        .select("id, reference, context_type, source_id, hospital_id, fhir_bundle")
        .eq("reference", body.care_context_reference)
        .eq("hospital_id", body.hospital_id)
        .maybeSingle();
      ccRow = data as Record<string, unknown> | null;
    }

    // Determine the parameters we need to build the FHIR bundle
    const hospitalId = (ccRow?.hospital_id ?? body.hospital_id) as string | null;
    const reference = (ccRow?.reference ?? body.care_context_reference) as string | null;
    const contextType = (ccRow?.context_type ?? body.context_type) as string | null;
    const sourceId = (ccRow?.source_id ?? (reference ? sourceIdFromReference(reference) : body.source_id)) as string | null;

    if (!hospitalId || !sourceId) {
      return json({ error: "Cannot resolve hospital_id or source_id. Provide care_context_id, or (care_context_reference + hospital_id), or (hospital_id + source_id + context_type)." }, 400);
    }

    // ── Get or build FHIR bundle ──────────────────────────────────────────
    let bundle: Record<string, unknown>;

    if (ccRow?.fhir_bundle) {
      // Cache hit
      bundle = ccRow.fhir_bundle as Record<string, unknown>;
    } else {
      // Build fresh
      const action = actionFromCareContext(reference ?? "", contextType ?? "");
      const { data: exportResult, error: exportErr } = await sb.functions.invoke("fhir-export", {
        body: {
          action,
          source_id: sourceId,
          hospital_id: hospitalId,
          care_context_reference: reference ?? undefined,
        },
      });

      if (exportErr) throw new Error(`fhir-export failed: ${exportErr.message}`);
      bundle = (exportResult as Record<string, unknown>)?.bundle as Record<string, unknown>;
      if (!bundle) throw new Error("fhir-export returned no bundle");
    }

    // ── Return encrypted or plain ─────────────────────────────────────────
    if (body.key_material?.dhPublicKey?.keyValue && body.key_material?.nonce) {
      const plaintext = JSON.stringify(bundle);
      const encrypted = await encryptFhirBundle(
        plaintext,
        body.key_material.dhPublicKey.keyValue,
        body.key_material.nonce,
      );
      return json(encrypted);
    }

    // No key_material → return plain bundle (for debug view / HIP callback preview)
    return json({ bundle });
  } catch (err) {
    console.error("abdm-fhir-package error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

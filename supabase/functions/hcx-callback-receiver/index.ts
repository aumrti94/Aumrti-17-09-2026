/**
 * hcx-callback-receiver
 *
 * Registered with the NHA/NHCX gateway as the callback URL for:
 *  - CoverageEligibilityResponse (pre-auth decisions)
 *  - ClaimResponse              (claim approval / rejection)
 *
 * NHA sends a JWE-encrypted FHIR Bundle as the POST body.
 * We decrypt, parse the FHIR response, and update insurance_claims /
 * insurance_pre_auth accordingly, then fire a real-time alert.
 *
 * Register this URL at: Settings → Insurance → HCX Configuration
 * Callback URL = https://<project-ref>.supabase.co/functions/v1/hcx-callback-receiver
 *
 * HCX spec: https://docs.swasth.app/hcx-specifications
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// ── base64url decode ──────────────────────────────────────────────────────────
function b64uDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    str.length + ((4 - (str.length % 4)) % 4),
    "="
  );
  const binary = atob(b64);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

// ── JWE decryption (RSA-OAEP-256 + A256GCM) ──────────────────────────────────
async function decryptJwe(
  jweCompact: string,
  privateKeyJwk: JsonWebKey,
): Promise<Record<string, unknown> | null> {
  try {
    const parts = jweCompact.split(".");
    if (parts.length !== 5) return null;

    const [encodedHeader, encryptedKey, iv, ciphertext, tag] = parts;

    const privKey = await crypto.subtle.importKey(
      "jwk",
      privateKeyJwk,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["decrypt"],
    );

    const cek = await crypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      privKey,
      b64uDecode(encryptedKey),
    );

    const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["decrypt"]);

    const cipherBytes = b64uDecode(ciphertext);
    const tagBytes    = b64uDecode(tag);
    const combined    = new Uint8Array(cipherBytes.length + tagBytes.length);
    combined.set(cipherBytes);
    combined.set(tagBytes, cipherBytes.length);

    const plaintext = await crypto.subtle.decrypt(
      {
        name:           "AES-GCM",
        iv:             b64uDecode(iv),
        additionalData: new TextEncoder().encode(encodedHeader),
        tagLength:      128,
      },
      aesKey,
      combined,
    );

    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return null;
  }
}

// ── FHIR response parsers ──────────────────────────────────────────────────────

interface ClaimResponseParsed {
  hcxClaimId:      string;
  use:             string;   // "predetermination" | "claim"
  outcome:         string;   // "queued" | "complete" | "error" | "partial"
  disposition:     string;
  approvedAmount:  number;
  patientPayable?: number;
  items:           Array<{ sequence: number; adjudication: Array<{ category: string; amount: number }> }>;
  errors:          string[];
}

function parseClaimResponse(bundle: Record<string, unknown>): ClaimResponseParsed | null {
  try {
    const entries = (bundle.entry as any[]) ?? [];
    const cr = entries.find((e: any) => e.resource?.resourceType === "ClaimResponse")?.resource;
    if (!cr) return null;

    const hcxClaimId    = (cr.identifier as any[])?.[0]?.value ?? cr.id ?? "";
    const use           = cr.use ?? "claim";
    const outcome       = cr.outcome ?? "queued";
    const disposition   = cr.disposition ?? "";

    let approvedAmount = 0;
    let patientPayable: number | undefined;

    // Total adjudication
    for (const total of (cr.total as any[]) ?? []) {
      const cat = total.category?.coding?.[0]?.code ?? "";
      if (cat === "benefit" || cat === "eligible") {
        approvedAmount = Number(total.amount?.value) || 0;
      }
      if (cat === "copay" || cat === "deductible" || cat === "memberliability") {
        patientPayable = (patientPayable ?? 0) + (Number(total.amount?.value) || 0);
      }
    }

    const items = ((cr.item as any[]) ?? []).map((item: any) => ({
      sequence: item.itemSequence ?? 0,
      adjudication: ((item.adjudication as any[]) ?? []).map((adj: any) => ({
        category: adj.category?.coding?.[0]?.code ?? "",
        amount:   Number(adj.amount?.value) || 0,
      })),
    }));

    const errors = ((cr.error as any[]) ?? []).map((e: any) =>
      e.code?.coding?.[0]?.display ?? e.code?.text ?? "Unknown error"
    );

    return { hcxClaimId, use, outcome, disposition, approvedAmount, patientPayable, items, errors };
  } catch {
    return null;
  }
}

// ── Map HCX outcome → claim status ────────────────────────────────────────────
function mapOutcomeToStatus(outcome: string, disposition: string): string {
  if (outcome === "complete") {
    if (/approv|grant|accept/i.test(disposition)) return "approved";
    if (/reject|deny|declin/i.test(disposition)) return "rejected";
    return "approved";
  }
  if (outcome === "error") return "rejected";
  if (outcome === "partial") return "partial";
  return "queued";
}

// insurance_pre_auth.hcx_status / insurance_claims.hcx_status are both CHECKed to exactly
// {submitted, acknowledged, processing, approved, rejected, error} — the same 6-value
// HcxStatus union the frontend (HCXClaimsTab.tsx) already renders. mapOutcomeToStatus() above
// can also return "partial" or "queued", neither of which is in that list — writing either
// straight into hcx_status would violate the CHECK constraint on every partially-adjudicated
// or still-processing HCX response. hcx_status is deliberately a narrower "where is this in
// the HCX pipeline" indicator than the broader claimStatus/newStatus values derived from it
// below (which DO have "partially_approved"/"pending_query"/"under_review" states, on columns
// with no CHECK constraint) — so this maps only for the restricted column, without collapsing
// the more specific business status those richer values already carry. Found via Phase 6
// edge-function testing.
function toHcxStatusColumn(hcxStatus: string): string {
  if (hcxStatus === "partial" || hcxStatus === "queued") return "processing";
  return hcxStatus;
}

// ── Main ───────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl        = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase           = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.text();

    // ── 1. Load hospital's HCX private key from settings ────────────────────
    // The hospital stores their RSA private key (JWK format) in hospital_settings
    // or as a Supabase secret (preferred).
    const privateKeyJson = Deno.env.get("HCX_HOSPITAL_PRIVATE_KEY_JWK");
    let fhirBundle: Record<string, unknown> | null = null;

    if (privateKeyJson) {
      try {
        const privateKeyJwk = JSON.parse(privateKeyJson) as JsonWebKey;
        // Body may be raw JWE or JSON wrapper { payload: "<jwe>" }
        const jweCompact = body.startsWith("{")
          ? (JSON.parse(body) as { payload?: string })?.payload ?? body
          : body.trim();
        fhirBundle = await decryptJwe(jweCompact, privateKeyJwk);
      } catch {
        fhirBundle = null;
      }

      // A key IS configured — this deployment expects real encrypted responses. Do NOT fall
      // through to the plain-JSON sandbox path below: it was previously reached whenever
      // decryption merely failed for ANY reason, with no check on why. Concretely, that meant
      // anyone could forge an insurance claim/pre-auth decision by POSTing a plain unencrypted
      // FHIR bundle instead of a real JWE — decryptJwe() itself returns null for anything that
      // isn't even JWE-shaped, so an attacker's plain JSON never needed to defeat the crypto at
      // all, just skip sending it. Once decrypted, that forged bundle was processed exactly like
      // a genuine NHA response: it could mark a real claim approved/rejected at an attacker-
      // chosen amount, or auto-raise a bogus underpayment dispute. Found via Phase 6
      // edge-function testing. With a key configured, a failed decryption is now a hard
      // rejection, not a silent downgrade to trusting the caller's own claims.
      if (!fhirBundle) {
        return json({ error: "Could not decrypt HCX payload" }, 400);
      }
    }

    // Sandbox fallback: ONLY reachable when this deployment has no HCX private key configured
    // at all (no hospital here has completed real HCX crypto setup yet) — never as a fallback
    // for a failed decryption when a key DOES exist, which would defeat the point of having one.
    if (!fhirBundle && body.startsWith("{")) {
      try {
        const parsed = JSON.parse(body);
        fhirBundle = parsed.fhir_bundle ?? parsed.payload_json ?? parsed;
      } catch {
        fhirBundle = null;
      }
    }

    if (!fhirBundle) {
      return json({ error: "Could not decrypt or parse HCX payload" }, 400);
    }

    // ── 2. Parse the FHIR response ───────────────────────────────────────────
    const parsed = parseClaimResponse(fhirBundle);
    if (!parsed) {
      return json({ error: "No ClaimResponse resource found in bundle" }, 422);
    }

    const hcxStatus     = mapOutcomeToStatus(parsed.outcome, parsed.disposition);
    const responseAt    = new Date().toISOString();

    // ── 3. Determine if this is a claim or pre-auth response ─────────────────
    if (parsed.use === "predetermination" || parsed.use === "preauthorization") {
      // Pre-auth response → update insurance_pre_auth
      const { data: preAuth } = await supabase
        .from("insurance_pre_auth")
        .select("id, hospital_id, admission_id")
        .eq("hcx_request_id", parsed.hcxClaimId)
        .maybeSingle();

      if (preAuth) {
        const newStatus = hcxStatus === "approved" ? "approved"
          : hcxStatus === "rejected" ? "rejected"
          : "under_review";

        const { error: preAuthUpdateErr } = await supabase.from("insurance_pre_auth").update({
          hcx_status:          toHcxStatusColumn(hcxStatus),
          hcx_approved_amount: parsed.approvedAmount || null,
          hcx_response_at:     responseAt,
          status:              newStatus,
          approved_amount:     parsed.approvedAmount || null,
          rejection_reason:    parsed.errors.join("; ") || null,
        }).eq("id", preAuth.id);
        if (preAuthUpdateErr) console.error("hcx-callback-receiver: insurance_pre_auth update failed:", preAuthUpdateErr.message);

        // Clinical alert for insurance team
        const { error: preAuthAlertErr } = await supabase.from("clinical_alerts").insert({
          hospital_id:   preAuth.hospital_id,
          alert_type:    "insurance_preauth_decision",
          severity:      newStatus === "rejected" ? "high" : "medium",
          alert_message: `Pre-auth ${newStatus.toUpperCase()} by HCX — ${
            parsed.approvedAmount > 0 ? `₹${parsed.approvedAmount.toLocaleString("en-IN")} approved` : ""
          }${parsed.errors.length ? ` | Reason: ${parsed.errors[0]}` : ""}`,
          patient_id:    null,
        });
        if (preAuthAlertErr) console.error("hcx-callback-receiver: preauth alert insert failed:", preAuthAlertErr.message);

        return json({ success: true, type: "preauth", status: newStatus, preauth_id: preAuth.id });
      }
    } else {
      // Claim response → update insurance_claims
      const { data: claim } = await supabase
        .from("insurance_claims")
        .select("id, hospital_id, admission_id, claimed_amount")
        .eq("hcx_claim_id", parsed.hcxClaimId)
        .maybeSingle();

      if (claim) {
        const claimStatus = hcxStatus === "approved" ? "approved"
          : hcxStatus === "rejected" ? "rejected"
          : hcxStatus === "partial" ? "partially_approved"
          : "pending_query";

        const underpayment = parsed.approvedAmount > 0
          ? Math.max(0, (claim.claimed_amount || 0) - parsed.approvedAmount)
          : 0;

        const { error: claimUpdateErr } = await (supabase as any).from("insurance_claims").update({
          hcx_claim_id:         parsed.hcxClaimId,
          hcx_status:           toHcxStatusColumn(hcxStatus),
          hcx_approved_amount:  parsed.approvedAmount || null,
          hcx_rejection_reason: parsed.errors.join("; ") || null,
          hcx_response_at:      responseAt,
          hcx_response_payload: fhirBundle,
          status:               claimStatus,
          approved_amount:      parsed.approvedAmount || null,
          underpayment_amount:  underpayment,
        }).eq("id", claim.id);
        if (claimUpdateErr) console.error("hcx-callback-receiver: insurance_claims update failed:", claimUpdateErr.message);

        // Auto-create underpayment dispute if significant (> ₹100)
        if (underpayment > 100) {
          const { error: disputeErr } = await (supabase as any).from("tpa_disputes").insert({
            hospital_id:      claim.hospital_id,
            claim_id:         claim.id,
            dispute_amount:   underpayment,
            claimed_amount:   claim.claimed_amount,
            settled_amount:   parsed.approvedAmount,
            dispute_reason:   parsed.errors.join("; ") || "HCX underpayment",
            dispute_category: "underpayment",
            status:           "raised",
            next_followup_at: new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0],
          });
          if (disputeErr) console.error("hcx-callback-receiver: tpa_disputes insert failed:", disputeErr.message);
        }

        // Insurance team alert
        const severity = claimStatus === "rejected" ? "critical"
          : underpayment > 10000 ? "high"
          : "medium";

        const { error: claimAlertErr } = await supabase.from("clinical_alerts").insert({
          hospital_id:   claim.hospital_id,
          alert_type:    "insurance_claim_decision",
          severity,
          alert_message: `Claim ${claimStatus.replace("_", " ").toUpperCase()} — Approved: ₹${
            (parsed.approvedAmount || 0).toLocaleString("en-IN")
          }${underpayment > 0 ? ` | Underpayment: ₹${underpayment.toLocaleString("en-IN")}` : ""}${
            parsed.errors.length ? ` | ${parsed.errors[0]}` : ""
          }`,
          patient_id:    null,
        });
        if (claimAlertErr) console.error("hcx-callback-receiver: claim alert insert failed:", claimAlertErr.message);

        return json({
          success:      true,
          type:         "claim",
          status:       claimStatus,
          claim_id:     claim.id,
          approved:     parsed.approvedAmount,
          underpayment,
          dispute_auto: underpayment > 100,
        });
      }
    }

    // HCX ID not matched — store as unmatched for manual review. This used to insert into
    // clinical_alerts with no hospital_id, a NOT NULL column on that table — the insert has
    // never once succeeded, so "manual review required" alerts for unmatched HCX callbacks
    // were silently dropped from day one (unchecked `.error`, the same defect class found
    // repeatedly this session). Since an unmatched claim ID means the hospital genuinely
    // cannot be determined, clinical_alerts (hospital-scoped by design) is not the right
    // table; webhook_dlq allows a null hospital_id and already carries retry/review semantics.
    const { error: dlqErr } = await supabase.from("webhook_dlq").insert({
      source:        "hcx_callback",
      event_type:    "unmatched_claim_id",
      payload:       fhirBundle as Record<string, unknown>,
      error_message: `Could not match HCX claim ID to any insurance_claims/insurance_pre_auth row: ${parsed.hcxClaimId}`,
    });
    if (dlqErr) console.error("hcx-callback-receiver: unmatched-claim DLQ write failed:", dlqErr.message);

    return json({ success: false, reason: "Claim ID not found", hcx_claim_id: parsed.hcxClaimId }, 200);

  } catch (err) {
    console.error("hcx-callback-receiver error:", err instanceof Error ? err.message : String(err));
    return json({ error: "Internal error" }, 500);
  }
});

/**
 * abdm-abha-create — Multi-step ABHA creation and verification backend.
 *
 * Security hardening (v2):
 *   - UIDAI data protection: Aadhaar number is NEVER logged in abdm_gateway_logs
 *     or stored in any DB table. sanitizeForLog() strips it from all log payloads.
 *   - Rate limiting: max 5 ABHA creation/initiation attempts per patient per hour;
 *     max 3 OTP verification attempts per txn_id.
 *   - Audit logging: ABHA_CREATED / ABHA_LINKED events written to abdm_audit_log.
 *
 * NHA docs ref: ABDM Integration Guide v3 — Section 5 Enrollment APIs
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAbdmToken, abdmHeaders } from "../_shared/abdm-auth.ts";
import { fetchAbdmPublicKey, encryptWithAbdmKey } from "../_shared/abdm-encrypt.ts";
import { checkRateLimit } from "../_shared/abdm-rate-limit.ts";
import { logAuditEvent } from "../_shared/abdm-audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Action =
  | "initiate_aadhaar"
  | "verify_aadhaar_otp"
  | "initiate_mobile"
  | "verify_mobile_otp"
  | "create_address"
  | "verify_existing";

interface RequestBody {
  action: Action;
  hospital_id?: string;
  patient_id?: string;
  aadhaar?: string;   // NEVER logged — sanitizeForLog removes this
  mobile?: string;
  txn_id?: string;
  otp?: string;       // NEVER logged — sanitizeForLog removes this
  abha_address?: string;
  abha_number?: string;
}

// ─── UIDAI data protection ────────────────────────────────────────────────────
// Recursively replaces any key that resembles an Aadhaar or OTP field with
// "***REDACTED***" before any value reaches a log or DB record.
// UIDAI data protection compliance: Aadhaar must not be stored or logged.
const REDACT_KEYS = new Set(["aadhaar", "aadhar", "uid", "uidnumber", "otp"]);

function sanitizeForLog(payload: unknown, depth = 0): unknown {
  if (depth > 8 || payload === null || payload === undefined) return payload;
  if (Array.isArray(payload)) return payload.map((v) => sanitizeForLog(v, depth + 1));
  if (typeof payload === "object") {
    return Object.fromEntries(
      Object.entries(payload as Record<string, unknown>).map(([k, v]) => [
        k,
        REDACT_KEYS.has(k.toLowerCase()) ? "***REDACTED***" : sanitizeForLog(v, depth + 1),
      ]),
    );
  }
  return payload;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const jsonResp = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const rawIp = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip");

  try {
    // ── Auth: require valid Supabase JWT ──────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResp({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

    const anonSb = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await anonSb.auth.getUser();
    if (!user || authErr) {
      return jsonResp({ error: "Unauthorized" }, 401);
    }

    const body: RequestBody = await req.json();
    if (!body.action) return jsonResp({ error: "action is required" }, 400);

    const sb = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ── Resolve hospital from JWT (body.hospital_id only validated, never trusted alone) ─
    const { data: userData, error: userErr } = await sb
      .from("users")
      .select("hospital_id")
      .eq("id", user.id)
      .single();

    if (userErr || !userData) return jsonResp({ error: "User record not found" }, 404);

    const hospitalId = userData.hospital_id as string;

    if (body.hospital_id && body.hospital_id !== hospitalId) {
      return jsonResp({ error: "Forbidden: hospital_id does not match authenticated user" }, 403);
    }

    // ── Load hospital ABDM config ─────────────────────────────────────────────
    const { data: cfgRaw } = await sb
      .from("hospital_abdm_config")
      .select("abdm_base_url, is_production")
      .eq("hospital_id", hospitalId)
      .maybeSingle();

    const cfg = cfgRaw as { abdm_base_url: string; is_production: boolean } | null;
    const abdmBaseUrl = cfg?.abdm_base_url || "https://dev.abdm.gov.in";
    const isProduction = cfg?.is_production ?? false;

    const token = await getAbdmToken(hospitalId, sb);

    // ── Log helper (strips Aadhaar/OTP from all payloads) ────────────────────
    const logGw = (opts: {
      endpoint: string;
      payload: unknown;
      response?: unknown;
      statusCode?: number;
      error?: string;
      requestId?: string;
    }) => {
      // UIDAI data protection compliance: sanitize before any storage
      sb.from("abdm_gateway_logs").insert({
        hospital_id: hospitalId,
        request_id: opts.requestId ?? crypto.randomUUID(),
        direction: "OUTBOUND",
        endpoint: opts.endpoint,
        payload: sanitizeForLog(opts.payload) ?? null,
        response: sanitizeForLog(opts.response) ?? null,
        status_code: opts.statusCode ?? 0,
        error: opts.error ?? null,
      }).then(() => {});
    };

    const callNha = async (
      endpoint: string,
      reqBody: unknown,
      method: "POST" | "GET" | "PATCH" = "POST",
    ): Promise<{ ok: boolean; status: number; data: unknown; requestId: string }> => {
      if (!token) {
        throw new Error(
          "ABDM credentials not configured — add ABDM_CLIENT_ID / ABDM_CLIENT_SECRET in Settings → ABDM.",
        );
      }
      const headers = abdmHeaders(token, isProduction);
      const requestId = headers["REQUEST-ID"];
      const res = await fetch(`${abdmBaseUrl}${endpoint}`, {
        method,
        headers,
        body: method !== "GET" ? JSON.stringify(reqBody) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data, requestId };
    };

    // ── Action dispatch ───────────────────────────────────────────────────────
    switch (body.action) {

      // ── A1: Generate Aadhaar OTP ──────────────────────────────────────────
      case "initiate_aadhaar": {
        if (!body.aadhaar) return jsonResp({ error: "aadhaar is required" }, 400);
        if (!token) {
          return jsonResp({ error: "ABDM credentials not configured", mode: "sandbox_format_only" }, 400);
        }

        // Rate limit: 5 initiation attempts per patient per hour
        if (body.patient_id) {
          const rl = await checkRateLimit(sb, `abha_init:${body.patient_id}`, 5, 60);
          if (!rl.allowed) {
            return jsonResp({
              error: "Too many ABHA creation attempts. Please wait before retrying.",
              retryAfterSeconds: rl.retryAfterSeconds,
            }, 429);
          }
        }

        const pubKey = await fetchAbdmPublicKey(abdmBaseUrl, token, isProduction);
        const encAadhaar = await encryptWithAbdmKey(body.aadhaar, pubKey);

        // UIDAI compliance: Aadhaar is encrypted at rest; only encrypted form sent to NHA
        const { ok, status, data, requestId } = await callNha(
          "/v3/enrollment/enrolByAadhaar",
          { aadhaar: encAadhaar },
        );

        // UIDAI data protection: log "[ENCRYPTED]" placeholder — never the raw Aadhaar
        logGw({
          endpoint: "/v3/enrollment/enrolByAadhaar",
          payload: { aadhaar: "[ENCRYPTED]" },
          response: sanitizeForLog(data),
          statusCode: status,
          error: ok ? undefined : String((data as Record<string, unknown>)?.message ?? "Enrollment failed"),
          requestId,
        });

        if (!ok) {
          return jsonResp({
            error: (data as Record<string, unknown>)?.message ?? "Aadhaar enrollment failed",
            details: sanitizeForLog(data),
          }, status < 500 ? status : 502);
        }

        const d = data as Record<string, unknown>;
        return jsonResp({ txnId: d.txnId, message: d.message });
      }

      // ── A2: Verify Aadhaar OTP ────────────────────────────────────────────
      case "verify_aadhaar_otp": {
        if (!body.txn_id || !body.otp) {
          return jsonResp({ error: "txn_id and otp are required" }, 400);
        }
        if (!token) return jsonResp({ error: "ABDM credentials not configured" }, 400);

        // Rate limit: 3 OTP attempts per txn_id
        const rl = await checkRateLimit(sb, `otp_verify:${body.txn_id}`, 3, 30);
        if (!rl.allowed) {
          return jsonResp({
            error: "Too many OTP attempts for this transaction. Please restart the enrollment.",
            retryAfterSeconds: rl.retryAfterSeconds,
          }, 429);
        }

        const pubKey = await fetchAbdmPublicKey(abdmBaseUrl, token, isProduction);
        const encOtp = await encryptWithAbdmKey(body.otp, pubKey);

        const { ok, status, data, requestId } = await callNha(
          "/v3/enrollment/validateByAadhaar",
          { txnId: body.txn_id, otp: encOtp, mobile: body.mobile ?? undefined },
        );

        // UIDAI data protection: OTP is never logged
        logGw({
          endpoint: "/v3/enrollment/validateByAadhaar",
          payload: { txnId: body.txn_id, otp: "[ENCRYPTED]", mobile: body.mobile ? "provided" : "omitted" },
          response: sanitizeForLog(data),
          statusCode: status,
          error: ok ? undefined : String((data as Record<string, unknown>)?.message ?? "OTP validation failed"),
          requestId,
        });

        if (!ok) {
          return jsonResp({
            error: (data as Record<string, unknown>)?.message ?? "Aadhaar OTP validation failed",
            details: sanitizeForLog(data),
          }, status < 500 ? status : 502);
        }

        const d = data as Record<string, unknown>;
        return jsonResp({
          txnId: d.txnId,
          healthIdNumber: d.healthIdNumber,
          name: d.name,
          preVerified: d.preVerified,
        });
      }

      // ── B1: Initiate Mobile OTP ───────────────────────────────────────────
      case "initiate_mobile": {
        if (!body.mobile) return jsonResp({ error: "mobile is required" }, 400);
        if (!token) return jsonResp({ error: "ABDM credentials not configured" }, 400);

        // Rate limit: 5 initiation attempts per patient per hour
        if (body.patient_id) {
          const rl = await checkRateLimit(sb, `abha_init:${body.patient_id}`, 5, 60);
          if (!rl.allowed) {
            return jsonResp({
              error: "Too many ABHA creation attempts. Please wait before retrying.",
              retryAfterSeconds: rl.retryAfterSeconds,
            }, 429);
          }
        }

        const maskedMobile = `${body.mobile.slice(0, 2)}****${body.mobile.slice(-2)}`;

        const { ok, status, data, requestId } = await callNha(
          "/v3/enrollment/enrolByMobile",
          { mobile: body.mobile },
        );

        logGw({
          endpoint: "/v3/enrollment/enrolByMobile",
          payload: { mobile: maskedMobile },
          response: data,
          statusCode: status,
          error: ok ? undefined : String((data as Record<string, unknown>)?.message ?? "Mobile enrollment failed"),
          requestId,
        });

        if (!ok) {
          return jsonResp({
            error: (data as Record<string, unknown>)?.message ?? "Mobile enrollment failed",
            details: data,
          }, status < 500 ? status : 502);
        }

        return jsonResp({ txnId: (data as Record<string, unknown>).txnId });
      }

      // ── B2: Verify Mobile OTP ─────────────────────────────────────────────
      case "verify_mobile_otp": {
        if (!body.txn_id || !body.otp) {
          return jsonResp({ error: "txn_id and otp are required" }, 400);
        }
        if (!token) return jsonResp({ error: "ABDM credentials not configured" }, 400);

        // Rate limit: 3 OTP attempts per txn_id
        const rl = await checkRateLimit(sb, `otp_verify:${body.txn_id}`, 3, 30);
        if (!rl.allowed) {
          return jsonResp({
            error: "Too many OTP attempts for this transaction. Please restart the enrollment.",
            retryAfterSeconds: rl.retryAfterSeconds,
          }, 429);
        }

        // NHA V3 mobile OTP sent as plaintext per spec (unlike Aadhaar which requires RSA)
        const { ok, status, data, requestId } = await callNha(
          "/v3/enrollment/validateByMobile",
          { txnId: body.txn_id, otp: body.otp },
        );

        logGw({
          endpoint: "/v3/enrollment/validateByMobile",
          payload: { txnId: body.txn_id, otp: "[REDACTED]" },
          response: data,
          statusCode: status,
          error: ok ? undefined : String((data as Record<string, unknown>)?.message ?? "OTP validation failed"),
          requestId,
        });

        if (!ok) {
          return jsonResp({
            error: (data as Record<string, unknown>)?.message ?? "Mobile OTP validation failed",
            details: data,
          }, status < 500 ? status : 502);
        }

        const d = data as Record<string, unknown>;
        return jsonResp({ txnId: d.txnId, accounts: (d.accounts as unknown[]) ?? [] });
      }

      // ── A3/B3: Create ABHA Address ────────────────────────────────────────
      case "create_address": {
        if (!body.txn_id || !body.abha_address) {
          return jsonResp({ error: "txn_id and abha_address are required" }, 400);
        }
        if (!token) return jsonResp({ error: "ABDM credentials not configured" }, 400);

        const { ok, status, data, requestId } = await callNha(
          "/v3/enrollment/createAbhaAddress",
          { txnId: body.txn_id, abhaAddress: body.abha_address },
        );

        logGw({
          endpoint: "/v3/enrollment/createAbhaAddress",
          payload: { txnId: body.txn_id, abhaAddress: body.abha_address },
          response: sanitizeForLog(data),
          statusCode: status,
          error: ok ? undefined : String((data as Record<string, unknown>)?.message ?? "ABHA creation failed"),
          requestId,
        });

        if (!ok) {
          return jsonResp({
            error: (data as Record<string, unknown>)?.message ?? "ABHA address creation failed",
            details: sanitizeForLog(data),
          }, status < 500 ? status : 502);
        }

        const d = data as Record<string, unknown>;
        const abhaNumber = (d.healthIdNumber ?? d.ABHANumber ?? "") as string;
        const abhaAddress = (d.healthId ?? d.ABHAAddress ?? body.abha_address) as string;

        // ── Persist to DB ─────────────────────────────────────────────────
        if (body.patient_id) {
          try {
            await sb.from("patient_abha_profiles").upsert(
              {
                patient_id: body.patient_id,
                hospital_id: hospitalId,
                abha_number: abhaNumber || null,
                abha_address: abhaAddress || null,
                // UIDAI compliance: abha_profile may contain PII but never Aadhaar
                abha_profile: sanitizeForLog(d) as Record<string, unknown>,
                mobile: body.mobile ?? (d.mobile as string) ?? null,
                linked_by: user.id,
                consent_given: true,
                consent_given_at: new Date().toISOString(),
                is_active: true,
              },
              { onConflict: "hospital_id,abha_number" },
            );

            if (abhaNumber) {
              await sb
                .from("patients")
                .update({ abha_id: abhaNumber })
                .eq("id", body.patient_id)
                .eq("hospital_id", hospitalId);
            }
          } catch (dbErr) {
            console.error("abdm-abha-create: DB upsert failed after create_address:", dbErr);
          }

          // Audit log
          await logAuditEvent(sb, {
            action: "ABHA_CREATED",
            hospital_id: hospitalId,
            patient_id: body.patient_id,
            abha_address: abhaAddress || null,
            performed_by: user.id,
            raw_ip: rawIp,
          });
        }

        return jsonResp({ abhaNumber, abhaAddress, name: d.name, healthId: d.healthId, profile: sanitizeForLog(d) });
      }

      // ── Verify existing ABHA ──────────────────────────────────────────────
      case "verify_existing": {
        const healthId = body.abha_number || body.abha_address;
        if (!healthId) {
          return jsonResp({ error: "abha_number or abha_address is required" }, 400);
        }

        if (!token) {
          const isNum = /^\d{14}$/.test(String(healthId).replace(/-/g, ""));
          const isAddr = /.+@.+/.test(String(healthId));
          const isValidFormat = isNum || isAddr;
          return jsonResp({
            found: isValidFormat ? null : false,
            mode: "sandbox_format_only",
            message: isValidFormat
              ? "Format valid — live lookup requires ABDM credentials"
              : "Invalid ABHA format (expect 14-digit number or user@abdm address)",
          });
        }

        const { ok, status, data, requestId } = await callNha(
          "/v1/search/existsByHealthId",
          { healthId },
        );

        logGw({
          endpoint: "/v1/search/existsByHealthId",
          payload: { healthId },
          response: sanitizeForLog(data),
          statusCode: status,
          requestId,
        });

        if (!ok) {
          return jsonResp({
            found: false,
            error: (data as Record<string, unknown>)?.message ?? "Search failed",
          }, status < 500 ? status : 502);
        }

        const found = (data as Record<string, unknown>)?.status === true;

        if (found && body.patient_id) {
          const isNumFormat = /^\d/.test(String(healthId));
          try {
            if (isNumFormat) {
              await sb.from("patient_abha_profiles").upsert(
                {
                  patient_id: body.patient_id,
                  hospital_id: hospitalId,
                  abha_number: String(healthId),
                  abha_address: null,
                  linked_by: user.id,
                  consent_given: false,
                  is_active: true,
                },
                { onConflict: "hospital_id,abha_number" },
              );
              await sb
                .from("patients")
                .update({ abha_id: String(healthId).replace(/[^0-9]/g, "") })
                .eq("id", body.patient_id)
                .eq("hospital_id", hospitalId);
            } else {
              const { data: existing } = await sb
                .from("patient_abha_profiles")
                .select("id")
                .eq("patient_id", body.patient_id)
                .eq("hospital_id", hospitalId)
                .eq("abha_address", healthId)
                .maybeSingle();
              if (!existing) {
                await sb.from("patient_abha_profiles").insert({
                  patient_id: body.patient_id,
                  hospital_id: hospitalId,
                  abha_address: String(healthId),
                  linked_by: user.id,
                  consent_given: false,
                  is_active: true,
                });
              }
            }
          } catch (dbErr) {
            console.error("abdm-abha-create: DB linkage failed after verify_existing:", dbErr);
          }

          // Audit log
          await logAuditEvent(sb, {
            action: "ABHA_LINKED",
            hospital_id: hospitalId,
            patient_id: body.patient_id,
            abha_address: String(healthId),
            performed_by: user.id,
            raw_ip: rawIp,
          });
        }

        return jsonResp({ found, mode: "live", healthId });
      }

      default:
        return jsonResp({ error: `Unknown action: ${body.action}` }, 400);
    }
  } catch (err) {
    console.error("abdm-abha-create unhandled error:", err);
    return jsonResp(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500,
    );
  }
});

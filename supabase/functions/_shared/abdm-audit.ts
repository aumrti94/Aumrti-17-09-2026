/**
 * _shared/abdm-audit.ts
 *
 * Fire-and-forget audit logger for significant ABDM operations.
 * Writes to abdm_audit_log which is append-only (no delete RLS policy).
 *
 * Hashes raw IPs before storage for privacy compliance.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type SupabaseLike = ReturnType<typeof createClient>;

export type AuditAction =
  | "ABHA_CREATED"
  | "ABHA_LINKED"
  | "ABHA_DELINKED"
  | "CARE_CONTEXT_LINKED"
  | "CONSENT_GRANTED"
  | "CONSENT_REVOKED"
  | "HEALTH_RECORDS_SHARED"
  | "GATEWAY_AUTH_REJECTED";

export interface AuditEvent {
  action: AuditAction;
  hospital_id: string;
  patient_id?: string | null;
  abha_address?: string | null;
  performed_by?: string | null;
  raw_ip?: string | null;
  metadata?: Record<string, unknown>;
}

/** SHA-256 hash of an IP address, base64url-encoded (first 16 chars). */
async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip.split(",")[0].trim()); // handle x-forwarded-for
  const buf = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/[+/=]/g, "").slice(0, 16);
}

/**
 * Log an ABDM audit event.  Never throws — audit failures must not break request flow.
 */
export async function logAuditEvent(
  sb: SupabaseLike,
  event: AuditEvent,
): Promise<void> {
  try {
    const ip_hash = event.raw_ip ? await hashIp(event.raw_ip) : null;

    await (sb as any).from("abdm_audit_log").insert({
      action:       event.action,
      hospital_id:  event.hospital_id,
      patient_id:   event.patient_id  ?? null,
      abha_address: event.abha_address ?? null,
      performed_by: event.performed_by ?? null,
      ip_hash,
      metadata:     event.metadata ?? null,
      timestamp:    new Date().toISOString(),
    });
  } catch (err) {
    console.error("abdm-audit: failed to write audit event", event.action, err);
  }
}

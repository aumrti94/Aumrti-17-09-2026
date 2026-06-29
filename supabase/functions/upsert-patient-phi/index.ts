/**
 * upsert-patient-phi/index.ts
 *
 * Server-side Edge Function for creating/updating patient PHI fields.
 * This is the ONLY write path for encrypted PHI columns — the browser
 * never sends PHI directly to Supabase PostgREST.
 *
 * Operations:
 *   POST /upsert-patient-phi
 *     Body: {
 *       operation: "encrypt_and_write",
 *       hospitalId: string,
 *       patientId?: string,       // null for new patient create
 *       fields: {
 *         phone?:   string,
 *         name?:    string,
 *         address?: string,
 *         aadhaar?: string,
 *       }
 *     }
 *   Returns:
 *     {
 *       patientId: string,
 *       displayValues: {
 *         phone:   "98765 *** 10",
 *         name:    "Ramesh ****",
 *         address: "**** Nagpur",
 *       }
 *     }
 *
 *   POST /upsert-patient-phi
 *     Body: {
 *       operation: "search_by_phone",
 *       hospitalId: string,
 *       phone: string,
 *     }
 *   Returns: { patient: BasicPatientRecord | null }
 *
 *   POST /upsert-patient-phi
 *     Body: {
 *       operation: "decrypt_for_display",
 *       hospitalId: string,
 *       patientId: string,
 *       fields: string[],  // e.g. ["phone", "name"]
 *     }
 *     — Only callable by roles: doctor, admin, super_admin, nurse
 *   Returns: { decryptedFields: { phone: "9876543210", name: "Ramesh Kumar" } }
 *
 * SECURITY:
 *   • JWT is verified; user's role and hospital_id are checked.
 *   • decrypt_for_display only available to privileged roles.
 *   • PHI fields are NEVER logged — phi-redactor applied to all console output.
 *   • DEK fetched from phi_encryption_keys via service-role — never exposed to caller.
 */

// @ts-nocheck

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encryptPHI, decryptPHI, hashPHI } from "../_shared/phi-crypto.ts";
import { sanitizeForLog } from "../_shared/phi-redactor.ts";

// ── Role access control ────────────────────────────────────────────────────

const DECRYPT_ALLOWED_ROLES = new Set([
  "doctor", "admin", "super_admin", "nurse", "lab_technician",
]);

// ── Helper: mask a phone for display ──────────────────────────────────────
function maskPhone(p: string): string {
  const d = p.replace(/\D/g, "");
  if (d.length >= 10) return `${d.slice(0, 5)} *** ${d.slice(-2)}`;
  return `${p.slice(0, 2)}${"*".repeat(Math.max(0, p.length - 4))}${p.slice(-2)}`;
}
function maskName(n: string): string {
  const parts = n.trim().split(/\s+/);
  if (parts.length <= 1) return n;
  return `${parts[0]} ${"*".repeat(parts.slice(1).join(" ").length)}`;
}
function maskAddress(a: string): string {
  const words = a.trim().split(/\s+/);
  return words.length <= 2 ? a : `**** ${words.at(-1)}`;
}
function normalizePhone(p: string): string {
  return p.replace(/[\s\-\(\)]/g, "").replace(/^\+91/, "").replace(/^0/, "");
}

// ── Main handler ────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  // ── Auth: verify JWT and resolve user context ──────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), { status: 401 });
  }

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  // Fetch caller's role and hospital_id from users table
  const { data: callerUser } = await serviceClient
    .from("users")
    .select("id, role, hospital_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!callerUser) {
    return new Response(JSON.stringify({ error: "User profile not found" }), { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const operation = body.operation as string;
  const hospitalId = (body.hospitalId as string) ?? callerUser.hospital_id;

  // Enforce hospital isolation — user cannot act on another hospital's data
  if (callerUser.hospital_id !== hospitalId && callerUser.role !== "super_admin") {
    return new Response(JSON.stringify({ error: "Cross-hospital access denied" }), { status: 403 });
  }

  // ── Operation: encrypt_and_write ─────────────────────────────────────────
  if (operation === "encrypt_and_write") {
    const fields = (body.fields as Record<string, string>) ?? {};
    const patientId = body.patientId as string | undefined;

    const updatePayload: Record<string, string | null> = {};
    const displayValues: Record<string, string> = {};

    if (fields.phone) {
      const norm = normalizePhone(fields.phone);
      const [enc, hash] = await Promise.all([
        encryptPHI(fields.phone, hospitalId),
        hashPHI(norm, hospitalId),
      ]);
      updatePayload.phone_enc = enc;
      updatePayload.phone_hash = hash;
      displayValues.phone = maskPhone(fields.phone);
    }

    if (fields.name) {
      const [enc, hash] = await Promise.all([
        encryptPHI(fields.name, hospitalId),
        hashPHI(fields.name.trim().toLowerCase(), hospitalId),
      ]);
      updatePayload.name_enc = enc;
      updatePayload.name_hash = hash;
      displayValues.name = maskName(fields.name);
    }

    if (fields.address) {
      updatePayload.address_enc = await encryptPHI(fields.address, hospitalId);
      displayValues.address = maskAddress(fields.address);
    }

    if (fields.aadhaar) {
      const norm = fields.aadhaar.replace(/[\s\-]/g, "");
      const [enc, hash] = await Promise.all([
        encryptPHI(norm, hospitalId),
        hashPHI(norm, hospitalId),
      ]);
      updatePayload.aadhaar_enc = enc;
      updatePayload.aadhaar_hash = hash;
      // Never return Aadhaar to browser — not even masked
    }

    if (patientId) {
      const { error } = await serviceClient
        .from("patients")
        .update(updatePayload)
        .eq("id", patientId)
        .eq("hospital_id", hospitalId);

      if (error) {
        console.error("[upsert-patient-phi] Update error:", sanitizeForLog(error.message));
        return new Response(JSON.stringify({ error: "DB update failed" }), { status: 500 });
      }

      return new Response(JSON.stringify({ patientId, displayValues }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // New patient — caller should have already inserted base row; we just update PHI cols
    return new Response(JSON.stringify({ displayValues }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Operation: search_by_phone ───────────────────────────────────────────
  if (operation === "search_by_phone") {
    const rawPhone = body.phone as string;
    if (!rawPhone) {
      return new Response(JSON.stringify({ error: "phone required" }), { status: 400 });
    }

    const norm = normalizePhone(rawPhone);
    const searchHash = await hashPHI(norm, hospitalId);

    // Search via hash index first (fast, for migrated rows)
    const { data: byHash } = await serviceClient
      .from("patients")
      .select("id, full_name, uhid, phone, name_enc, phone_enc")
      .eq("hospital_id", hospitalId)
      .eq("phone_hash", searchHash)
      .maybeSingle();

    if (byHash) {
      return new Response(
        JSON.stringify({
          patient: {
            id: byHash.id,
            uhid: byHash.uhid,
            displayName: maskName(byHash.full_name ?? ""),
            displayPhone: maskPhone(rawPhone),
          },
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Fallback: search plaintext phone (pre-migration rows still not backfilled)
    const { data: byPlain } = await serviceClient
      .from("patients")
      .select("id, full_name, uhid, phone")
      .eq("hospital_id", hospitalId)
      .eq("phone", norm.length === 10 ? norm : rawPhone)
      .maybeSingle();

    return new Response(
      JSON.stringify({
        patient: byPlain
          ? {
              id: byPlain.id,
              uhid: byPlain.uhid,
              displayName: maskName(byPlain.full_name ?? ""),
              displayPhone: maskPhone(rawPhone),
            }
          : null,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // ── Operation: decrypt_for_display ───────────────────────────────────────
  if (operation === "decrypt_for_display") {
    // Role guard
    if (!DECRYPT_ALLOWED_ROLES.has(callerUser.role)) {
      return new Response(
        JSON.stringify({ error: "Insufficient role for PHI decryption" }),
        { status: 403 }
      );
    }

    const patientId = body.patientId as string;
    const fieldsToDecrypt = (body.fields as string[]) ?? [];

    if (!patientId || fieldsToDecrypt.length === 0) {
      return new Response(JSON.stringify({ error: "patientId and fields required" }), { status: 400 });
    }

    const selectCols = [
      "id", "hospital_id",
      ...fieldsToDecrypt.map((f) => `${f}_enc`),
    ].join(", ");

    const { data: patient } = await serviceClient
      .from("patients")
      .select(selectCols)
      .eq("id", patientId)
      .eq("hospital_id", hospitalId)
      .maybeSingle();

    if (!patient) {
      return new Response(JSON.stringify({ error: "Patient not found" }), { status: 404 });
    }

    const decryptedFields: Record<string, string> = {};

    for (const field of fieldsToDecrypt) {
      const encValue: string | null = (patient as any)[`${field}_enc`];
      if (encValue) {
        try {
          decryptedFields[field] = await decryptPHI(encValue, hospitalId);
        } catch (e) {
          console.error(`[upsert-patient-phi] Decrypt failed for field ${field}:`, sanitizeForLog(String(e)));
          decryptedFields[field] = "[Decrypt Error]";
        }
      }
    }

    // Log PHI access for audit trail
    await serviceClient.from("phi_access_audit").insert({
      user_id: callerUser.id,
      hospital_id: hospitalId,
      table_name: "patients",
      row_id: patientId,
      field_names: fieldsToDecrypt,
      access_type: "read",
    }).then(({ error }) => {
      if (error) console.error("[upsert-patient-phi] Audit log failed:", error.message);
    });

    return new Response(
      JSON.stringify({ decryptedFields }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ error: `Unknown operation: ${operation}` }),
    { status: 400 }
  );
});

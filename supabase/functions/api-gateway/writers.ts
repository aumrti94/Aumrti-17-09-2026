/**
 * Write handlers and request-body validation.
 *
 * Reads map cleanly onto tables; writes often do not. Where a resource's creation invariants live
 * in application code rather than in the database, this module owns them so that the API and the
 * app cannot disagree about how a record comes into existence.
 *
 * See docs/api/API_DESIGN_STANDARD.md §6 (idempotency) and §10 (writes).
 */

import { ApiError } from "./errors.ts";
import type { RouteDef } from "./routes.ts";

// ── Body parsing and validation ──────────────────────────────────────────────────────────────

export async function parseBody(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (!raw.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError({
      type: "invalid_request_error",
      code: "invalid_json",
      message: "Request body is not valid JSON.",
    });
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError({
      type: "invalid_request_error",
      code: "invalid_body",
      message: "Request body must be a JSON object.",
    });
  }
  return parsed as Record<string, unknown>;
}

/**
 * Reduce the body to the fields this route permits.
 *
 * Unknown fields are REJECTED, not dropped. Silently ignoring `{"pnone": "..."}` returns 200 with
 * the phone number absent, and the integrator ships it believing it works — the same failure mode
 * as a silently-ignored filter, but writing rather than reading.
 */
export function validateWriteBody(
  body: Record<string, unknown>,
  route: RouteDef,
  isCreate: boolean,
): Record<string, unknown> {
  const spec = route.write!;
  const allowed = new Set(spec.writable);

  for (const field of Object.keys(body)) {
    if (!allowed.has(field)) {
      throw new ApiError({
        type: "invalid_request_error",
        code: "unknown_field",
        message: `Unknown or non-writable field "${field}". Writable: ${[...allowed].sort().join(", ")}.`,
        param: field,
      });
    }
  }

  if (isCreate) {
    for (const field of spec.required ?? []) {
      const value = body[field];
      if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
        throw new ApiError({
          type: "invalid_request_error",
          code: "missing_field",
          message: `"${field}" is required.`,
          param: field,
        });
      }
    }
  } else if (Object.keys(body).length === 0) {
    // An empty PATCH would otherwise report success while changing nothing, which reads to the
    // caller as "the update was applied".
    throw new ApiError({
      type: "invalid_request_error",
      code: "empty_update",
      message: `No writable fields supplied. Writable: ${[...allowed].sort().join(", ")}.`,
    });
  }

  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    clean[k] = typeof v === "string" ? v.trim() : v;
  }
  return clean;
}

// ── Delegated handlers ───────────────────────────────────────────────────────────────────────

/**
 * Register a patient.
 *
 * Mirrors src/lib/patient-records.ts createPatient() rather than inserting directly, because two
 * of the three steps are invisible from the table definition:
 *
 *   1. The UHID comes from the next_seq RPC under the hospital's own configured prefix and date
 *      format. It is atomic; a SELECT MAX + 1 in two concurrent integrations issues the same
 *      identifier to two different people.
 *   2. Phone and name are encrypted into the PHI columns by upsert-patient-phi. Skipping it
 *      leaves the row unencrypted AND absent from the phone_hash index, so the patient becomes
 *      unfindable by phone — the primary lookup at a hospital reception desk.
 */
export async function createPatient(
  sb: any,
  hospitalId: string,
  fields: Record<string, unknown>,
  functionsUrl: string,
  serviceKey: string,
): Promise<Record<string, unknown>> {
  const uhid = await allocateUhid(sb, hospitalId);

  const { data, error } = await sb
    .from("patients")
    .insert({
      hospital_id: hospitalId,
      uhid,
      full_name: String(fields.full_name ?? "").trim(),
      phone: fields.phone ?? null,
      dob: fields.dob ?? null,
      gender: fields.gender ?? null,
      email: fields.email ?? null,
      address: fields.address ?? null,
      blood_group: fields.blood_group ?? null,
    })
    .select("id, uhid, full_name, gender, dob, phone, email, created_at")
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new ApiError({
      type: "api_error", code: "create_failed",
      message: "The patient could not be created. Quote the request id when reporting this.",
    });
  }

  // Fire-and-forget, exactly as the app does: a PHI-encryption outage must not block registration,
  // and the backfill cron (phi-backfill-encrypt) picks up any row it missed.
  const phiFields: Record<string, string> = {};
  if (typeof fields.phone === "string" && fields.phone.trim()) phiFields.phone = fields.phone.trim();
  if (data.full_name) phiFields.name = data.full_name;

  if (Object.keys(phiFields).length) {
    fetch(`${functionsUrl}/upsert-patient-phi`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        operation: "encrypt_and_write",
        hospitalId,
        patientId: data.id,
        fields: phiFields,
      }),
    }).catch(err => {
      // Never log the field values themselves.
      console.error("api-gateway: PHI encryption after create failed (backfill will retry):", err?.message);
    });
  }

  return data;
}

/** Atomic per-hospital, per-day sequence, matching generatePatientUhid() in the app. */
async function allocateUhid(sb: any, hospitalId: string): Promise<string> {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const yyyymmdd = `${yyyy}${mm}${dd}`;

  const [{ data: hospital }, seq] = await Promise.all([
    sb.from("hospitals").select("uhid_prefix, uhid_date_format").eq("id", hospitalId).maybeSingle(),
    sb.rpc("next_seq", { p_hospital_id: hospitalId, p_type: `uhid_${yyyymmdd}` }),
  ]);

  if (seq.error) throw seq.error;

  const prefix = (hospital?.uhid_prefix ?? "").trim() || "UHID";
  const format = hospital?.uhid_date_format || "YYYYMMDD";
  const n = String(seq.data ?? 1).padStart(4, "0");

  if (format === "YYYY") return `${prefix}-${yyyy}-${n}`;
  if (format === "NONE") return `${prefix}-${n}`;
  return `${prefix}-${yyyymmdd}-${n}`;
}

// ── Postgres error translation ───────────────────────────────────────────────────────────────

/**
 * Turn a constraint violation into the status the caller can act on.
 *
 * These are the cases where the database is enforcing an invariant the gateway deliberately does
 * not duplicate — a double-booked slot, a patient id from another hospital, a status outside the
 * permitted set. Surfacing them as 500 would tell the integrator we broke, when in fact they
 * asked for something the hospital's rules forbid.
 */
export function translateWriteError(error: any): ApiError {
  switch (error?.code) {
    case "23505": // unique_violation
      return new ApiError({
        type: "invalid_request_error",
        code: "conflict",
        message: "That record already exists. For an appointment this means the doctor already "
               + "has an active booking at that date and time.",
        status: 409,
      });

    case "23503": // foreign_key_violation
      return new ApiError({
        type: "invalid_request_error",
        code: "related_record_not_found",
        message: "A referenced record does not exist in this hospital. Check patient_id and doctor_id.",
        status: 400,
      });

    case "23514": // check_violation
    case "P0001": // raise_exception — the validate_* triggers use this
      return new ApiError({
        type: "invalid_request_error",
        code: "rejected_by_rule",
        // The trigger messages are written for staff and name the rule, not the patient.
        message: error?.message?.slice(0, 300) || "The request was rejected by a hospital rule.",
        status: 400,
      });

    case "23502": // not_null_violation
      return new ApiError({
        type: "invalid_request_error",
        code: "missing_field",
        message: `A required field is missing: ${error?.column ?? "unknown"}.`,
        status: 400,
      });

    case "22P02":
    case "22007":
      return new ApiError({
        type: "invalid_request_error",
        code: "invalid_value",
        message: "A field value has the wrong type. Dates must be ISO 8601; ids must be UUIDs.",
        status: 400,
      });

    default:
      console.error("api-gateway write error:", error?.code, error?.message);
      return new ApiError({
        type: "api_error",
        code: "write_failed",
        message: "The write could not be completed. Quote the request id when reporting this.",
      });
  }
}

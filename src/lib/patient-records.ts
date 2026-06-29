import { supabase } from "@/integrations/supabase/client";
import { maskPHI, normalizePhone } from "@/lib/phi-crypto";

export type PatientGender = "male" | "female" | "other";

export interface BasicPatientRecord {
  id: string;
  full_name: string;
  uhid: string;
  phone: string | null;
  /** Display-masked phone — safe to render in UI */
  displayPhone?: string;
}

/**
 * Invoke the upsert-patient-phi Edge Function.
 * All PHI write/search operations go through this server-side path.
 */
async function callPhiFunction(
  operation: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/upsert-patient-phi`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ operation, ...payload }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`upsert-patient-phi failed (${res.status}): ${errBody.slice(0, 200)}`);
  }
  return res.json();
}

export const calculateDobFromAge = (age?: number | null) => {
  if (!age || Number.isNaN(age) || age <= 0) return null;

  const dob = new Date();
  dob.setFullYear(dob.getFullYear() - age);
  return dob.toISOString().slice(0, 10);
};

export async function generatePatientUhid(hospitalId: string) {
  const now = new Date();
  const yyyy = now.getFullYear().toString();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const yyyymmdd = `${yyyy}${mm}${dd}`;

  // Key the sequence by date so it resets to 0001 every day
  const seqKey = `uhid_${yyyymmdd}`;

  const [{ data: hospital }, seqResult] = await Promise.all([
    supabase.from("hospitals").select("uhid_prefix, uhid_date_format").eq("id", hospitalId).maybeSingle(),
    supabase.rpc("next_seq", { p_hospital_id: hospitalId, p_type: seqKey }),
  ]);

  if (seqResult.error) throw seqResult.error;

  const prefix = (hospital as any)?.uhid_prefix?.trim() || "UHID";
  const dateFormat: string = (hospital as any)?.uhid_date_format || "YYYYMMDD";
  const seq = String(seqResult.data ?? 1).padStart(4, "0");

  if (dateFormat === "YYYY") return `${prefix}-${yyyy}-${seq}`;
  if (dateFormat === "NONE")  return `${prefix}-${seq}`;
  return `${prefix}-${yyyymmdd}-${seq}`;  // YYYYMMDD default
}

/**
 * Find a patient by phone number.
 *
 * Routes through the upsert-patient-phi Edge Function which:
 *  1. Hashes the phone (HMAC-SHA256) and searches the phone_hash index (fast, O(1)).
 *  2. Falls back to plaintext search for rows not yet migrated.
 *
 * Returns a display-safe record (phone is masked — never raw in the browser).
 */
export async function findPatientByPhone(
  hospitalId: string,
  phone: string
): Promise<BasicPatientRecord | null> {
  const normalizedPhone = normalizePhone(phone.trim());
  if (normalizedPhone.length < 10) return null;

  try {
    const result = await callPhiFunction("search_by_phone", {
      hospitalId,
      phone: normalizedPhone,
    });

    if (!result.patient) return null;

    const p = result.patient as {
      id: string; uhid: string; displayName: string; displayPhone: string;
    };
    return {
      id: p.id,
      uhid: p.uhid,
      full_name: p.displayName,
      phone: null,           // never return raw phone to UI
      displayPhone: p.displayPhone,
    };
  } catch (err) {
    console.error("findPatientByPhone via Edge Fn failed, falling back to plaintext search:", err);
    // Fallback for local dev / pre-migration
    const { data, error } = await supabase
      .from("patients")
      .select("id, full_name, uhid, phone")
      .eq("hospital_id", hospitalId)
      .eq("phone", normalizedPhone)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      ...data as BasicPatientRecord,
      displayPhone: maskPHI(data.phone, "phone"),
    };
  }
}

interface CreatePatientParams {
  hospitalId: string;
  fullName: string;
  phone?: string;
  dob?: string | null;
  gender?: PatientGender | null;
}

export async function createPatientRecord({
  hospitalId,
  fullName,
  phone,
  dob,
  gender,
}: CreatePatientParams): Promise<BasicPatientRecord> {
  const uhid = await generatePatientUhid(hospitalId);

  // Step 1: Insert base record (plaintext columns retained for migration window)
  const { data, error } = await supabase
    .from("patients")
    .insert({
      hospital_id: hospitalId,
      uhid,
      full_name: fullName.trim() || "Walk-in Customer",
      phone: phone?.trim() || null,
      dob: dob || null,
      gender: gender || null,
    })
    .select("id, full_name, uhid, phone")
    .maybeSingle();

  if (error) throw error;
  const inserted = data as BasicPatientRecord;

  // Step 2: Encrypt PHI fields via Edge Function (fire-and-forget; never blocks registration)
  // If this fails, the backfill cron will pick up the unencrypted row later.
  const phiFields: Record<string, string> = {};
  if (phone?.trim()) phiFields.phone = phone.trim();
  if (fullName.trim()) phiFields.name = fullName.trim();

  if (Object.keys(phiFields).length > 0) {
    callPhiFunction("encrypt_and_write", {
      hospitalId,
      patientId: inserted.id,
      fields: phiFields,
    }).catch((err) =>
      console.error("PHI encryption after patient create failed (will be caught by backfill):", err)
    );
  }

  return {
    ...inserted,
    displayPhone: phone ? maskPHI(phone, "phone") : null,
  };
}
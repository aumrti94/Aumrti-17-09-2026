/**
 * src/lib/key-rotation.ts — DEK Key Rotation Utility for Aumrti HMS
 *
 * Admin-only utility for rotating the hospital's Data Encryption Key (DEK).
 * Key rotation is a DPDP Act best-practice and CERT-In recommendation
 * (annual rotation minimum for healthcare data).
 *
 * WHAT ROTATION DOES:
 *  1. Calls the `phi-backfill-encrypt` Edge Function in rotation mode:
 *     - Generates a NEW DEK (v_current + 1) for the hospital.
 *     - Sets the new DEK as active (is_active = TRUE).
 *     - Sets rotated_at on the old DEK + expires_at = now() + 90 days.
 *  2. Re-encrypts all existing ciphertext rows using the new DEK in batches.
 *  3. After 100% re-encryption confirmed, the old DEK stays for 90 days
 *     (so any race-condition reads of old ciphertext still work) then is purged.
 *
 * USAGE (Admin Console only — never expose to non-admin roles):
 *   import { rotateHospitalKey } from "@/lib/key-rotation";
 *   const result = await rotateHospitalKey(hospitalId);
 *   // result.status: "initiated" | "error"
 *
 * WHO CAN CALL THIS:
 *   Only users with role = 'super_admin' or 'admin'.
 *   The Edge Function enforces this — this client utility just provides UX.
 *
 * OPERATIONS LOGGED:
 *   Every rotation attempt is written to phi_access_audit with
 *   access_type = 'key_rotation'.
 */

import { supabase } from "@/integrations/supabase/client";

export interface KeyRotationResult {
  status: "initiated" | "already_in_progress" | "error";
  message: string;
  /** ISO timestamp when rotation was initiated */
  initiatedAt?: string;
  /** New key version number */
  newKeyVersion?: number;
}

/**
 * Initiates DEK rotation for a hospital.
 * The actual re-encryption happens asynchronously in the Edge Function.
 * Monitor progress via `getRotationStatus()`.
 */
export async function rotateHospitalKey(
  hospitalId: string
): Promise<KeyRotationResult> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not authenticated");

  // Verify caller is admin
  const { data: callerUser } = await supabase
    .from("users")
    .select("role")
    .eq("auth_user_id", (await supabase.auth.getUser()).data.user?.id ?? "")
    .maybeSingle();

  if (!callerUser || !["admin", "super_admin"].includes(callerUser.role)) {
    return {
      status: "error",
      message: "Key rotation requires admin or super_admin role.",
    };
  }

  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/phi-backfill-encrypt`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      operation: "rotate_key",   // special mode handled by the backfill function
      hospitalId,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    return {
      status: "error",
      message: `Rotation request failed (${res.status}): ${body.slice(0, 200)}`,
    };
  }

  const result = await res.json() as {
    newKeyVersion?: number;
    initiatedAt?: string;
    alreadyInProgress?: boolean;
  };

  if (result.alreadyInProgress) {
    return {
      status: "already_in_progress",
      message: "A key rotation is already in progress for this hospital. Monitor via phi_backfill_log.",
    };
  }

  return {
    status: "initiated",
    message:
      `Key rotation initiated. New DEK version: v${result.newKeyVersion}. ` +
      "Re-encryption runs in the background. Monitor progress via getRotationStatus().",
    initiatedAt: result.initiatedAt,
    newKeyVersion: result.newKeyVersion,
  };
}

/**
 * Returns the current key rotation / backfill status for a hospital.
 * Reads from phi_backfill_log.
 */
export async function getRotationStatus(hospitalId: string): Promise<{
  isRunning: boolean;
  lastEntry: {
    status: string;
    rowsEncrypted: number;
    rowsFailed: number;
    startedAt: string;
    finishedAt: string | null;
  } | null;
}> {
  const { data } = await supabase
    .from("phi_backfill_log" as any)
    .select("status, rows_encrypted, rows_failed, started_at, finished_at")
    .eq("hospital_id", hospitalId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return { isRunning: false, lastEntry: null };

  const d = data as {
    status: string;
    rows_encrypted: number;
    rows_failed: number;
    started_at: string;
    finished_at: string | null;
  };

  return {
    isRunning: d.status === "running",
    lastEntry: {
      status: d.status,
      rowsEncrypted: d.rows_encrypted,
      rowsFailed: d.rows_failed,
      startedAt: d.started_at,
      finishedAt: d.finished_at,
    },
  };
}

/**
 * Returns the current active DEK version for a hospital.
 * Useful for displaying "Last rotated: DD/MM/YYYY" in the Admin Console.
 *
 * Returns null if no key has been generated yet (pre-encryption state).
 */
export async function getCurrentKeyInfo(hospitalId: string): Promise<{
  version: number;
  createdAt: string;
  rotatedAt: string | null;
} | null> {
  const { data } = await supabase
    .from("phi_encryption_keys" as any)
    .select("key_version, created_at, rotated_at")
    .eq("hospital_id", hospitalId)
    .eq("is_active", true)
    .maybeSingle();

  if (!data) return null;
  const d = data as { key_version: number; created_at: string; rotated_at: string | null };
  return {
    version: d.key_version,
    createdAt: d.created_at,
    rotatedAt: d.rotated_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Client for the delete-hospital edge function.
//
// We call it with raw fetch (NOT supabase.functions.invoke, which buffers the
// whole response) so the phase-2 purge can stream Server-Sent Events and drive a
// real progress bar. Phase-1 soft-delete / restore / grace responses come back
// as plain JSON and resolve immediately.
//
// This ALWAYS surfaces the server's real error text — the thing functions.invoke
// hides behind the useless "Edge Function returned a non-2xx status code".
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "@/integrations/supabase/client";
import { getInvokeError } from "@/lib/errorMessage";

export interface PurgeProgress {
  table: string;
  i: number;
  n: number;
  deleted: number;
  cumulative: number;
}

export interface DeleteHospitalCallbacks {
  onTotal?: (rows: number) => void;
  onPhase?: (label: string, cumulative?: number) => void;
  onProgress?: (p: PurgeProgress) => void;
}

export interface DeleteHospitalResult {
  // Phase 1 (soft-delete) / restore
  soft_deleted?: boolean;
  restored?: boolean;
  message?: string;
  permanent_after?: string;
  // Phase 2 (purge) completion
  done?: boolean;
  hospital_name?: string;
  deleted_auth_users?: number;
  total_staff_accounts?: number;
  cumulative?: number;
  warnings?: string[];
}

const SUPABASE_URL = (import.meta.env as Record<string, string>).VITE_SUPABASE_URL || "";
const ANON_KEY = (import.meta.env as Record<string, string>).VITE_SUPABASE_ANON_KEY || "";

export interface DeletePreflightChecks {
  deployed: boolean;         // the edge function is deployed & reachable
  service_role_key: boolean; // SUPABASE_SERVICE_ROLE_KEY secret is set
  authenticated: boolean;    // caller's JWT resolves to a user
  admin: boolean;            // caller is an active aumrti_admin
}

export interface DeletePreflightResult {
  ok: boolean;
  checks: DeletePreflightChecks;
  error?: string;
}

/**
 * Non-destructive check of the three deploy prerequisites for hospital delete.
 * Distinguishes "function not deployed" (invoke errors → deployed:false) from
 * "missing secret" / "not an admin" (function replies 200 with the failing flag).
 */
export async function checkDeletePrerequisites(hospitalId: string): Promise<DeletePreflightResult> {
  const res = await supabase.functions.invoke("delete-hospital", {
    body: { hospital_id: hospitalId, action: "preflight" },
  });
  if (res.error) {
    // Reaching the function is what proves deployment; an invoke error here
    // (typically 404) means it is not deployed / not reachable.
    const msg = await getInvokeError(res);
    return {
      ok: false,
      checks: { deployed: false, service_role_key: false, authenticated: false, admin: false },
      error: msg || "delete-hospital is not deployed or not reachable",
    };
  }
  const data = res.data as { ok: boolean; checks: DeletePreflightChecks };
  return { ok: data.ok, checks: data.checks };
}

/**
 * Invoke delete-hospital. For a phase-2 purge the returned promise resolves only
 * after the stream completes, invoking the callbacks along the way. Throws an
 * Error carrying the real server message on any failure.
 */
export async function deleteHospitalStream(
  hospitalId: string,
  cb: DeleteHospitalCallbacks = {},
  action?: "restore",
): Promise<DeleteHospitalResult> {
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-hospital`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token || ""}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify({ hospital_id: hospitalId, ...(action ? { action } : {}) }),
  });

  const contentType = res.headers.get("content-type") || "";

  // ── Non-streaming path: phase-1 soft-delete, restore, grace (409), errors ──
  if (!contentType.includes("text/event-stream")) {
    let body: DeleteHospitalResult & { error?: string } = {};
    try { body = await res.json(); } catch { /* empty / non-JSON body */ }
    if (!res.ok || body?.error) {
      throw new Error(body?.error || `Request failed (${res.status})`);
    }
    return body;
  }

  // ── Streaming path: phase-2 purge ──
  if (!res.body) throw new Error("No response stream from delete-hospital");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: DeleteHospitalResult | null = null;
  let streamError: string | null = null;

  const handleFrame = (frame: string) => {
    let eventType = "message";
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) eventType = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) return;
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(dataLines.join("\n")); } catch { return; }

    switch (eventType) {
      case "total":    cb.onTotal?.(Number(payload.rows ?? 0)); break;
      case "phase":    cb.onPhase?.(String(payload.label ?? ""), payload.cumulative as number | undefined); break;
      case "progress": cb.onProgress?.(payload as unknown as PurgeProgress); break;
      case "done":     result = { done: true, ...(payload as DeleteHospitalResult) }; break;
      case "error":    streamError = String(payload.error ?? "Purge failed"); break;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (frame.trim()) handleFrame(frame);
    }
    if (done) break;
  }
  if (buffer.trim()) handleFrame(buffer);

  if (streamError) throw new Error(streamError);
  if (!result) throw new Error("Purge ended without a completion signal");
  return result;
}

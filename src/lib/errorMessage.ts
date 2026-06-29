// ─────────────────────────────────────────────────────────────────────────────
// Centralised error-message extraction.
//
// The app's #1 error-UX problem is that real errors get discarded behind generic
// fallbacks ("Failed", "Update failed") because:
//   • Supabase Edge-function errors hide the real text inside error.context (a
//     Response body) — error.message is usually generic.
//   • PostgREST / DB errors carry the useful part in .details / .hint / .code.
// These helpers surface the EXACT message. They never throw.
// ─────────────────────────────────────────────────────────────────────────────

const GENERIC = "Something went wrong. Please try again.";

// Friendly prefixes for common Postgres / PostgREST error codes. The raw
// message/details are still appended so nothing is hidden.
const CODE_HINTS: Record<string, string> = {
  "23505": "This record already exists",
  "23503": "This is linked to other records",
  "23502": "A required field is missing",
  "23514": "A value is out of the allowed range",
  "42501": "You don't have permission to do this",
  "P0001": "", // RAISE EXCEPTION — message is already meaningful
  PGRST116: "No matching record was found",
  PGRST301: "You don't have permission to do this",
};

function clean(s: unknown): string {
  return typeof s === "string" ? s.trim() : "";
}

/**
 * Extract a human-readable, specific message from any thrown/returned error.
 * Synchronous — for edge-function invoke results use getInvokeError() instead.
 */
export function getErrorMessage(err: unknown): string {
  if (err == null) return GENERIC;
  if (typeof err === "string") return err.trim() || GENERIC;

  const e = err as any;

  // PostgREST / Supabase DB error shape: { message, details, hint, code }
  const message = clean(e.message);
  const details = clean(e.details);
  const hint = clean(e.hint);
  const code = clean(e.code);

  if (message || details || hint || code) {
    const codeHint = code && CODE_HINTS[code];
    // Prefer the DB message; fall back to details. Append details (if distinct)
    // and hint so the exact cause is always visible.
    const parts: string[] = [];
    if (codeHint) parts.push(codeHint);
    const primary = message || details;
    if (primary && primary !== codeHint) parts.push(primary);
    if (details && details !== primary && details !== message) parts.push(details);
    if (hint) parts.push(`(${hint})`);
    const composed = parts.filter(Boolean).join(" — ").replace(" — (", " (");
    if (composed) return composed;
  }

  // Plain object with an explicit error/msg field
  const nested = clean(e.error) || clean(e.msg) || clean(e.error_description);
  if (nested) return nested;

  if (err instanceof Error && err.message) return err.message;

  return GENERIC;
}

/**
 * Extract the exact error from a `supabase.functions.invoke()` result.
 * Returns null when there was no error. Edge functions in this codebase return
 * `{ error: "..." }` JSON bodies; supabase-js wraps that raw Response in
 * error.context, so we must await .json() to read it (mirrors the proven unwrap
 * previously inlined in the registration flow).
 */
export async function getInvokeError(res: {
  error: unknown;
  data: unknown;
}): Promise<string | null> {
  const dataErr = clean((res.data as any)?.error);
  if (!res.error && !dataErr) return null;

  // Try the Response body carried in error.context first — that's where edge
  // functions put their detailed message.
  try {
    const ctx = (res.error as any)?.context;
    if (ctx && typeof ctx.json === "function") {
      const body = await ctx.json();
      const bodyMsg = clean(body?.error) || clean(body?.message);
      if (bodyMsg) return bodyMsg;
    }
  } catch {
    /* body not JSON / already consumed — fall through */
  }

  return dataErr || getErrorMessage(res.error);
}

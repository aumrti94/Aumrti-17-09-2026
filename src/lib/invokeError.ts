// supabase.functions.invoke() reports a non-2xx response as a generic
// "Edge Function returned a non-2xx status code" message, with the REAL error body in
// error.context (a Response). Unwrap it so callers surface the true reason (entitlement
// message, provider/Azure error, etc.) instead of a misleading catch-all.
export async function unwrapFunctionError(
  error: unknown,
  data?: { error?: unknown } | null,
): Promise<string> {
  // Function returned 2xx but with an { error } body (this codebase's soft-error pattern).
  if (data?.error) return typeof data.error === "string" ? data.error : JSON.stringify(data.error);
  const err = error as { message?: string; context?: Response } | null;
  if (!err) return "Unknown error";
  const raw = err.message || "Edge function error";
  if (/failed to send|fetch failed|networkerror|failed to fetch/i.test(raw)) {
    return "AI service unreachable — the edge function may not be deployed.";
  }
  const ctx = err.context;
  if (ctx && typeof ctx.text === "function") {
    try {
      const body = await ctx.text();
      if (body) {
        try {
          const j = JSON.parse(body);
          return j.error || j.message || body;
        } catch {
          return body;
        }
      }
    } catch {
      /* fall through to raw */
    }
  }
  return raw;
}

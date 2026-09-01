/**
 * API key authentication, scope enforcement and plan entitlement.
 *
 * See docs/api/API_DESIGN_STANDARD.md §2, §3.
 */

import { ApiError } from "./errors.ts";

/**
 * The scope that says "this integration is authorised to see patient-identifiable data".
 *
 * Route scopes answer "which resource", this answers "may it see the person". They are separate
 * because they are separate questions: a key with read:appointments legitimately needs the
 * appointment book, and does not thereby need the presenting complaint written on it. Fields
 * listed in a route's phiFields are blanked unless the key also holds this scope.
 */
export const PHI_UNLOCK_SCOPE = "read:patients";

export interface AuthedKey {
  id: string;
  hospitalId: string;
  keyName: string;
  scopes: string[];
  environment: "sandbox" | "production";
  /** Resolved from the hospital's plan, with a floor so a misconfigured plan cannot mean zero. */
  rateLimitPerMin: number;
  lastUsedAt: string | null;
}

const DEFAULT_RATE_LIMIT = 60;

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
}

const AUTH_FAILED = new ApiError({
  type: "authentication_error",
  code: "invalid_api_key",
  // Deliberately one message for every failure mode — unknown key, revoked key, expired key.
  // Distinguishing them tells an attacker probing keys which guesses were real.
  message: "The API key provided is not valid. Check the key, or issue a new one from Settings → API Portal.",
});

export function extractBearer(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new ApiError({
      type: "authentication_error",
      code: "missing_api_key",
      message: "No API key provided. Send it as: Authorization: Bearer sk_live_…",
      headers: { "WWW-Authenticate": 'Bearer realm="Aumrti API"' },
    });
  }
  return match[1].trim();
}

export async function authenticate(sb: any, req: Request): Promise<AuthedKey> {
  const presented = extractBearer(req);

  // Cheap shape check before touching the database, so malformed junk costs us nothing.
  if (!/^sk_(live|test)_[0-9a-f]{64}$/.test(presented)) throw AUTH_FAILED;

  const keyHash = await sha256hex(presented);

  const { data: key, error } = await sb
    .from("api_keys")
    .select("id, hospital_id, key_name, scopes, environment, key_prefix, expires_at, is_active, last_used_at")
    .eq("key_hash", keyHash)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error("api-gateway auth lookup failed:", error.message);
    throw new ApiError({
      type: "api_error",
      code: "auth_unavailable",
      message: "Could not verify the API key right now. Retry shortly.",
    });
  }

  // Revocation is checked on every request and never cached — a key revoked because it leaked
  // must stop working immediately, not at the end of some TTL.
  if (!key) throw AUTH_FAILED;

  if (key.expires_at && new Date(key.expires_at) < new Date()) throw AUTH_FAILED;

  const rateLimitPerMin = await resolveRateLimit(sb, key.hospital_id);

  return {
    id: key.id,
    hospitalId: key.hospital_id,
    keyName: key.key_name,
    scopes: Array.isArray(key.scopes) ? key.scopes : [],
    environment: key.environment === "production" ? "production" : "sandbox",
    rateLimitPerMin,
    lastUsedAt: key.last_used_at ?? null,
  };
}

/**
 * Plan entitlement.
 *
 * Enforced here as well as in the portal UI, because a gate enforced only in the UI is not a
 * gate: the key already exists and the caller is not using the UI.
 */
export async function requireApiEntitlement(sb: any, hospitalId: string): Promise<void> {
  const plan = await loadPlan(sb, hospitalId);

  // No subscription row at all is treated as not entitled rather than as an error — a hospital
  // mid-migration should get a clear "not on your plan", not a 500.
  if (!plan?.api_access) {
    throw new ApiError({
      type: "permission_error",
      code: "api_not_in_plan",
      message: "API access is not included in this hospital's plan. Contact your Aumrti account manager to enable it.",
    });
  }
}

async function loadPlan(sb: any, hospitalId: string): Promise<any | null> {
  const { data: sub } = await sb
    .from("hospital_subscriptions")
    .select("plan_id, status")
    .eq("hospital_id", hospitalId)
    .in("status", ["active", "trialing"])
    .maybeSingle();

  if (!sub?.plan_id) return null;

  const { data: plan } = await sb
    .from("subscription_plans")
    .select("api_access, webhooks_enabled, api_rate_limit_per_min, max_api_keys")
    .eq("id", sub.plan_id)
    .maybeSingle();

  return plan ?? null;
}

async function resolveRateLimit(sb: any, hospitalId: string): Promise<number> {
  try {
    const plan = await loadPlan(sb, hospitalId);
    const configured = Number(plan?.api_rate_limit_per_min);
    // A plan row with 0 or a negative number is a configuration mistake, not an instruction to
    // refuse every request. Fall back rather than lock the hospital out of its own integrations.
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_RATE_LIMIT;
  } catch {
    return DEFAULT_RATE_LIMIT;
  }
}

export function requireScope(key: AuthedKey, scope: string): void {
  if (!key.scopes.includes(scope)) {
    throw new ApiError({
      type: "permission_error",
      code: "insufficient_scope",
      message: `This API key does not have the "${scope}" scope. Re-issue it from Settings → API Portal with that scope granted.`,
    });
  }
}

export function canSeePhi(key: AuthedKey): boolean {
  return key.scopes.includes(PHI_UNLOCK_SCOPE);
}

/**
 * Record that the key was used, at most once a minute.
 *
 * Writing on every request would put an UPDATE on the hottest row in the system into the latency
 * path of every call. Minute granularity is all "last used" is ever read at.
 */
export async function touchKey(sb: any, key: AuthedKey, ip: string | null): Promise<void> {
  const last = key.lastUsedAt ? new Date(key.lastUsedAt).getTime() : 0;
  if (Date.now() - last < 60_000) return;

  try {
    await sb.from("api_keys")
      .update({ last_used_at: new Date().toISOString(), ...(ip ? { last_used_ip: ip } : {}) })
      .eq("id", key.id);
  } catch (err) {
    // Never fail a request because a usage timestamp did not persist.
    console.warn("api-gateway: could not update last_used_at:", (err as Error).message);
  }
}

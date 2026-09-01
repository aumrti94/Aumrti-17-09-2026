// @ts-nocheck
/**
 * api-gateway — the Aumrti public API.
 *
 * One generic handler that walks the route registry in routes.ts. No module writes an HTTP
 * handler; a module exposes an API by adding a registry entry. That is what keeps 39 modules
 * consistent structurally rather than by review discipline.
 *
 * DEPLOYMENT: must be deployed with --no-verify-jwt (see supabase/config.toml). Callers
 * authenticate with an API key and hold no Supabase JWT, so the platform's default JWT gate
 * would reject every request before this code runs.
 *
 * Contract: docs/api/API_DESIGN_STANDARD.md
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkApiRateLimit } from "../_shared/api-rate-limit.ts";
import { ApiError, baseHeaders, errorResponse, jsonResponse, newRequestId } from "./errors.ts";
import { matchRoute, validateRegistry, ROUTES, type RouteDef } from "./routes.ts";
import { buildOpenApiSpec } from "./openapi.ts";
import {
  authenticate, canSeePhi, requireApiEntitlement, requireScope, touchKey, type AuthedKey,
} from "./auth.ts";
import {
  buildPage, decodeCursor, keysetFilter, parseLimit, MAX_LIMIT,
} from "./pagination.ts";
import {
  createPatient, parseBody, translateWriteError, validateWriteBody,
} from "./writers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Delegated write handlers call sibling functions (upsert-patient-phi) that own invariants
// living outside the database.
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

// Fail the deploy, not a request at 3am: a malformed registry is a programming error and there is
// no useful degraded mode for it.
const registryProblems = validateRegistry();
if (registryProblems.length) {
  console.error("api-gateway: route registry is invalid:\n" +
    registryProblems.map(p => `  ${p.method} ${p.path}: ${p.problem}`).join("\n"));
  throw new Error(`Route registry has ${registryProblems.length} problem(s); refusing to start.`);
}

const db = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

serve(async (req: Request) => {
  const requestId = newRequestId();
  const started = Date.now();
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: baseHeaders(requestId) });
  }

  // Supabase serves this at /functions/v1/api-gateway/*; api.aumrti.com rewrites /v1/* onto it.
  // Normalising here means the registry only ever describes the public shape.
  const pathname = url.pathname.replace(/^\/functions\/v1\/api-gateway/, "") || "/";

  const sb = db();
  let key: AuthedKey | null = null;
  let matched: RouteDef | null = null;
  let status = 500;

  try {
    if (pathname === "/" || pathname === "/v1") {
      status = 200;
      return jsonResponse({
        service: "Aumrti API",
        version: "v1",
        openapi: "/v1/openapi.json",
        endpoints: ROUTES.length,
      }, requestId);
    }

    // Unauthenticated on purpose: an integrator needs to read the contract before they have been
    // issued a key, and it describes shapes rather than data. It is generated from the same
    // registry this router walks, so it cannot describe an endpoint that does not exist.
    if (pathname === "/v1/openapi.json") {
      status = 200;
      return jsonResponse(buildOpenApiSpec(), requestId, {
        "Cache-Control": "public, max-age=300",
      });
    }

    const hit = matchRoute(req.method, pathname);
    if (!hit) {
      throw new ApiError({
        type: "invalid_request_error",
        code: "unknown_endpoint",
        message: `No such endpoint: ${req.method} ${pathname}`,
        status: 404,
      });
    }
    matched = hit.route;

    key = await authenticate(sb, req);
    requireScope(key, matched.scope);
    await requireApiEntitlement(sb, key.hospitalId);

    const limit = await enforceRateLimit(sb, key, requestId);

    let payload: unknown;

    if (matched.method === "GET") {
      payload = matched.path.includes("{id}")
        ? await handleSingle(sb, matched, hit.params.id, key)
        : await handleList(sb, matched, url, key);
    } else {
      const written = await handleWrite(sb, matched, hit.params.id ?? null, req, key, requestId);
      // A replayed idempotent request returns the ORIGINAL response, including its status.
      if (written.replayed) {
        status = written.status;
        await touchKey(sb, key, clientIp(req));
        return new Response(JSON.stringify(written.body), {
          status: written.status,
          headers: { ...baseHeaders(requestId), ...limit, "Idempotent-Replay": "true" },
        });
      }
      payload = written.body;
      status = written.status;
      await touchKey(sb, key, clientIp(req));
      return new Response(JSON.stringify(payload), {
        status: written.status,
        headers: { ...baseHeaders(requestId), ...limit },
      });
    }

    status = 200;
    await touchKey(sb, key, clientIp(req));
    return jsonResponse(payload, requestId, limit);
  } catch (err) {
    const res = errorResponse(err, requestId);
    status = res.status;
    return res;
  } finally {
    // Logged for every outcome including failures — a 403 an integrator cannot explain is the
    // most common support ticket this table exists to answer.
    await logRequest(sb, {
      requestId, key, route: matched, req, url, pathname, status,
      durationMs: Date.now() - started,
    });
  }
});

// ── Handlers ─────────────────────────────────────────────────────────────────────────────────

async function handleList(sb: any, route: RouteDef, url: URL, key: AuthedKey) {
  const limit = parseLimit(url.searchParams.get("limit"));
  const sortColumn = route.sort!;

  let q = sb
    .from(route.table)
    .select(route.select.join(","))
    // The tenant predicate. Always applied, always from the authenticated key. There is no code
    // path that reads a hospital id from the request.
    .eq(route.tenantColumn, key.hospitalId);

  for (const f of route.filters ?? []) {
    const raw = url.searchParams.get(f.param);
    if (raw === null || raw === "") continue;
    q = applyFilter(q, f.column, f.op, raw, f.param);
  }

  rejectUnknownParams(url, route);

  const cursorParam = url.searchParams.get("starting_after");
  if (cursorParam) {
    q = q.or(keysetFilter(sortColumn, decodeCursor(cursorParam)));
  }

  // id is the tiebreaker: the sort column alone is not a total order, and without it a cursor
  // can loop or skip when two rows share a timestamp.
  q = q.order(sortColumn, { ascending: true }).order("id", { ascending: true }).limit(limit + 1);

  const { data, error } = await q;
  if (error) throw translatePostgrest(error);

  const page = buildPage(data ?? [], limit, sortColumn);
  return { ...page, data: page.data.map(row => redact(row, route, key)) };
}

async function handleSingle(sb: any, route: RouteDef, id: string, key: AuthedKey) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new ApiError({
      type: "invalid_request_error",
      code: "invalid_id",
      message: "The id must be a UUID.",
      param: "id",
      status: 400,
    });
  }

  // .maybeSingle(), never .single(): .single() raises on zero rows, which turns an ordinary
  // 404 into a 500.
  const { data, error } = await sb
    .from(route.table)
    .select(route.select.join(","))
    .eq(route.tenantColumn, key.hospitalId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw translatePostgrest(error);

  // A row belonging to another hospital is genuinely Not Found from this key's perspective, and
  // must be indistinguishable from one that does not exist — otherwise the API confirms which
  // ids are real elsewhere in the system.
  if (!data) {
    throw new ApiError({
      type: "invalid_request_error",
      code: "resource_not_found",
      message: "No such resource.",
      status: 404,
    });
  }

  return redact(data, route, key);
}

interface WriteOutcome { body: unknown; status: number; replayed: boolean; }

async function handleWrite(
  sb: any, route: RouteDef, id: string | null, req: Request, key: AuthedKey, requestId: string,
): Promise<WriteOutcome> {
  const isCreate = route.method === "POST";
  const body = validateWriteBody(await parseBody(req), route, isCreate);

  // ── Idempotency ────────────────────────────────────────────────────────────────────────────
  // Only on create: PATCH with the same body is already idempotent, and a stored replay would
  // wrongly mask a genuine second edit.
  const idemKey = isCreate ? req.headers.get("idempotency-key")?.trim() || null : null;
  const fingerprint = idemKey ? await sha256hex(`${route.path}|${JSON.stringify(body)}`) : null;

  if (idemKey) {
    const replay = await lookupIdempotent(sb, key, idemKey, fingerprint!, route.path);
    if (replay) return replay;
  }

  // ── Perform ────────────────────────────────────────────────────────────────────────────────
  let row: Record<string, unknown>;
  try {
    if (route.write!.handler === "patients.create") {
      row = await createPatient(sb, key.hospitalId, body, FUNCTIONS_URL, SERVICE_KEY);
    } else if (isCreate) {
      const { data, error } = await sb
        .from(route.table)
        // hospital_id is set here, from the key — never from the body. The registry forbids it
        // being caller-writable, and this is the only place it is assigned.
        .insert({ ...body, [route.tenantColumn]: key.hospitalId })
        .select(route.select.join(","))
        .maybeSingle();
      if (error) throw translateWriteError(error);
      row = data;
    } else {
      if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
        throw new ApiError({
          type: "invalid_request_error", code: "invalid_id",
          message: "The id must be a UUID.", param: "id", status: 400,
        });
      }
      const { data, error } = await sb
        .from(route.table)
        .update(body)
        // The tenant predicate is on the UPDATE itself, not a prior read: without it, a caller
        // who guessed a uuid could edit another hospital's row.
        .eq(route.tenantColumn, key.hospitalId)
        .eq("id", id)
        .select(route.select.join(","))
        .maybeSingle();
      if (error) throw translateWriteError(error);
      if (!data) {
        throw new ApiError({
          type: "invalid_request_error", code: "resource_not_found",
          message: "No such resource.", status: 404,
        });
      }
      row = data;
    }
  } catch (err) {
    // A raw PostgrestError from the delegated handler still needs translating.
    if (err instanceof ApiError) throw err;
    throw translateWriteError(err);
  }

  const status = isCreate ? 201 : 200;
  const payload = redact(row, route, key);

  // Audit and idempotency are recorded after the write succeeds, and neither is allowed to fail
  // the request — the record already exists, and reporting an error the caller would retry on
  // would create a duplicate.
  await writeAuditLog(sb, route, key, row, requestId);
  if (idemKey) await storeIdempotent(sb, key, idemKey, fingerprint!, route.path, status, payload);

  return { body: payload, status, replayed: false };
}

async function lookupIdempotent(
  sb: any, key: AuthedKey, idemKey: string, fingerprint: string, path: string,
): Promise<WriteOutcome | null> {
  const { data } = await sb
    .from("api_idempotency_keys")
    .select("request_fingerprint, response_status, response_body, expires_at")
    .eq("hospital_id", key.hospitalId)
    .eq("idempotency_key", idemKey)
    .maybeSingle();

  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) return null;

  // Same key, different request. This is a client bug; replaying the first response would hide
  // it and silently drop the second write.
  if (data.request_fingerprint !== fingerprint) {
    throw new ApiError({
      type: "invalid_request_error",
      code: "idempotency_key_reused",
      message: "This Idempotency-Key was already used for a different request. Use a new key per distinct request.",
      status: 409,
    });
  }

  return { body: data.response_body, status: data.response_status ?? 201, replayed: true };
}

async function storeIdempotent(
  sb: any, key: AuthedKey, idemKey: string, fingerprint: string,
  path: string, status: number, payload: unknown,
): Promise<void> {
  try {
    await sb.from("api_idempotency_keys").insert({
      hospital_id: key.hospitalId,
      api_key_id: key.id,
      idempotency_key: idemKey,
      request_path: path,
      request_fingerprint: fingerprint,
      response_status: status,
      response_body: payload,
    });
  } catch (err) {
    console.warn("api-gateway: idempotency record not stored:", (err as Error).message);
  }
}

/**
 * Every API-initiated mutation is audited.
 *
 * An automated change to a clinical or billing record must be as traceable as one a person made,
 * or NABH evidence has a hole in it exactly where automation touches the record. changed_by is
 * null because no human did this — the acting credential is in details instead.
 */
async function writeAuditLog(
  sb: any, route: RouteDef, key: AuthedKey, row: Record<string, unknown>, requestId: string,
): Promise<void> {
  try {
    await sb.from("audit_log").insert({
      hospital_id: key.hospitalId,
      table_name: route.table,
      record_id: row?.id ?? null,
      action: route.method === "POST" ? "INSERT" : "UPDATE",
      module: "api",
      entity_type: route.table,
      entity_id: row?.id ?? null,
      user_name: `API key: ${key.keyName}`,
      // No old/new values: for a PHI table they would put patient data into a second store with
      // a different retention policy. The row itself is the record; this says who changed it.
      details: {
        api_key_id: key.id,
        request_id: requestId,
        route: route.path,
        environment: key.environment,
      },
    });
  } catch (err) {
    console.error(`[${requestId}] AUDIT WRITE FAILED for ${route.method} ${route.path}:`, (err as Error).message);
  }
}

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
}

// ── Pipeline pieces ──────────────────────────────────────────────────────────────────────────

async function enforceRateLimit(sb: any, key: AuthedKey, requestId: string): Promise<Record<string, string>> {
  const result = await checkApiRateLimit(sb, `key:${key.id}`, key.rateLimitPerMin, 60, "closed");

  const headers = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(Math.max(0, result.limit - result.count)),
    "X-RateLimit-Reset": String(result.resetAt),
  };

  if (!result.allowed) {
    throw new ApiError({
      type: "rate_limit_error",
      code: result.degraded ? "rate_limiter_unavailable" : "rate_limit_exceeded",
      message: result.degraded
        ? "Rate limiting is temporarily unavailable, so requests are being shed. Retry shortly."
        : `Rate limit of ${result.limit} requests per minute exceeded.`,
      headers: { ...headers, "Retry-After": String(result.retryAfterSeconds ?? 60) },
    });
  }
  return headers;
}

function applyFilter(q: any, column: string, op: string, raw: string, param: string) {
  switch (op) {
    case "eq": {
      // Postgres rejects a non-boolean literal for a boolean column with a 22P02 that surfaces as
      // an opaque 500. Normalising here turns it into a clear 400 the caller can act on.
      if (raw === "true" || raw === "false") return q.eq(column, raw === "true");
      return q.eq(column, raw);
    }
    case "gte": return q.gte(column, raw);
    case "lte": return q.lte(column, raw);
    case "ilike": return q.ilike(column, `%${raw}%`);
    default:
      throw new ApiError({
        type: "api_error", code: "bad_filter_config",
        message: `Filter "${param}" is misconfigured.`,
      });
  }
}

/**
 * A misspelled filter must not be ignored.
 *
 * Silently dropping `?patient_id=…` typed as `?patientid=…` returns every patient's records and
 * looks like a successful call — the integrator ships it, and nobody discovers the mistake until
 * the data is somewhere it should not be.
 */
function rejectUnknownParams(url: URL, route: RouteDef): void {
  const known = new Set(["limit", "starting_after", ...(route.filters ?? []).map(f => f.param)]);
  for (const name of url.searchParams.keys()) {
    if (!known.has(name)) {
      throw new ApiError({
        type: "invalid_request_error",
        code: "unknown_parameter",
        message: `Unknown query parameter "${name}". Supported: ${[...known].sort().join(", ")}.`,
        param: name,
      });
    }
  }
}

/** Blank the PHI fields unless the key is authorised to see patient-identifiable data. */
function redact(row: Record<string, any>, route: RouteDef, key: AuthedKey): Record<string, any> {
  if (!route.phi || !route.phiFields?.length || canSeePhi(key)) return row;

  const out = { ...row };
  for (const field of route.phiFields) {
    if (field in out) out[field] = null;
  }
  // Stated explicitly so a caller can tell "this patient has no allergies recorded" from
  // "you are not allowed to see the allergies" — silent nulls would conflate them.
  out.redacted_fields = route.phiFields;
  return out;
}

function translatePostgrest(error: any): ApiError {
  // 22P02 invalid_text_representation, 22007 invalid_datetime_format — always the caller passing
  // a malformed value into a typed column.
  if (error?.code === "22P02" || error?.code === "22007") {
    return new ApiError({
      type: "invalid_request_error",
      code: "invalid_filter_value",
      message: "A filter value is not valid for that field. Dates must be ISO 8601; ids must be UUIDs.",
    });
  }
  console.error("api-gateway postgrest error:", error?.code, error?.message);
  return new ApiError({
    type: "api_error",
    code: "query_failed",
    message: "The query could not be completed. Quote the request id when reporting this.",
  });
}

function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : null;
}

async function logRequest(sb: any, ctx: {
  requestId: string; key: AuthedKey | null; route: RouteDef | null;
  req: Request; url: URL; pathname: string; status: number; durationMs: number;
}): Promise<void> {
  // Unauthenticated failures have no tenant to attribute the row to, and api_request_log is
  // hospital-scoped. Those are visible in the function logs instead.
  if (!ctx.key) return;

  try {
    await sb.from("api_request_log").insert({
      hospital_id: ctx.key.hospitalId,
      api_key_id: ctx.key.id,
      request_id: ctx.requestId,
      method: ctx.req.method,
      // The concrete path only — never url.search. Query strings carry filter values such as a
      // patient's phone number, and this table must not become a second copy of PHI.
      path: ctx.pathname,
      route_pattern: ctx.route?.path ?? null,
      status_code: ctx.status,
      duration_ms: ctx.durationMs,
      ip_address: clientIp(ctx.req),
      user_agent: ctx.req.headers.get("user-agent")?.slice(0, 256) ?? null,
    });
  } catch (err) {
    console.warn(`[${ctx.requestId}] request log write failed:`, (err as Error).message);
  }
}

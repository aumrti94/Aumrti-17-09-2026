/**
 * The Aumrti domain, for edge functions.
 *
 * Mirrors src/lib/brand.ts. It exists separately because edge functions are Deno and cannot
 * import from `src/` — the two files must be kept in step, which the old-domain-literal
 * unit test enforces from the other direction.
 *
 * The domain was hardcoded with the wrong TLD in about forty places across the product — support and
 * sales addresses, invoice footers, subscription emails, the FHIR base URL. The real domain is
 * aumrti.com, and because each was an independent literal there was no way to fix them together.
 *
 * Override per-environment by setting the APP_DOMAIN secret:
 *   npx supabase secrets set APP_DOMAIN=aumrti.com
 */

// Read through globalThis rather than the bare `Deno` global. This module is imported by
// api-gateway/openapi.ts, which scripts/generate-openapi.mjs bundles and runs under NODE to
// produce docs/api/openapi.json — a bare `Deno.env` throws ReferenceError there. Optional
// chaining keeps it working in both runtimes off one definition.
const ENV_DOMAIN = (globalThis as any).Deno?.env?.get?.("APP_DOMAIN") as string | undefined;

export const APP_DOMAIN = ENV_DOMAIN ?? "aumrti.com";

export const APP_URL = `https://app.${APP_DOMAIN}`;
export const DOCS_URL = `https://docs.${APP_DOMAIN}`;
export const API_BASE_URL = `https://api.${APP_DOMAIN}/v1`;

export const SUPPORT_EMAIL = `support@${APP_DOMAIN}`;
export const ACCOUNTS_EMAIL = `accounts@${APP_DOMAIN}`;
export const PROCUREMENT_EMAIL = `procurement@${APP_DOMAIN}`;
export const NO_REPLY_EMAIL = `no-reply@${APP_DOMAIN}`;

/**
 * The one place the Aumrti domain is written down.
 *
 * It was previously hardcoded as the wrong TLD in about forty places — support and sales mailto
 * links, invoice footers, subscription emails, the white-label CNAME target, the FHIR base URL
 * and the API documentation. The real domain is aumrti.com, so every one of them was wrong, and
 * because each was an independent literal there was no way to notice or to fix them together.
 *
 * Frontend code imports from here. Edge functions cannot (they are Deno and cannot reach into
 * `src/`), so they read `Deno.env.get("APP_DOMAIN")` with the same default — see the
 * APP_DOMAIN note in .env.example.
 *
 * A unit test asserts the old domain literal no longer survives anywhere in the tree.
 */

/** Override per-environment with VITE_APP_DOMAIN — e.g. a staging domain. */
export const APP_DOMAIN = (import.meta.env.VITE_APP_DOMAIN as string) || "aumrti.com";

// ── Web ──────────────────────────────────────────────────────────────────────────────────────

/** The hospital-facing application. */
export const APP_URL = `https://app.${APP_DOMAIN}`;

/** Developer documentation, including the generated OpenAPI reference. */
export const DOCS_URL = `https://docs.${APP_DOMAIN}`;

/** Public API base. The gateway is fronted by this once the custom domain is in place. */
export const API_BASE_URL = `https://api.${APP_DOMAIN}/v1`;

/** What a hospital points its own domain at when white-labelling. */
export const CNAME_TARGET = `cname.${APP_DOMAIN}`;

// ── Email ────────────────────────────────────────────────────────────────────────────────────

export const SUPPORT_EMAIL = `support@${APP_DOMAIN}`;
export const SALES_EMAIL = `sales@${APP_DOMAIN}`;
export const ENTERPRISE_EMAIL = `enterprise@${APP_DOMAIN}`;

// ── Identifiers ──────────────────────────────────────────────────────────────────────────────

/**
 * FHIR system URI marking a de-identified research export.
 *
 * A FHIR `system` is an identifier namespace, not an address to fetch — nothing resolves it. It
 * is derived from the domain for consistency, but note that changing it changes the meaning of
 * the tag: an export carrying the old URI and one carrying the new are, to a strict consumer,
 * tagged by two different authorities.
 */
export const RESEARCH_DEIDENT_SYSTEM = `https://${APP_DOMAIN}/research/deidentified`;

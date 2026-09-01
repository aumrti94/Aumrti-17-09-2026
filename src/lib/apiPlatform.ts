/**
 * Shared definitions for the Aumrti public API platform.
 *
 * One module so the portal UI, the gateway route registry, and the generated OpenAPI spec cannot
 * drift apart on what a scope is called or what an event is named. Previously the scope list and
 * the event list lived as literals inside SettingsAPIPortalPage.tsx, and the key-generation logic
 * existed twice — once correctly (SHA-256) and once not (raw secret written to `key_hash`).
 *
 * See docs/api/API_DESIGN_STANDARD.md for the rules these definitions implement.
 */

export type ApiEnvironment = "sandbox" | "production";

// ── Scopes ───────────────────────────────────────────────────────────────────────────────────

/**
 * Granted per key, enforced per route by the gateway. Read and write are deliberately separate:
 * a Tally or BI integration needs `read:bills` and must never be able to raise one.
 */
export const API_SCOPES = [
  "read:patients",
  "write:patients",
  "read:appointments",
  "write:appointments",
  "read:encounters",
  "read:admissions",
  "read:bills",
  "write:bills",
  "read:insurance",
  "read:lab",
  "write:lab",
  "read:radiology",
  "read:pharmacy",
  "read:emergency",
  "read:ot",
  "read:nursing",
  "read:bloodbank",
  "read:dialysis",
  "read:vaccination",
  "read:inventory",
  "read:ambulance",
  "read:staff",
  "read:masters",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

/** Shown as the scope chip's tooltip, so an admin granting access knows what they are granting. */
export const SCOPE_DESCRIPTIONS: Record<ApiScope, string> = {
  "read:patients": "Read patient demographics and UHIDs. Grants access to PHI.",
  "write:patients": "Register and update patients.",
  "read:appointments": "Read the appointment book.",
  "write:appointments": "Book, reschedule and cancel appointments.",
  "read:encounters": "Read OPD consultation records. Grants access to clinical PHI.",
  "read:admissions": "Read IPD admissions, bed occupancy and discharge status.",
  "read:bills": "Read bills, line items and payment status.",
  "write:bills": "Raise bills and record payments.",
  "read:insurance": "Read insurance claims, pre-authorisations and TPA queries. Grants access to PHI.",
  "read:lab": "Read lab orders and results. Grants access to clinical PHI.",
  "write:lab": "Place lab orders and post results (analyser integrations).",
  "read:radiology": "Read radiology orders and signed reports. Grants access to clinical PHI.",
  "read:pharmacy": "Read prescriptions and dispense records.",
  "read:emergency": "Read emergency department visits and triage. Grants access to clinical PHI.",
  "read:ot": "Read theatre schedules and surgery records. Grants access to clinical PHI.",
  "read:nursing": "Read nursing observations and vitals. Grants access to clinical PHI.",
  "read:bloodbank": "Read blood stock and requests. Donor infection results are never exposed.",
  "read:dialysis": "Read dialysis sessions. Grants access to clinical PHI.",
  "read:vaccination": "Read immunisation records. Grants access to clinical PHI.",
  "read:inventory": "Read stock items, balances and movements. No PHI.",
  "read:ambulance": "Read ambulance dispatches and trips. Grants access to PHI.",
  "read:staff": "Read staff attendance. Employee personal data, not patient data.",
  "read:masters": "Read departments, services, doctors and rate cards. No PHI.",
};

/** Scopes that expose patient-identifiable data — surfaced in the UI so the grant is deliberate. */
export const PHI_SCOPES: ReadonlySet<string> = new Set<ApiScope>([
  "read:patients",
  "write:patients",
  "read:encounters",
  "read:admissions",
  "read:lab",
  "write:lab",
  "read:radiology",
  "read:pharmacy",
  "read:insurance",
  "read:emergency",
  "read:ot",
  "read:nursing",
  "read:dialysis",
  "read:vaccination",
  "read:ambulance",
]);

// ── Event catalogue ──────────────────────────────────────────────────────────────────────────

/**
 * Event names are `{domain}.{resource}.{past-tense-verb}`.
 *
 * The domain prefix is not decoration. The previous flat names (`patient.created`,
 * `bill.paid`) have no room for 39 modules — Radiology and Lab both have an `order.placed`,
 * OT and IPD both have a `procedure.completed`. Qualifying by domain is what keeps the
 * namespace open as modules are onboarded.
 *
 * Past tense throughout: a webhook reports something that has already happened and committed.
 */
export const WEBHOOK_EVENT_GROUPS: ReadonlyArray<{ domain: string; events: readonly string[] }> = [
  // Deliberately no patients.patient.merged: there is no duplicate-merge operation in the
  // product, so no trigger could fire it. Offering an event nothing emits means a hospital
  // subscribes, waits, and never learns that the silence is the bug.
  { domain: "Patients", events: [
    "patients.patient.registered",
    "patients.patient.updated",
  ] },
  { domain: "Scheduling", events: [
    "scheduling.appointment.booked",
    "scheduling.appointment.rescheduled",
    "scheduling.appointment.cancelled",
    "scheduling.appointment.checked_in",
  ] },
  // No opd.encounter.closed: opd_encounters has no status or closed-at column, so there is
  // nothing to detect the transition on. It returns when the table grows one.
  { domain: "OPD", events: [
    "opd.encounter.started",
  ] },
  { domain: "IPD", events: [
    "ipd.admission.created",
    "ipd.admission.transferred",
    "ipd.admission.discharged",
  ] },
  { domain: "Billing", events: [
    "billing.bill.created",
    "billing.bill.finalised",
    "billing.bill.paid",
    "billing.payment.received",
    "billing.refund.issued",
  ] },
  { domain: "Insurance", events: [
    "insurance.pre_auth.submitted",
    "insurance.pre_auth.approved",
    "insurance.pre_auth.rejected",
    "insurance.claim.submitted",
    "insurance.claim.settled",
    "insurance.claim.denied",
    "insurance.query.raised",
  ] },
  { domain: "Laboratory", events: [
    "lab.order.placed",
    "lab.sample.collected",
    "lab.result.published",
    "lab.result.critical",
  ] },
  { domain: "Radiology", events: [
    "radiology.order.placed",
    "radiology.report.published",
  ] },
  { domain: "Pharmacy", events: [
    "pharmacy.prescription.created",
    "pharmacy.dispense.completed",
  ] },
];

export const WEBHOOK_EVENTS: readonly string[] =
  WEBHOOK_EVENT_GROUPS.flatMap(g => g.events);

// ── Key generation ───────────────────────────────────────────────────────────────────────────

/** The prefix encodes the environment, so a key's mode is legible wherever the key text appears. */
export function keyPrefix(environment: ApiEnvironment): string {
  return environment === "production" ? "sk_live_" : "sk_test_";
}

/**
 * Generate a raw API key.
 *
 * Uses crypto.getRandomValues, NOT Math.random. The previous implementation built the secret from
 * Math.random(), which is seeded from a predictable source and is not a CSPRNG — an attacker who
 * observes one issued key can narrow the search space for others issued by the same tab.
 *
 * 32 random bytes → 256 bits of entropy, rendered base62-ish via hex for URL and header safety.
 */
export function generateApiKey(environment: ApiEnvironment): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return keyPrefix(environment) + body;
}

/**
 * SHA-256 hex digest — this, and never the raw key, is what is stored.
 *
 * The database enforces the same thing independently: api_keys.key_hash carries a CHECK that the
 * value matches ^[0-9a-f]{64}$, so a regression here is refused at the storage layer rather than
 * silently persisting a plaintext credential (see migration 20261019000001).
 */
export async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
}

/** Read an existing key's environment back off its stored prefix. */
export function environmentOf(prefix: string | null | undefined): ApiEnvironment {
  return prefix?.includes("live") ? "production" : "sandbox";
}

// ── Gateway location ─────────────────────────────────────────────────────────────────────────

/**
 * Where the public API actually answers.
 *
 * `https://api.aumrti.com/v1` was hardcoded on the portal screen while nothing served that host —
 * an integrator following the screen would have pointed at a domain that does not resolve. The
 * base URL is derived from the deployment instead, with VITE_API_GATEWAY_URL as the override for
 * once the api.aumrti.com custom domain is in front of the gateway.
 */
export function apiBaseUrl(): string {
  const override = import.meta.env.VITE_API_GATEWAY_URL as string | undefined;
  if (override) return override.replace(/\/$/, "");
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/api-gateway/v1`;
}

/**
 * Whether the gateway is deployed and serving. Until it is, the portal issues and manages
 * credentials but must not claim there is an endpoint to call them against.
 */
export function isGatewayLive(): boolean {
  return String(import.meta.env.VITE_API_GATEWAY_LIVE) === "true";
}

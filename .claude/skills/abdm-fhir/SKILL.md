---
name: abdm-fhir
description: Use when working on ABDM/ABHA integration, health-record linking and care contexts, ABDM consent, HPR/HFR registration, FHIR R4 resources or export, HCX insurance claim exchange, or when testing any of these. Covers ABHA identifier validation, gateway auth and JWE encryption, the mandatory ABDM audit trail, the consent-before-data rule, and how to test ABHA validators without putting a real identifier in a fixture.
---

# ABDM, FHIR and HCX

ABDM (Ayushman Bharat Digital Mission) is India's national health data exchange. Participating
makes the hospital a **HIP** (Health Information Provider), and the rules below are externally
imposed by NHA — a gap here is a certification failure, not an internal style issue.

Surfaces: `abdm-*` Edge Functions (ABHA create/verify, gateway token, HIP callback and link init,
care-context auto-link, HFR/HPR registration, FHIR packaging, sandbox test), `fhir-export`,
`fhir-r4-server`, and the HCX claim functions.

## Validate identifiers before anything else

```typescript
import { validateAbhaId, validateAbhaAddress, validateMobileForAbha,
         validateAadhaarFormat, validateHprId, formatAbhaNumber } from "@/lib/abdm-validators";

const r = validateAbhaId(input);
if (!r.valid) { setError(r.error); return; }
```

Pure functions returning `{ valid, error? }`. The rules they encode:

- **ABHA number** — exactly 14 digits, dashes optional. Display as `XX-XXXX-XXXX-XXXX` via
  `formatAbhaNumber`.
- **ABHA address** — 8–18 chars, letters/digits/dots/underscores, cannot start or end with a dot or
  underscore. Accepts `name@abdm` or the bare part.
- **Mobile** — 10 digits starting 6–9.
- **Aadhaar** — 12 digits, never starting 0 or 1.
- **HPR ID** — 8–14 digits.

Validate client-side before calling the gateway. A malformed identifier rejected by NHA costs a
round trip and shows the user an opaque upstream error instead of a fixable one.

## Consent before data — always

No health record leaves the hospital without a recorded, unexpired ABDM consent artefact for that
patient, purpose, and date range.

- Consent is **per purpose and time-bounded**, and it is revocable. Honour the expiry — a consent
  artefact that has lapsed is not consent.
- ABDM consent is a **separate artefact** from DPDP processing consent and from clinical treatment
  consent. One does not imply another.
- Linking a care context tells the national registry that records exist for this patient here. That
  is itself a disclosure — it needs consent and an audit entry.
- On revocation, stop sharing immediately and record it.

## Gateway auth and encryption

```typescript
import { getAbdmToken, abdmHeaders } from "../_shared/abdm-auth.ts";
import { fetchAbdmPublicKey, encryptWithAbdmKey } from "../_shared/abdm-encrypt.ts";
import { checkRateLimit } from "../_shared/abdm-rate-limit.ts";
```

Use these rather than re-implementing per function:

- `getAbdmToken` handles the gateway session token; `abdmHeaders` builds the required header set
  (including the correlation id NHA uses to trace a request across systems).
- Payloads carrying identifiers are encrypted with the gateway's public key — `fetchAbdmPublicKey`
  then `encryptWithAbdmKey`. Never hand-roll the JWE.
- ABDM rate limits are externally imposed and stricter than the app's own; use
  `checkRateLimit` from `abdm-rate-limit.ts`, not the general `api-rate-limit.ts`.

Callback endpoints (`abdm-hip-callback`, `hcx-callback-receiver`) run with `verify_jwt = false` and
must therefore authenticate the caller by other means — verify the gateway's signature and reject
anything unrecognised, logging `GATEWAY_AUTH_REJECTED`. See
[edge-function](../edge-function/SKILL.md).

## Audit every ABDM event

```typescript
import { logAuditEvent } from "../_shared/abdm-audit.ts";

await logAuditEvent(sb, {
  action: "CARE_CONTEXT_LINKED",
  hospital_id, patient_id, abha_address,
  performed_by: staffUserId,          // public.users.id
  raw_ip: req.headers.get("x-forwarded-for"),
});
```

Actions: `ABHA_CREATED`, `ABHA_LINKED`, `ABHA_DELINKED`, `CARE_CONTEXT_LINKED`, `CONSENT_GRANTED`,
`CONSENT_REVOKED`, `HEALTH_RECORDS_SHARED`, `GATEWAY_AUTH_REJECTED`.

Two design points to preserve:

- **IPs are stored hashed**, never raw — SHA-256, base64url, first 16 chars, with `x-forwarded-for`
  taking the first entry. Pass `raw_ip` and let the helper hash it; never write the address itself.
- **`logAuditEvent` never throws.** Audit failure must not break request flow. Don't wrap it in
  logic that changes behaviour on its result.

This trail is what an NHA audit inspects. An unaudited disclosure is the finding.

## FHIR R4

`abdm-fhir-package` builds the FHIR bundle for ABDM; `fhir-export` and `fhir-r4-server` expose FHIR
resources.

- ABDM expects **specific FHIR R4 profiles** — `DiagnosticReport`, `Prescription`,
  `OPConsultation`, `DischargeSummary`, `WellnessRecord`, `ImmunizationRecord`. Match the profile
  the care-context type declares; a technically valid bundle against the wrong profile is rejected.
- Every bundle needs a `Composition` as its first entry, with `Patient` and `Practitioner`
  references that resolve inside the bundle.
- Codings use the systems ABDM mandates — SNOMED CT and LOINC where required, ICD-10 for diagnosis.
  `@/lib/icd10Data` and `icdSearch` are the local ICD surface.
- Practitioner identity is the **HPR ID**, and facility identity is the **HFR ID** — not internal
  uuids. `abdm-hpr-verify` and `abdm-hfr-register` establish these.

## HCX

HCX is the insurance-claim exchange and shares ABDM's shape: JWE-wrapped FHIR payloads over a
gateway, with Keycloak client-credentials auth against separate staging and production realms.

`pmjay-eligibility` is the model for mode selection — HCX mode when the feature flag and
credentials exist, direct NHA BIS mode when only an API key is set, sandbox mock otherwise. State
the modes in the function's header comment.

Claim payloads carry `bill_line_items` (not `bill_items` — that name does not exist, and using it
once submitted claims with an empty item list). See
[billing-and-gst](../billing-and-gst/SKILL.md).

## Sandbox vs production

`abdm-sandbox-test` exercises the integration without touching live NHA. Sandbox and production have
different base URLs, realms and credentials — resolve them from environment, never hardcode.

Sandbox responses must be obviously synthetic. A mocked ABHA verification that looks real will
eventually be believed by someone at a registration desk.

## PHI

ABHA numbers, ABHA addresses, Aadhaar and mobile are all patient identifiers. `sanitizeForLog`
already redacts Aadhaar-shaped digits and Indian mobiles — apply it to anything logged. Never log a
gateway payload verbatim.

## Testing

**No test exists for these validators yet** — zero `*.test.ts` files under `src/`, and no `test`
script in `package.json` (run `npx vitest run`). `src/lib/abdm-validators.ts` is pure functions over
strings: no gateway, no sandbox, no network, no mocking. Cheapest real coverage in this area.

`validateAbhaId` and `validateAadhaarFormat` check **format only** — no Verhoeff or check-digit
logic exists anywhere in the repo. A well-formed fake passes, and that is correct: they are typo
filters ahead of a gateway call, never proof an identifier is real. Assert that boundary so nobody
later "fixes" it, and test at the edges — a validator that accepts everything passes every test.

**Never put a real or realistic ABHA number, Aadhaar number or mobile in a fixture** — test data
gets pasted into issues and failure output. Use obviously-synthetic placeholders (`9000000001`); if
a checksum is ever added, *construct* a value that satisfies the algorithm, because "I need a valid
number to test the checksum" is exactly what puts a real Aadhaar in a fixture. Same for test names.

For consent and linking, assert the artefact is **persisted and reachable** — the `abdm_consents`
row with its status, expiry and date range, the `abdm_audit_log` entry — not that the call returned
OK. A write that succeeds against nothing is this repo's demonstrated failure mode.

Mechanics: [vitest-testing](../vitest-testing/SKILL.md). Assert-on-state: [test-strategy](../test-strategy/SKILL.md). Cases: [references/patterns.md](references/patterns.md).

## Before you call it done

```bash
npm run lint
npm run check:db-contract
```

Linking flows, care-context types, consent artefact handling, and FHIR bundle assembly:
[references/patterns.md](references/patterns.md).

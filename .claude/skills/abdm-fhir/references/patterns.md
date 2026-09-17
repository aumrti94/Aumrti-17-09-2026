# ABDM patterns — detail

## Care contexts

A **care context** is one episode of care the patient can discover and pull through their ABHA app.
Linking one announces to the national registry that records exist for this patient at this hospital.

`abdm-auto-link-care-context` links on clinical events, driven by an event type:

```typescript
type EventType = "opd_completed" | "ipd_discharged" | "lab_reported" | "radiology_reported";

interface CareContextMeta {
  reference: string;      // stable, e.g. `OPD-${sourceId}`
  display: string;        // human-readable, shown in the patient's ABHA app
  context_type: string;   // the FHIR profile this context resolves to
}
```

Points that matter:

- **`reference` must be stable and unique per episode.** It is the handle the gateway uses to
  request the record later. A reference built from a mutable field breaks retrieval after any edit.
- **`display` is patient-facing** — it appears in a consumer app, so it reads like
  "OPD Consultation — Dr Sharma, 12/03/2026", formatted `en-IN`. Never an internal id, never a
  clinical judgement the patient hasn't been told.
- The lookup is scoped `.eq("hospital_id", hospitalId)` under service role and returns `null` on a
  miss — a missing source row means "don't link", not "link with blanks".

Map event type to profile:

| Event | `context_type` |
|---|---|
| `opd_completed` | `OPConsultation` |
| `ipd_discharged` | `DischargeSummary` |
| `lab_reported` / `radiology_reported` | `DiagnosticReport` |
| Prescription issued | `Prescription` |
| Immunisation | `ImmunizationRecord` |
| Uploaded document | `HealthDocumentRecord` |

Auto-linking is convenient and it is still a disclosure: it requires consent and an audit entry
(`CARE_CONTEXT_LINKED`) exactly like a manual link.

## The linking flow

1. **Discovery** — the gateway asks whether records exist for a patient. Match on the demographics
   ABDM supplies; never over-match. Returning a patient who is not the one asked about is a data
   breach, so prefer no match to a probable one.
2. **Link init** (`abdm-hip-link-init`) — the hospital proposes a link; the patient confirms via
   OTP in their ABHA app.
3. **Confirmation** (`abdm-hip-callback`) — the gateway calls back. This endpoint is unauthenticated
   by JWT, so verify the gateway's signature and reject anything else with
   `GATEWAY_AUTH_REJECTED`.
4. **Data request** — the gateway requests records against a consent artefact. Check the artefact
   is present, unexpired, and covers this purpose and date range **before** assembling anything.
5. **Transfer** — FHIR bundle, encrypted with the requester's public key, then
   `HEALTH_RECORDS_SHARED` audited.

Every step is asynchronous and correlated by the gateway's request id. Persist it — without it a
failed transfer cannot be traced, and NHA's support process is built around that id.

## Consent artefacts

An ABDM consent artefact carries: patient, requester (HIU), purpose, the health-info types
permitted, a date range for the records, and an expiry for the consent itself.

Enforce all of it. The common mistake is honouring the expiry but ignoring the date range — sharing
records outside the permitted window is as much a breach as sharing after revocation.

Store artefacts so revocation can be applied retroactively to in-flight requests, and treat
`CONSENT_REVOKED` as immediate: stop sharing, do not finish a transfer already assembled.

ABDM consent is not DPDP consent and not treatment consent. Three separate artefacts; none implies
another. See [clinical-compliance](../../clinical-compliance/SKILL.md).

## FHIR bundle assembly

`abdm-fhir-package` builds bundles. Structure:

- Bundle `type: "document"`, with a `Composition` as the **first** entry.
- The `Composition` references `Patient`, `Practitioner`, `Encounter`, and the clinical resources —
  and every reference must resolve **inside** the bundle. A dangling reference fails validation at
  the gateway with a message that does not name the offending resource, so check locally first.
- `Practitioner.identifier` is the HPR ID; `Organization.identifier` is the HFR ID. Internal uuids
  are not acceptable identity to ABDM.
- Codings: SNOMED CT and LOINC where ABDM mandates them, ICD-10 for diagnosis (`@/lib/icd10Data`,
  `icdSearch`).
- Dates are ISO 8601 **in the FHIR payload** — this is the one place `formatDateIST` does not
  apply. Format for display, not for the wire.

`fhir-r4-server` exposes a read API for FHIR resources; `fhir-export` produces exports for
migration and patient data-portability requests (a DPDP right, not only an ABDM feature).

## HCX claims

Same shape as ABDM: JWE-wrapped FHIR over a gateway, Keycloak client-credentials auth, separate
staging and production realms.

- Resources are `CoverageEligibilityRequest`, `Claim`, `ClaimResponse`.
- Callbacks arrive at `hcx-callback-receiver` — unauthenticated by JWT, so verify the signature.
- Claim line items come from `bill_line_items`. `bill_items` does not exist; using it once submitted
  claims with an empty item list and they were accepted as zero-value.
- Eligibility (`pmjay-eligibility`, `cghs-eligibility`) is a **point-in-time** check. Re-verify at
  admission and again before claim submission — a card valid at registration can lapse mid-stay.

## Testing — detail

`src/lib/abdm-validators.ts` exports `validateAbhaId`, `validateAbhaAddress`,
`validateMobileForAbha`, `validateAadhaarFormat`, `validateHprId` and `formatAbhaNumber`. All are
pure, all return `{ valid, error? }` except `formatAbhaNumber` which returns a string. **None of
them is tested today** — there are no `*.test.ts` files under `src/` at all, and `package.json` has
no `test` script, so the runner is `npx vitest run`.

### Boundary cases

Each validator has exactly one accept band; test both sides of every edge, not the middle.

| Function | Reject below | Accept | Reject above / other |
|---|---|---|---|
| `validateAbhaId` | 13 digits | 14 digits, with and without dashes | 15 digits; any non-digit |
| `validateAbhaAddress` | 7 chars | 8 and 18 chars | 19 chars; leading/trailing `.` or `_`; `-` or `+` |
| `validateMobileForAbha` | 9 digits | 10 digits starting 6, 7, 8, 9 | 11 digits; starting 5 or 0 |
| `validateAadhaarFormat` | 11 digits | 12 digits starting 2–9 | 13 digits; starting 0 or 1 |
| `validateHprId` | 7 digits | 8 and 14 digits | 15 digits |

`validateAbhaAddress` splits on `@` and validates only the bare part, so `name@abdm` and `name` must
behave identically — assert both. `formatAbhaNumber` formats progressively as a user types: cover
every partial length (2, 3, 6, 7, 10, 11, 14) and an over-length input, which it truncates to 14.

### The format-only boundary is the assertion that matters

Neither `validateAbhaId` nor `validateAadhaarFormat` runs a checksum — no Verhoeff, no check digit,
nowhere in this repo. A syntactically plausible but entirely invented number **passes**. That is
correct behaviour: these are UX typo filters ahead of a gateway call, and only ABDM's
verify/exists call can establish that an identifier is real.

Write that as an explicit, named assertion — "a well-formed synthetic ABHA number passes local
validation" — so a later reader does not mistake it for a bug and tighten the validator into
rejecting legitimate edge cases. A validator that accepts everything passes every happy-path test;
only the reject cases prove it does anything.

### Synthetic identifiers only — no exceptions

Never use a real or realistic ABHA number, Aadhaar number or mobile in a fixture, a test name, an
inline comment, or an assertion message. Test data is copied into issues, PR descriptions and CI
failure output, none of which are PHI-safe surfaces. Use placeholders that could not be anyone's:

```typescript
const ABHA  = "91000000000001";   // 14 digits, obviously synthetic
const ADDR  = "test.user01@abdm";
const MOBILE = "9000000001";
const AADHAAR_SHAPED = "900000000001";  // 12 digits, never a real allocation
```

If a checksum is ever added to a validator, **construct** a value that satisfies the algorithm from
the algorithm itself — never borrow one that is known to work. "I need a valid number to test the
checksum" is the exact reasoning that puts a live Aadhaar into a repository, and once committed it
is in the history permanently.

### Consent and audit — assert the row, not the response

Both are "did this silently not happen" checks, and a green return value does not answer either.

- **Consent**: seed the scenario, then read the `abdm_consents` row back and assert `status`,
  `expiry`, `date_range_from`/`date_range_to` and `purpose_code` are what the flow was supposed to
  record. Assert the negative too: a request outside the date range, or against a `REVOKED` or
  `EXPIRED` artefact, shares nothing.
- **Audit**: assert the `abdm_audit_log` entry exists for the action. `logAuditEvent` never throws
  by design, so a broken audit write is invisible from the calling code — the only way to know it
  happened is to read the row. Assert the stored IP is the hash, never the address.

A write that succeeds against nothing is this repo's demonstrated failure mode, not a hypothetical:
the same shape already ran undetected across ~50 call sites of the NABH evidence logger.

## Checklist

- [ ] Identifiers validated client-side before any gateway call
- [ ] Consent artefact present, unexpired, and covering the purpose **and** date range
- [ ] `logAuditEvent` on every ABDM action; IP passed as `raw_ip` and hashed by the helper
- [ ] Gateway auth via `getAbdmToken` / `abdmHeaders`; payloads via `encryptWithAbdmKey`
- [ ] Callback endpoints verify the gateway signature; rejections logged
- [ ] `checkRateLimit` from `abdm-rate-limit.ts`, not the general limiter
- [ ] Care-context `reference` stable and unique; `display` patient-facing and `en-IN`
- [ ] FHIR references resolve inside the bundle; HPR/HFR ids as identity; ISO 8601 on the wire
- [ ] Sandbox vs production resolved from environment; mocks obviously synthetic
- [ ] No ABHA / Aadhaar / mobile in logs

# Aumrti Public API — Design Standard

**Status:** v1 draft · **Owner:** Arjun (Lead Architect) · **Security sign-off:** Ananya · **Platform sign-off:** Vikram

This is the rulebook. Every module that exposes an API conforms to it. The point is not elegance
for its own sake — it is that a hospital's integrator learns the contract **once** and every
subsequent module behaves the way they already expect. Thirty-nine modules each inventing their own
pagination is thirty-nine support tickets.

Companion document: [EVENT_CATALOG.md](./EVENT_CATALOG.md) for webhook events.

---

## 0. The one structural rule

**No module hand-writes an HTTP handler.** A module exposes an API by adding an entry to the route
registry at `supabase/functions/api-gateway/routes.ts`:

```ts
{
  method: "GET", path: "/v1/patients", scope: "read:patients",
  table: "patients", tenantColumn: "hospital_id",
  select: ["id","uhid","full_name","gender","dob","phone","created_at"],
  filters: ["uhid","phone","created_after"], sort: "created_at",
  phi: true, module: "patients",
  description: "List patients registered at this hospital.",
}
```

Everything else in this document is enforced by the gateway walking that registry. Three
consequences, and they are the reason for the design:

1. **Consistency is structural, not cultural.** A developer cannot accidentally ship an endpoint
   with offset pagination, because they never write the pagination.
2. **The OpenAPI spec is generated** from the registry by `scripts/generate-openapi.mjs`. Docs
   cannot drift from behaviour, because they are not maintained separately.
3. **CI enforces completeness.** A registry entry with no `scope`, no `description`, or `phi: true`
   with no documented DPDP purpose fails the build.

`select` is an allowlist and there is no `SELECT *`. A column added to a table for internal use does
not silently become public API the next day.

---

## 1. Resource naming

- `/v1/{plural-noun}` — `/v1/patients`, `/v1/appointments`, `/v1/bills`.
- Sub-resources nest **one level maximum**: `/v1/lab/orders`, `/v1/pharmacy/prescriptions`.
  Deeper nesting encodes a hierarchy that will change; use a filter instead.
- **No verbs in paths.** Not `/v1/cancel-appointment` — `PATCH /v1/appointments/{id}` with
  `{"status":"cancelled"}`. The exception is a genuine action that is not a state change on one
  resource, which takes a `POST /v1/{resource}/{id}/actions/{action}` form and must be justified in
  review.
- **Indian English**, matching the product: `/v1/anaesthesia-records`, not `anesthesia`.
- Identifiers in paths are UUIDs. Human identifiers (UHID, bill number) are **filters**, never path
  segments — they are hospital-scoped and not globally unique.

## 2. Authentication

```
Authorization: Bearer sk_live_<64 hex chars>
```

- The gateway SHA-256s the presented key and matches `api_keys.key_hash`. **The raw key is never
  stored** — it is displayed once at creation and is not recoverable. `api_keys.key_hash` carries a
  database CHECK that the value is a 64-char hex digest, so a UI regression cannot reintroduce
  plaintext storage.
- Keys are generated with `crypto.getRandomValues` (256 bits). Never `Math.random`.
- The prefix encodes the environment: `sk_live_` production, `sk_test_` sandbox. The mode is
  therefore legible wherever the key text appears — in a config file, a log, a support ticket.
- **The tenant comes from the key, never from the request.** There is no `hospital_id` parameter on
  any endpoint. A caller cannot ask for another hospital's data because there is no way to express
  the question.
- Revocation is immediate: `is_active = false` is checked on every request, not cached.

## 3. Scopes

Granted per key, enforced per route. Read and write are always separate — a Tally export needs
`read:bills` and must never be able to raise one.

| Scope | Grants | PHI |
|---|---|---|
| `read:patients` / `write:patients` | Demographics, UHID | ✔ |
| `read:appointments` / `write:appointments` | Appointment book | |
| `read:encounters` | OPD consultation records | ✔ |
| `read:admissions` | IPD admissions, beds, discharge | ✔ |
| `read:bills` / `write:bills` | Bills, line items, payments | |
| `read:lab` / `write:lab` | Lab orders and results | ✔ |
| `read:pharmacy` | Prescriptions, dispenses | ✔ |
| `read:masters` | Departments, services, doctors, rates | |

The canonical list lives in [`src/lib/apiPlatform.ts`](../../src/lib/apiPlatform.ts) and is shared
by the portal UI and the gateway. There is no `admin` scope: key management is a dashboard action
by a human admin, never an API action.

## 4. Errors

One shape everywhere. Stripe-style, because that is the vocabulary Indian integrators already have.

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "patient_not_found",
    "message": "No patient with that UHID in this hospital.",
    "param": "uhid",
    "request_id": "req_01JAV3K2QW8ZE4"
  }
}
```

| `type` | HTTP | Meaning |
|---|---|---|
| `authentication_error` | 401 | Key missing, malformed, revoked or expired |
| `permission_error` | 403 | Valid key, scope not granted, or plan does not include API access |
| `invalid_request_error` | 400 / 404 / 409 | Caller's fault — bad params, unknown resource, conflict |
| `rate_limit_error` | 429 | Over the per-key limit |
| `api_error` | 500 | Ours |

`message` is written for a human debugging at 2am and must never contain PHI — "No patient with
that UHID" not "No patient named Sunita Sharma". `request_id` is echoed in the `X-Request-Id`
response header and recorded in `api_request_log`, so support can trace any complaint to one row.

## 5. Pagination

Cursor, never offset.

```
GET /v1/patients?limit=50&starting_after=8f2c…
→ { "data": [ … ], "has_more": true, "next_cursor": "9a1d…" }
```

Offset pagination silently skips rows when the underlying set changes mid-walk. In a live OPD it is
changing constantly, so an offset-paged nightly sync loses patients — invisibly, and with no error
to investigate. Default `limit` 50, hard cap 100.

## 6. Idempotency

Every `POST` accepts an `Idempotency-Key` header. The gateway stores the key with the serialised
response in `api_idempotency_keys` for 24 hours; a replay returns the **original response** rather
than acting again.

This is not optional polish. Partner systems retry on timeout. Without it, a retried
`POST /v1/admissions` occupies two beds, and a retried `POST /v1/bills` raises two invoices against
one encounter — a GST filing problem, not just a data problem.

## 7. Versioning

- Major version in the path: `/v1`. **Never a breaking change within a major version.**
- Additive changes (a new field, a new optional filter) ship without notice. Clients must tolerate
  unknown fields.
- Breaking changes require a new major version, 180 days' notice, a `Sunset` response header on the
  old version, and Sanjay notifying every integrating partner directly.
- Minor dated behaviour changes may be pinned with `Aumrti-Version: 2026-08-24`. Unpinned callers
  get current behaviour.

## 8. Rate limits

Per key, per minute, tiered by subscription plan (`subscription_plans.api_rate_limit_per_min`).
Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`. Over the
limit returns `429` with `Retry-After`.

The limiter **fails closed**. This differs deliberately from the internal ABDM limiter in
[`_shared/abdm-rate-limit.ts`](../../supabase/functions/_shared/abdm-rate-limit.ts), which fails
open so a database hiccup never blocks a clinician mid-workflow. That reasoning does not transfer:
on a public endpoint, failing open during a database problem is exactly when an abusive caller
should be shed, not admitted.

## 9. PHI, DPDP and audit

- Every route with `phi: true` documents its **purpose** and **retention** in the registry entry.
  This is the DPDP Act 2023 purpose-limitation record, and CI fails without it.
- **No PHI in any log.** Not in `api_request_log`, not in `webhook_deliveries`, not in an error
  `message`, not in an edge-function `console.log`. Logs record ids, routes, statuses and latencies.
- **Field-level redaction.** Route scopes answer *which resource*; `read:patients` answers *may it
  see the person*. They are separate questions: a key with `read:appointments` legitimately needs
  the appointment book and does not thereby need the presenting complaint written on it.

  So a route declares `phiFields`, and the gateway blanks them unless the key **also** holds
  `read:patients`. The response carries `redacted_fields` naming what was withheld — silently
  nulling would leave a caller unable to tell "no allergies recorded" from "you may not see the
  allergies". Redaction rather than a 403, so a billing integration can still reconcile by id.

  This is why `/v1/lab/results` returns values only to a key holding `read:lab` *and*
  `read:patients`: seeing a named patient's potassium is seeing PHI, whatever the resource is
  called.
- **Every mutation writes `audit_log`** with `module = 'api'`, the acting `api_key_id` and the
  `request_id` in `details`. An API-initiated change to a clinical record must be as traceable as a
  human one, or NABH evidence has a hole in it exactly where automation touches the record.

## 10. Writes

Reads map cleanly onto tables. **Writes often do not**, and assuming they do is the single most
dangerous shortcut available here. Creating a patient is not an INSERT into `patients`: it is an
atomic UHID from `next_seq` under the hospital's configured prefix, then the insert, then PHI
encryption through `upsert-patient-phi`. A registry-driven insert would violate `uhid NOT NULL`
— or, if someone "fixed" that by generating one inline, would issue colliding UHIDs to different
people and leave phone numbers unencrypted and absent from the `phone_hash` index, making those
patients unfindable at reception.

So every write declares **where its invariants live**:

| `handler` | Meaning | Requirement |
|---|---|---|
| `"table"` | A plain insert/update is safe, because the **database** enforces the rules | Must list `dbEnforcedInvariants` naming the constraints/triggers relied on |
| `"<name>"` | Invariants live in application code | A named handler in `writers.ts` owns them |

Naming the invariants is not paperwork. It converts "I assume this is safe" into a claim a
reviewer can check. `POST /v1/appointments` qualifies for `"table"` because
`appointments_active_slot_uniq` prevents real double-booking, `validate_appointment()` constrains
status, and `trg_sync_slot_booked_count` recomputes the seat count — so the gateway deliberately
does **not** maintain that counter, and must not.

**Resources that allocate a statutory number always need a delegated handler.** `bills` must go
through `generate_bill_number()` and `admissions` through `generate_admission_number()`. A generic
insert would produce a GST document with a duplicate or missing invoice number. CI fails a
`"table"` write against either.

Other rules:

- **Unknown fields are rejected, never ignored.** A body containing `pnone` returns 400, not a 200
  with the phone silently absent. Same reasoning as unknown query parameters: the integrator ships
  the typo believing it works.
- `hospital_id`, `id`, `uhid`, `created_at` and `updated_at` are **never caller-writable**. The
  tenant is assigned from the authenticated key at exactly one place in the gateway.
- **PATCH is a partial update.** An empty body is a 400, not a no-op reported as success.
- Constraint violations become the status the caller can act on: `23505` → 409, `23503` → 400
  `related_record_not_found`, `23514`/`P0001` → 400 carrying the trigger's own message. A 500 here
  would say we broke when in fact the hospital's rules refused the request.
- **Audit and idempotency records are written after the row exists, and never fail the request.**
  Returning an error once the write has committed invites a retry, and the retry duplicates it.

## 11. Non-negotiables

1. No endpoint accepts a `hospital_id` parameter.
2. No `SELECT *` reaches a response. Columns are allowlisted in the registry.
3. No raw API key is ever written to storage or a log.
4. No route ships without a scope, a description, and a test.
5. No PHI route ships without a documented purpose and retention period.
6. Cross-tenant isolation is tested per route, not per module — Hospital A's key returns zero rows
   for a Hospital B resource id, on every route, every release.
7. No write ships as a bare table insert without naming the database constraints that make it safe.
8. Every write is audited to `audit_log` with `module = 'api'` and the acting key.

Rules 1, 2, 5, 7 and 8 are enforced mechanically by `src/lib/apiRegistry.test.ts`, which runs in
CI. They are not review conventions.

---

## Appendix — deployment notes

- The gateway must be deployed with `--no-verify-jwt`. API-key callers hold no Supabase JWT; the
  platform's default JWT gate would reject every request before the handler runs.
- `api.aumrti.com` is a Supabase custom domain in front of the functions host, rewriting
  `/v1/*` → `/functions/v1/api-gateway/v1/*`. Until that DNS exists, the portal shows the derived
  functions URL and states plainly that the gateway is not yet serving.
- ABDM/FHIR endpoints stay on [`fhir-r4-server`](../../supabase/functions/fhir-r4-server/index.ts).
  That is a mandated external contract with its own resource shapes and versioning; folding it into
  `/v1` would couple our version policy to NHA's.

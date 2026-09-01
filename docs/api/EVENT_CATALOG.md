# Aumrti Webhook Event Catalogue

**Status:** v1 draft · **Owner:** Arjun · **Security sign-off:** Ananya (payload PHI policy)

Companion to [API_DESIGN_STANDARD.md](./API_DESIGN_STANDARD.md). The canonical machine-readable
list lives in [`src/lib/apiPlatform.ts`](../../src/lib/apiPlatform.ts) — this document explains the
rules that list follows.

---

## 1. Naming

```
{domain}.{resource}.{past-tense-verb}
```

`billing.bill.paid` · `lab.result.published` · `ipd.admission.discharged`

The domain prefix is load-bearing. The nine flat names this replaces (`patient.created`,
`bill.paid`) have no room for thirty-nine modules: Radiology and Lab both have an `order.placed`,
OT and IPD both have a `procedure.completed`. Qualifying by domain is what keeps the namespace open
as modules are onboarded — renaming events after partners have subscribed is a breaking change with
no good migration.

**Past tense, always.** A webhook reports something that has already happened and committed. An
event named `bill.paying` describes an intention, and an intention can still fail.

### What a trigger keys on

Where a table's `status` has a check constraint and one consistent vocabulary (appointments,
bills), events key on the status transition. Where it does **not** — insurance claims and
pre-authorisations carry no constraint, and the application writes a mixed vocabulary across
screens — events key on a **column becoming non-NULL** instead: `settlement_date`, `approved_at`,
`submitted_at`, `validated_at`, `discharged_at`, `dispensed_at`, `is_signed`.

That is not a stylistic preference. A trigger keyed on an unconstrained status string is guessing,
and it stops firing silently the day a screen writes a spelling nobody reconciled.

## 2. The v1 catalogue

| Domain | Event | Fires when |
|---|---|---|
| Patients | `patients.patient.registered` | A patient record is created |
| | `patients.patient.updated` | Demographics change (name, phone, DOB, gender, email, address, blood group) |
| Scheduling | `scheduling.appointment.booked` | An appointment is created |
| | `scheduling.appointment.rescheduled` | Slot changes |
| | `scheduling.appointment.cancelled` | Cancelled by either party |
| | `scheduling.appointment.checked_in` | Patient arrives |
| OPD | `opd.encounter.started` | Consultation begins |
| IPD | `ipd.admission.created` | Patient admitted, bed occupied |
| | `ipd.admission.transferred` | Ward or bed change |
| | `ipd.admission.discharged` | Discharge completed |
| Billing | `billing.bill.created` | Draft bill raised |
| | `billing.bill.finalised` | `bill_status` becomes `final` |
| | `billing.bill.paid` | Fully settled — `payment_status` becomes `paid` **or** `advance_covered`, since a bill covered from the patient's deposit is equally settled |
| | `billing.payment.received` | Any payment, including part payments and advances |
| | `billing.refund.issued` | `payment_status` becomes `refunded` |
| Insurance | `insurance.pre_auth.submitted` | `submitted_at` is set |
| | `insurance.pre_auth.approved` | `approved_at` is set |
| | `insurance.pre_auth.rejected` | A rejection or denial reason is recorded |
| | `insurance.claim.submitted` | `submitted_at` is set |
| | `insurance.claim.settled` | `settlement_date` is set — including a settlement of zero |
| | `insurance.claim.denied` | A rejection notice date or denial code is recorded. **Starts the appeal clock** — check `appeal_deadline` |
| | `insurance.query.raised` | A TPA raises a query. **Time-critical** — see `response_deadline`; an unanswered query is a common cause of an otherwise valid claim being rejected |
| Laboratory | `lab.order.placed` | Test ordered |
| | `lab.sample.collected` | Sample taken |
| | `lab.result.published` | `validated_at` is set — **validation**, not result entry, is what makes a result clinically final |
| | `lab.result.critical` | `result_flag` becomes `CH` or `CL` — see §6 |
| Radiology | `radiology.order.placed` | Study ordered |
| | `radiology.report.published` | Report signed (`is_signed`) |
| Pharmacy | `pharmacy.prescription.created` | Prescription issued |
| | `pharmacy.dispense.completed` | `dispensed_at` is set |

Adding an event means adding it here, to `apiPlatform.ts`, and to the emitting trigger — in one
change. An event emitted but not catalogued is invisible to the hospitals who would subscribe.

## 3. Delivery guarantees

**At-least-once, ordered per endpoint, never lost.**

Events are written to `api_events` by a database trigger **in the same transaction as the business
write** — a transactional outbox. This is why an event can never describe a row that rolled back,
and can never be lost because an HTTP call failed halfway. Emitting from application code after a
commit gives neither guarantee.

A dispatcher runs each minute, claims undispatched events, and fans them out to every
`webhook_endpoints` row subscribing to that type.

**Receivers must be idempotent.** Every delivery carries a stable `event_id`; a retry re-sends the
same one. Deduplicate on it — network conditions guarantee you will eventually see a duplicate.

## 4. Payload shape

```json
{
  "event_id": "evt_01JAV3K2QW8ZE4",
  "type": "billing.bill.paid",
  "occurred_at": "2026-08-24T09:14:03.221Z",
  "environment": "production",
  "data": {
    "id": "8f2c…",
    "self": "https://api.aumrti.com/v1/bills/8f2c…"
  }
}
```

**Thin by default.** The payload carries ids, timestamps and non-PHI metadata plus a `self` link the
partner calls back with their own API key. That callback re-checks the key, its scopes and its
tenant — the webhook itself grants nothing.

A fat payload posts patient data to a third-party host with no further access check, where it lands
in their logs, their queue, and their backups. Under DPDP that is a disclosure the hospital is
accountable for.

Full-object payloads therefore require **both** `webhook_endpoints.include_phi = true` and a
recorded DPDP purpose for that endpoint. Ananya signs off per endpoint, not once globally.

## 5. Signing

```
Aumrti-Signature: t=1756029243,v1=5f8d…
```

HMAC-SHA256 over `{timestamp}.{raw_request_body}` using the endpoint's `secret`.

Verify by recomputing over the raw body — not the re-serialised JSON, whose key order and whitespace
will differ — and **reject timestamps older than five minutes**. The timestamp is inside the signed
string specifically so a captured delivery cannot be replayed later; a signature over the body alone
is valid forever and is not sufficient.

```ts
const [t, v1] = header.split(",").map(p => p.split("=")[1]);
if (Math.abs(Date.now() / 1000 - Number(t)) > 300) reject();
const expected = hmacSha256Hex(secret, `${t}.${rawBody}`);
if (!timingSafeEqual(expected, v1)) reject();
```

Use a constant-time comparison. A plain `===` on a hex string leaks the signature byte by byte
through timing.

## 6. Retries and failure

Backoff ladder: **1m, 5m, 30m, 2h, 6h, 24h**. Any 2xx is success; everything else retries.

Every attempt is recorded in `webhook_deliveries` (status code, duration, truncated response body),
which is what the portal's delivery log and its Replay button read.

After **15 consecutive failures** the endpoint is auto-disabled with `disabled_reason` set and the
hospital admin notified through `notification-dispatcher`. Exhausted deliveries land in the existing
`webhook_dlq` with `source = 'hospital_outbound'`.

Receivers should **acknowledge fast and process asynchronously**. The dispatcher times out at 10
seconds; work done synchronously inside that window becomes our latency problem and your retry
storm.

### Webhooks are not a clinical alerting channel

`lab.result.critical` is the sharp case. It exists so a partner system can react, but a critical
lab value reaches the treating clinician through the in-product alert path, which is
acknowledgement-tracked and NABH-evidenced. A webhook is best-effort delivery to a third party that
may be down for six hours. **No clinical safety path may depend on webhook delivery** — if the only
thing that surfaces a critical potassium is an HTTP POST to a vendor endpoint, the design is wrong.

## 7. Sandbox — not yet available

Every delivery carries an `environment` field, and in v1 it is always `"production"`.

There is no separate sandbox dataset: events are emitted by triggers on the live tables, so a
sandbox stream would have nothing to emit from. Building one means either a seeded parallel tenant
or a synthetic event generator, and until that exists a partner tests against a real hospital's
data or not at all.

Treat the `environment` field as reserved. Read it and branch on it — that costs nothing now and
means nothing changes on your side when sandbox events start arriving.

## 8. What v1 does not do

Stated plainly so nobody builds on an assumption:

- **Fat payloads are not implemented.** `webhook_endpoints.include_phi` exists and cannot be set
  without a recorded DPDP purpose, but the dispatcher sends the thin payload to every endpoint.
  The column is the gate for when fat payloads land, not a switch that currently does anything.
- **No sandbox stream**, as above.
- **No replay from the portal yet** — `webhook_deliveries` records every attempt, which is what a
  Replay button will read, but the button itself arrives with the portal rebuild.
- **Ordering is per dispatcher run, not guaranteed end-to-end.** Events are claimed in
  `occurred_at` order, but a delivery that fails and retries thirty minutes later will arrive
  after events that came behind it. Order your own processing by `occurred_at`, never by arrival.

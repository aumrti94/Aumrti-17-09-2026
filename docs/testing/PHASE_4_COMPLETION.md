# Phase 4 — Multi-tenant isolation: completion record

**Phase:** 4 of [PHASED_TEST_PLAN.md](PHASED_TEST_PLAN.md) §8 · **Date:** 2026-09-12
**Estimate in the plan:** 2.5 ew · "the risk every pod ranked first, now executable."

**Status: FULLY DONE, including a finding the plan's own checklist did not anticipate the scale
of.** All five plan bullets are green. The fifth — "a client-supplied `hospital_id` is never
trusted" — turned out to hide **24 real, currently-exploitable cross-tenant vulnerabilities**
across all 107 Edge Functions in this repo, audited to 100% coverage in two rounds. The worst
returned a hospital's live NHA/ABDM government gateway bearer token to anyone who named its id,
with zero authentication. All 24 are fixed and verified. **Per the plan's own rule, every
isolation failure found is S1 — no waivers** — see [KNOWN-BUG-126](KNOWN_BUGS.md) for the full
list and fix detail.

---

## 1. The five bullets

| # | Item | Status |
|---|---|---|
| 1 | pgTAP on `get_user_hospital_id()` edge cases | ✅ [00-get-user-hospital-id.sql](../../supabase/tests/isolation/00-get-user-hospital-id.sql) — 6/6 assertions, run against both a live seed and a freshly-reset, unseeded database |
| 2 | pgTAP on the `SECURITY DEFINER` NABH collectors — "the test that file's own header comment already claims exists" | ✅ [10-qi-collector-grants.sql](../../supabase/tests/isolation/10-qi-collector-grants.sql) — 5/5 assertions. Writing it found the claim was worse than untested: all 17 collectors had `EXECUTE` granted to `anon`/`authenticated` by Postgres default, never revoked. Fixed in [20261106000012](../../supabase/migrations/20261106000012_fix_qi_collector_function_grants.sql); logged as [KNOWN-BUG-004, resolved](KNOWN_BUGS.md) |
| 3 | Playwright: zero cross-visibility on the five hub tables, both hospitals | ✅ [isolation.spec.ts](../../e2e/isolation.spec.ts) — 5/5, one per hub table (`patients`, `clinical_alerts`, `bill_line_items`, `insurance_claims`, `nabh_evidence_log`), each asserting both an unfiltered read and a spoofed-`hospital_id` read return nothing of the other tenant's |
| 4 | Control-plane: admin access gated on `aumrti_admins`, never `hospital_id` | ✅ Verified directly against Postgres: `is_aumrti_admin()` is the only function referencing `aumrti_admins`, keyed on `auth.uid()`; a full-schema `pg_policies` scan found zero RLS policies anywhere hardcoding a `hospital_id` literal as an admin bypass |
| 5 | App-layer: a client-supplied `hospital_id` is never trusted | ✅ RLS-layer proven by isolation.spec.ts's spoofed-filter assertions. Service-role-layer (RLS provides **no** protection here — see the edge-function skill) needed a dedicated audit: **all 107 Edge Functions read, 24 had a real hole, all 24 fixed** — [KNOWN-BUG-126](KNOWN_BUGS.md) |

---

## 2. The finding nobody anticipated the size of

Bullet 5 was expected to be a spot-check. `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS entirely
(`rolbypassrls`), so for any Edge Function using it, the function's own code — not the database —
is the only thing standing between one hospital's data and another's.

**Round 1** read 29 of 107 functions in full, prioritized by data sensitivity (claims, billing,
patient/FHIR export, admin, AI-context, notification, ABDM linking), and found 13 vulnerable — bad
enough (a fully unauthenticated `fhir-r4-server` could bulk-export any hospital's patients) that
the sample's 45% hit rate made "the rest are probably fine" an unsafe assumption. **Round 2** read
the remaining 78 functions across four parallel audits (ABDM/clinical-AI, AI-platform/revenue-AI,
billing/payments/exports, auth/admin/platform-ops), reaching 100% coverage and finding 11 more.

**24 of 107 functions had no effective tenant check**, in four shapes:

| Shape | Functions |
|---|---|
| No auth check at all (11) | `fhir-r4-server`, `abdm-fhir-package`, `abdm-gateway-token`, `pmjay-claim-submit`, `esi-claim-submit`, `send-push-notification`, `insurance-automation`, `abdm-abha-verify`, `ai-clinical-guidelines`, `idsp-alert-submit`, `email-tally-xml` |
| Header present, never verified as a real user (2) | `hcx-claim-submit`, `pmjay-eligibility` |
| Real user verified, never checked against the request's `hospital_id` (9) | `gst-irn-generate`, `razorpay-lookup`, `create-razorpay-subscription`, `ai-nabh-assistant`, `donor-reengagement`, `ai-nabh-indicator-alert`, `daily-leakage-scan`, `ai-discharge-summary`, `ai-clinical-voice` |
| A hospital-scoped role treated as platform-wide (1) | `upsert-patient-phi` |

Two findings stand out even against that list:

- **`abdm-gateway-token`** had no authentication and returned a hospital's **live NHA/ABDM
  government gateway bearer token** to any caller naming its `hospital_id` — letting an outsider
  impersonate that hospital's HIP/HIU registration directly against the real government gateway.
- **`upsert-patient-phi`** — the file's own header calls it "the ONLY write path for encrypted PHI
  columns" — let any hospital's own `super_admin` decrypt, search, or overwrite ANY other
  hospital's patient PHI (phone, name, Aadhaar). The bug was a role check
  (`role !== "super_admin"`) written as if `super_admin` were a platform-wide role; it is actually
  a per-hospital role every hospital's own founding admin holds.

Also newly found: `ai-discharge-summary` had **zero** hospital filter on any of 8 parallel clinical
queries (allergies, DOB, vitals, labs, meds, radiology, ICD codes — a complete cross-tenant chart
read), and `daily-leakage-scan` returned **every hospital's** confidential unbilled-revenue figures
to any caller who invoked it with no body at all.

Every one of the 24 is fixed, verified by direct code inspection against the pattern already
correct elsewhere in this codebase (`abdm-hip-link-init`, `send-sms`): authenticate the caller with
their own JWT via the anon client, then confirm the caller's own `hospital_id` — read from
`public.users` keyed on `auth_user_id`, never trusted from the request — matches the `hospital_id`
the request names (or filter every query by it directly), before any service-role query runs. Six
functions needed a different shape:

- `insurance-automation`, `ai-nabh-indicator-alert`, `abdm-fhir-package`, `daily-leakage-scan` are
  also legitimately invoked internally (a DB trigger, pg_cron, or a scheduled scan) with the
  service-role key as bearer token; their gates accept that secret as an alternate valid caller.
- `abdm-gateway-token` and `generate-invoice` are internal-**only** (confirmed never called from
  `src/`), so those require the service-role secret exclusively.
- `ai-nabh-indicator-alert`'s manual path now requires `aumrti_admins`, matching its own comment's
  stated intent ("admin user") rather than any authenticated user.
- `upsert-patient-phi`'s cross-hospital path now requires `aumrti_admins` instead of the
  hospital-scoped `"super_admin"` role string.

Full narrative, file:line references, and the exact fix per function:
[KNOWN-BUG-126](KNOWN_BUGS.md).

Six lower-severity findings are logged open, not fixed in this pass —
[KNOWN-BUG-127 through 134](KNOWN_BUGS.md) — none of them a cross-tenant data leak (a missing
filter that's cosmetic to isolation, two open-relay/phishing-adjacent email endpoints, a functional
bug that fails *closed* rather than leaking, and one dead code path).

---

## 3. Verification

```
npm run check:rls-coverage   → 567 tables, all have RLS
npm run check:user-fk        → 40 repointed, 16 legitimate
npm run check:db-contract    → 555 tables, 117 functions, 107 edge functions, 1176 files resolve
npx eslint <all 24 fixed functions>  → 0 errors

supabase db reset             → exit 0, 619/619 migrations applied
npx playwright test isolation.spec.ts   → 5 passed
npx playwright test                     → 13 passed (5 isolation + 8 smoke, both tenants)

psql: pgTAP 00-get-user-hospital-id.sql   → 6/6, run against seeded AND freshly-reset DB
psql: pgTAP 10-qi-collector-grants.sql    → 5/5, run against seeded AND freshly-reset DB
```

Direct role-switched SQL (not just the pgTAP files) additionally confirmed, against the live
Tier-0 seed:
- `qi_collect_mom` raises `42501` for both `authenticated` and `anon` callers.
- `run_quality_indicator_collection` still returns a real result for a caller's own hospital
  post-fix (SECURITY DEFINER executes as the function owner, unaffected by the revoked grants on
  the functions it calls internally).
- The orchestrator still correctly rejects a cross-hospital caller with `42501` — the fix did not
  touch this pre-existing, already-correct check.

Every gate criterion from the plan:

| Gate criterion | Status |
|---|---|
| No cross-tenant read achievable on any of the five hub tables, at DB layer or control-plane layer | ✅ |
| The comment in `quality_indicator_collectors.sql` is now true | ✅ |
| Any isolation failure found is S1 — no waivers, phase cannot exit until fixed | ✅ 24 found, 24 fixed (KNOWN-BUG-126); 6 lower-severity, non-isolation findings logged open, not blocking (KNOWN-BUG-127–134) |

---

## 4. What this phase does not claim

- All 107 Edge Functions were read for this specific vulnerability class (a service-role query
  trusting a client-supplied `hospital_id`/resource id without verifying the caller's own
  hospital). That is 100% coverage **for this one bug shape** — it is not a general security
  audit of every function's other possible defects (input validation, rate limiting, injection,
  etc.), which was out of scope here.
- None of the 24 fixes were re-verified against a live HCX/PMJAY/Razorpay/NHA sandbox call — those
  gateways are not reachable from this local environment. The fix is the authorization gate ahead
  of each external call; the call itself is unchanged.
- KNOWN-BUG-123 (plaintext Aadhaar in `PatientRegistrationModal.tsx`) remains open and unrelated
  to this phase's scope — it is a write-path defect, not a cross-tenant isolation failure.

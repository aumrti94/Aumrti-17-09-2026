---
name: tenant-isolation-testing
description: Use when writing, reviewing, or asserting a multi-tenant isolation claim — a two-hospital test, an RLS policy assertion, a seed fixture for a second tenant, or an Edge Function that runs on the service-role key. Covers why a single-tenant manual check proves nothing, what check:rls-coverage does and does not prove, the SQL harness pattern already in supabase/tests/, and the no-PHI fixture rule.
---

# Testing that tenant isolation holds

How to *write* a correctly scoped query is [multi-tenant-data-access](../multi-tenant-data-access/SKILL.md)'s
job. This skill is the other half: proving with real rows, at runtime, that the scoping actually
holds. Those are different claims. Every isolation bug this codebase has shipped was in code that
looked correctly scoped at review time and passed a manual check in one hospital.

## What exists today — verify before you claim otherwise

Checked against the repo, not against `docs/testing/`:

- **Zero `*.test.ts(x)` files exist under `src/`.** There are no automated isolation tests today.
- **`package.json` has no `test` script.** Vitest runs only via `npx vitest run`.
  `vitest.config.ts` is real (jsdom, globals, `src/test/setup.ts`) but declares no thresholds.
- **CI runs no tests.** `.github/workflows/ci.yml` has one job, `checks`: lint, the five `check:*`
  scripts, build. Nothing in it executes a test.
- **`@playwright/test` is installed; there is no `playwright.config.*` and no `e2e/`.** E2E is
  not wired.
- **`supabase/tests/booking-engine/` is the only automated suite in the repo** — 8 SQL files, run
  by hand. Not referenced by any npm script or CI step.
- **No staging environment and no second test tenant exist.** Both are hard blockers, below.

So: pgTAP-style SQL locally and pure-logic unit tests are available today. A live two-tenant
assertion against a deployed database is **blocked** until a second tenant exists. Say which one
you mean; do not let "isolation is tested" cover both.

## The two-hospital pattern — assert the negative

The naive version is worthless:

```typescript
// WORTHLESS — passes on an empty result set
expect(rows.every(r => r.hospital_id === HOSPITAL_A)).toBe(true);
```

`Array.every` on `[]` is `true`. If the query is broken, if the fixture never seeded, if the role
has no grant — the assertion still passes. This is the single most common way an isolation test
lies.

A real one seeds **hospital B with rows that would match the filter if isolation failed**, then
asserts their absence:

```typescript
it("does not return hospital B's admissions to a hospital A user", async () => {
  await seedAdmission({ hospital: HOSPITAL_B, ward: "ICU", status: "active" }); // would match
  await seedAdmission({ hospital: HOSPITAL_A, ward: "ICU", status: "active" });

  const rows = await fetchActiveAdmissions(HOSPITAL_A);

  expect(rows.length).toBeGreaterThan(0);                           // fixture actually landed
  expect(rows.some(r => r.hospital_id === HOSPITAL_B)).toBe(false); // the real assertion
  expect(rows.every(r => r.hospital_id === HOSPITAL_A)).toBe(true);
});
```

Three assertions, in that order. The non-empty guard is not ceremony — it is what stops the other
two from passing vacuously. Cover writes the same way: acting as A, attempt an update naming B's
row id and assert zero rows affected, not just that no error was thrown.

## What the check scripts prove — and what they do not

All three are heuristic text scans over `supabase/migrations/`. None of them runs a query.

| Script | Proves | Does **not** prove |
|---|---|---|
| `check:rls-coverage` | Every `CREATE TABLE`d name has an `ENABLE ROW LEVEL SECURITY` somewhere in the history | That a policy exists, that its predicate is `hospital_id = get_user_hospital_id()`, or that anything reaches it |
| `check:user-fk` | No `*_by` column declares `REFERENCES auth.users(id)` | Anything about `.eq("auth_user_id", …)` in query code — that predicate is unguarded |
| `check:db-contract` | Every `.from()`/`.rpc()` name resolves to a real object | That the call is tenant-scoped at all |

A table can pass `check:rls-coverage`, have RLS enabled, have a policy of `USING (true)`, and leak
every row in the deployment. Structural, not behavioural. Both allowlists (`check-rls-coverage.mjs`,
`check-user-fk-convention.mjs`) are the one place each check can be silently defeated — adding an
entry is a decision, not a formality.

## The harness pattern already in the repo

`supabase/tests/booking-engine/00-schema-core.sql` builds a **minimal stand-in of only the tables
under test** — seven: `hospitals`, `departments`, `users`, `patients`, `service_master`,
`opd_tokens`, `hospital_settings` — with the same column names and types as the real migrations.
It does not replay 612 migrations. That is the model to copy: stand up the smallest schema your
assertion needs, seed it, assert, throw it away.

These files are plain `psql` scripts (`\set`, a temp `results` table, `\echo` of PASS/FAIL counts),
despite being described elsewhere as pgTAP — no `plan()`/`is()` anywhere, and `12-holds.sql`'s
`expect_ok` is a local `pg_temp` helper, not pgTAP's. CLAUDE.md says they are "run manually per
`supabase/MIGRATION_RUNBOOK.md`"; that runbook does not mention them at all. Run them by hand:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/tests/booking-engine/00-schema-core.sql \
  -f supabase/tests/booking-engine/10-fee-parity.sql
```

Two gaps to close if you extend this for isolation: **the stand-in tables have no RLS enabled and
the suite never switches identity**, so it exercises pricing logic, not isolation. An isolation
file must add both — `ALTER TABLE … ENABLE ROW LEVEL SECURITY`, the real policy text, and a stub
`auth.uid()` driven by `set_config('request.jwt.claims', …, true)` so `get_user_hospital_id()`
resolves per session. Copying the policy into the harness means you are testing a copy; keep the
predicate string identical to the migration's and say so in a comment.

Be honest in your report: this runs manually, on a developer's machine, and CI will not notice if
it breaks.

## Service-role bypass — the sharp edge

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS entirely. In an Edge Function the explicit
`.eq("hospital_id", …)` filter is the **only** isolation there is, so **an RLS-based test proves
nothing about that code path**. A passing two-hospital RLS test plus a service-role handler that
forgot its filter is a full cross-tenant read.

Service-role paths need their own test, and it does not involve RLS: invoke the handler with a JWT
for hospital A, having seeded a matching row under hospital B, and assert B's row is absent from
the response and untouched in the database. Also assert that a request naming B's id in the body or
query string is rejected rather than served. See [edge-function](../edge-function/SKILL.md).

## The Tier-0 seed fixture

Built once, **as code, not clicked through a UI** — a fixture that only exists in someone's dev
database cannot travel into staging, a second tenant, or CI. Minimum for any module test to reach
its own logic rather than dying in a guard:

- one `hospitals` row;
- one active `users` row per role the test needs (`role`, `is_active`, and `auth_user_id` set);
- one `departments` row;
- base `service_master` rates, with `gst_applicable` / `gst_percent` set;
- `hospital_settings` entries the module reads;
- `hospital_feature_overrides` and `hospital_module_entitlements` for the module — otherwise the
  control plane hides it and the test fails before touching the code you meant to test.

Parameterise the hospital id. A fixture that can be called twice with different ids *is* the
second tenant, the day one exists.

### `auth.users` vs `public.users` in fixtures

They diverged at migration `20260322111223`. `get_user_hospital_id()` is
`SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()` — so a fixture that sets
`public.users.id` to the auth uid and leaves `auth_user_id` null produces a test that passes
against a shape **no account created after that migration can have**. Seed `auth_user_id`
explicitly and make it differ from `id`, so the test would catch an `.eq("id", user.id)` lookup.
`check:user-fk` guards schema FKs only — never this predicate.

## Fixture data — no PHI, ever

Test data gets pasted into issues, CI logs, and screenshots. No real patient data, and nothing that
*looks* real: no plausible Aadhaar, ABHA address, or mobile number. Use obvious placeholders —
`9000000001`, `Test Patient A1`, `hospital-a` / `hospital-b` as literal names. A synthetic-looking
Aadhaar is still a DPDP incident when someone assumes it is one.

## Before you call it done

```bash
npm run check:rls-coverage && npm run check:user-fk && npm run check:db-contract
npx vitest run        # no `npm run test` in this repo
```

Then state the claim precisely: which tables, which paths (RLS or service-role), run where, gated
by what. "Isolation is enforced" is not a finding. "Two-hospital assertion on `admissions`, run
manually via psql, not in CI" is.

Suite conventions and what to test first: [vitest-testing](../vitest-testing/SKILL.md).
Where this sits in the overall plan: [test-strategy](../test-strategy/SKILL.md).

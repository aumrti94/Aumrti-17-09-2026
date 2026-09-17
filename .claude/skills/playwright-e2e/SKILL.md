---
name: playwright-e2e
description: Use when wiring up Playwright for the first time, writing or debugging an end-to-end journey spec, triaging a flaky E2E test, or authoring a manual/UAT script for hospital staff. Covers what must exist before a spec is worth writing (config, e2e dir, storageState auth, a second seeded tenant), page objects as the UI inventory, two-hospital runs, and state assertions. Load before creating any E2E file.
---

# Playwright E2E

## E2E is not wired up

Verified 2026-09-11. Trust this over `docs/testing/*.md`.

| Thing | State |
|---|---|
| `@playwright/test` ^1.57.0 | Installed as a devDependency |
| `playwright.config.*` | **Does not exist** |
| `e2e/` directory | **Does not exist** |
| `test:e2e` npm script | **Does not exist** — `package.json` has no `test` script of any kind |
| Staging environment | **Does not exist** |
| Second seeded tenant | **Does not exist** |

So Playwright is a dependency that was added and never wired up. **E2E gates nothing because E2E
does not run.** Unit tests gate nothing either, and coverage has no threshold — see
[vitest-testing](../vitest-testing/SKILL.md). Report all three plainly; do not describe a spec you
wrote as "passing CI".

## What wiring requires, before a single spec is worth writing

A spec written against missing infrastructure is a spec that gets deleted. In order:

1. **`playwright.config.ts` at the repo root.** `testDir: "./e2e"`, a `baseURL` from an env var
   (never hardcoded — the dev server is `http://localhost:8080`), a tablet-sized viewport since
   this app is tablet-first at the 768px breakpoint, and `trace`/`video`/`screenshot` on
   `retain-on-failure`. Evidence on failure is non-negotiable here.
2. **An `e2e/` directory, outside `src/`.** `vitest.config.ts` includes
   `src/**/*.{test,spec}.{ts,tsx}` — a Playwright spec placed under `src/` gets executed by vitest
   and fails on missing globals. Note that `scripts/check-db-contract.mjs` already lists `e2e` in
   its `SCAN_DIRS`, so the moment the directory exists, every `.from()`/`.rpc()` name in it is
   contract-checked in CI. That is a benefit; write query names accordingly.
3. **`test:e2e` in `package.json`**, so the command is discoverable rather than folklore.
4. **Auth as `storageState`, one file per role**, produced by a setup project that logs in once.
   Roles come from `src/lib/routeRoles.ts` — a journey needs the roles it actually acts as
   (doctor, nurse, billing, pharmacy), not one admin who can do everything, or role gating goes
   untested by construction.
5. **A second seeded tenant**, hospital B, with data that *would* match hospital A's filters. This
   is the one item that cannot be faked, and it is what makes the isolation claim real.
6. **A Tier-0 seed fixture as code** — one hospital, one user per role, a department,
   `service_master` rates, GST config, module entitlements. Not a manual click-through; it has to
   be re-runnable. See [test-strategy](../test-strategy/SKILL.md) for the Tier-0/Tier-1 split.

Items 1–4 are unblocked today. Items 5–6 are the real cost, and they belong to `data` (Meera), not
to this pod — request them, do not write the migration.

## Fixtures: fixed values, never random

Anything feeding a calculation or a rule — rates, quantities, GST percentages, dates, payer type,
allergies — is a **fixed committed value**, so expected results are known constants. Only cosmetic
fields (name, address) may be generated. If the rate is random you can only assert `total > 0`,
which is exactly the weak assertion that passes on every silent defect this suite exists to catch.

No PHI, and nothing PHI-shaped: `9000000001`-style mobiles, never a real-format Aadhaar, in
fixtures and in screenshots alike.

## Page objects double as the UI-element registry

Every layer of this app has a registry that can generate a coverage inventory — modules from
`src/lib/modules.ts`, settings from `src/lib/settingsCatalog.ts`, tables from
`src/integrations/supabase/types.ts`, endpoints from `supabase/functions/*`. UI elements are the
one layer with none.

So a page object under `e2e/pages/` is not just a locator helper — it is the inventory entry for
that screen's interactive elements. Build them per screen, exhaustively, and the missing registry
gets built as a side effect of the tests rather than as a document someone has to maintain by hand.

Build the **journey segments** as page objects/helpers first — registration, encounter, clinical
documentation, orders, charge posting, billing, claim, discharge — then assemble journeys from
them. A journey becomes a short declaration rather than 400 lines of fresh script, and the 17th
journey costs almost nothing. Writing each journey standalone produces a suite that collapses under
duplicated registration steps by month three.

## The three journey spines

Chosen to cover all five connectivity hubs; the reasoning is in
[test-strategy](../test-strategy/SKILL.md).

| Spine | Path | Order |
|---|---|---|
| **B — IPD insured** | Admit (TPA/scheme) → ward → drugs → OT → discharge summary → claim → reconciliation | **First** — crosses all five hubs |
| **A — OPD cash** | Walk-in → consult → lab order → result → auto-bill → payment | Second |
| **C — Emergency** | Triage → MLC → admission → ICU | Third |

Negative forks hang off each spine rather than becoming new journeys: TPA underpays; unbilled
service at discharge; duplicate charge post; allergy blocks dispensing.

## Run every journey twice, as two hospitals

Two `storageState` files, one login per tenant, same spec parameterised. Isolation — the top-ranked
risk and the one a single happy path structurally cannot detect — then comes nearly free from
infrastructure the journeys already need.

Assert the negative explicitly. "All returned rows belong to A" passes trivially on an empty
result. Seed B with rows that *would* match A's filter, then assert they are absent.

## Assert state at every step, never completion

```typescript
// after posting a lab result
const lines = await dbQuery(hospitalA, "bill_line_items", { source_module: "lab" });
expect(lines).toHaveLength(1);            // not .toBeGreaterThan(0)
expect(lines[0].total_amount).toBe(450);
```

A UI action is not the assertion; the row it was supposed to produce is. Check `bill_line_items`
count and amount, `clinical_alerts` count after the same trigger fires twice, the
`nabh_evidence_log` row for a clinical action, and the claim-vs-bill balance. `expect(page).toHaveURL()`
proves navigation happened, nothing more — every known defect in this codebase navigated fine.

## Flaky triage

A flaky test is **quarantined and root-caused**, never retried to green. Retries mask exactly the
race conditions a nurse hits at a busy station. Triage order: waiting on a fixed timeout instead of
a state-based locator; test data leaking between specs because a seed is not reset; and genuine app
races — the last is a bug report, not a test fix. A red main-branch suite is stop-the-line,
surfaced immediately, never muted.

## Manual and UAT scripts are the same artifact

A journey spec is legible to hospital staff, which is why the manual script is the same document,
not a parallel one. Manual owns what only it can: exploratory first pass on a journey nobody has
automated, clinical sensibility of the screen order, Zero Scroll / 1-2-3 Click / Clarity on a real
tablet rather than a resized browser, printed output, and anything needing a real external sandbox.

**Manual does not automatically catch silent failures.** A tester clicking through sees "Settings
saved successfully" and ticks the box. So a manual script must contain **verification steps**, not
just click steps: "Open Billing → confirm the lab charge appears **once**, at ₹450." A script that
is only a list of clicks is a demo, not a test.

Once a journey is automated, manual stops re-running it and moves to the next frontier — Playwright
owns the regression from then on. Every case, manual or automated, uses the same eleven-field record
and the same evidence rule: no `FAIL` without Actual Result, console error, and a screenshot, plus
trace and video for an automated failure.

---
name: test-strategy
description: Use when deciding what to test and in what order — planning coverage for a module or journey, writing or reviewing test cases, judging whether an existing test actually proves anything, or answering "is this tested enough to ship". Framework-agnostic: it governs what to assert, not how to write it. Load before authoring test cases, before scoping a test plan, and before signing off on coverage.
---

# Test strategy

What to test, in what order, and — the part that decides whether any of it is worth running — what
to assert. Framework mechanics live elsewhere: [vitest-testing](../vitest-testing/SKILL.md) for
unit and component, [playwright-e2e](../playwright-e2e/SKILL.md) for end-to-end and UAT.

**What gates today: nothing.** No tests run in CI, no coverage threshold exists, and E2E is not
wired up. Every priority below is a judgement about risk, not an enforced rule — state it that way.

## The central rule — "the journey completed" is never the assertion

Every defect found in the prior analyses of this codebase was **silent**. Not one was a crash:

| Defect | What it looked like at runtime |
|---|---|
| `notification_config` read by nothing | The form saved successfully |
| Duplicate `clinical_alerts` from the lab TAT panel | Alerts were created — just N of them |
| Leakage scanner's substring matching | The scan completed and reported a clean bill |
| `bill_status = 'insurance_pending'` never set | Bills carried a valid status |
| Bill `balance_due` vs claim outstanding unreconciled | Both numbers rendered correctly |
| `nabh_criteria` never seeded — ~50 call sites | Every call "succeeded", updating zero rows |
| Service rate lookups missing | Bills generated — at ₹0 |

A test asserting "it ran without error" **passes on every row of that table.** So the assertion is
on **resulting state**, never on completion:

- After a lab result posts → **exactly one** `bill_line_items` row, with the right
  `source_dedupe_key` and the right amount. Run the step twice; still exactly one.
- After an OT case closes → a `nabh_evidence_log` row exists, with the criterion you expect.
- After the alert condition fires → **exactly one** `clinical_alerts` row.

"Exactly one, with the right value" is the assertion that catches this class. "It didn't throw"
catches none of it. Applies identically to a unit test, a Playwright spec, and a manual script.

## Journey-led, because the architecture is hub-shaped

The modules registered in `src/lib/modules.ts` do not connect category-to-category — the ten values
of its `ModuleCategory` type are a grouping, not a data-flow graph. Almost all cross-module traffic
flows through five hubs:

| Hub | Written by | Read by |
|---|---|---|
| `bill_line_items` (+ `source_module`, `source_dedupe_key`) | Clinical, Diagnostics, Surgical, Pharmacy, Specialized | Finance, Analytics |
| `clinical_alerts` | Nearly every module | Notifications, Analytics |
| `insurance_claims` | Insurance/TPA, scheme modules | Accounts, Analytics |
| `nabh_evidence_log` | Nearly every clinical action | Quality & NABH, Analytics |
| `patients.id` as `patient_id` | Everything | Everything |

A real hospital journey — admit → treat → order → dispense → bill → claim → discharge — crosses all
five in one pass. Module-by-module testing hits each hub repeatedly from one side and never tests
the handoff. Journey-led tests the handoffs by construction: the unit of testing matches the unit
of risk. It also produces an artifact hospital staff can read, which is the UAT script too.

## Negative cases are journey forks, not invalid input

Rejecting bad input is the least interesting negative at this level. The valuable ones are where a
real journey legitimately diverges, because that is where the business rules live:

- Documented allergy present → does dispensing actually **block**? And if the interaction lookup
  fails, does it block or silently allow?
- Bill unpaid → does the payment gate stop lab sample collection, and is an override audited
  *before* the service proceeds?
- TPA approves less than claimed → does the underpayment stay visible, or get quietly zeroed?
- PMJAY/CGHS scheme patient → is nursing correctly **absent** from the bill, per the bundling rule?
- Discharge attempted with unbilled services → does the pre-discharge gate hold?

Each is a branch off one spine, not a separate journey. That is what keeps positive/negative
tractable instead of doubling the count.

## Risk order

Rank by what a defect costs and whether it is recoverable, not by volume or by ease.

1. **Patient safety** — drug interaction and allergy checking (`src/lib/drugSafetyCheck.ts`),
   deterioration scoring (`src/lib/news2.ts`), `src/lib/clinicalCalculators.ts`. A missed
   interaction is unrecoverable.
2. **Multi-tenant isolation** — one hospital seeing another's patients ends a pilot. A single
   happy path in one tenant structurally cannot detect it; the claim needs a two-hospital test.
3. **Revenue** — `billTotals`, `billMoney`, `gstRules`, `gst`, `chargePosting`, `insurance_claims`
   reconciliation. Recoverable, but only if someone notices, and the leakage defects above were
   specifically the ones nobody noticed.
4. **Everything else**, ratcheting.

## Unit tests are first, not underneath

This is a sequencing claim, not a layering one. Journey and isolation tests need a staging
environment and a second seeded tenant. **Neither exists.** A journey-first plan is therefore
blocked on infrastructure from day one.

The calculation surfaces need none of it. `computeBillTotals`, `getRoomChargeGSTRate`, `splitGst`,
and every `Calculator.calculate` in `clinicalCalculators.ts` are pure and testable today. Start
there *in parallel* with building the seed/staging infrastructure the journeys need. By the time
journeys can run, the arithmetic is already covered — which frees the journey tests to assert on
handoffs rather than re-verifying maths through a slow UI. That is what makes journey-led fast
rather than merely ambitious.

(`checkDrugSafety` is the exception in tier 1: it queries Supabase, so it needs mocking, not a
pure-function test.)

## Prerequisites — two tiers, not one flat "configure everything"

Configuring every module's settings before testing any module is the wrong prerequisite. A
setting can be fully configured, save cleanly, and **do nothing** — `notification_config` is the
confirmed example. Bulk-seeding produces data that looks like readiness without proving any of it.

The repo already contains the right pattern: `supabase/tests/booking-engine/00-schema-core.sql`
builds a minimal stand-in of only the tables under test rather than the whole schema.

- **Tier 0 — global, built once, as code.** One `hospitals` row; one active user per role a test
  acts as; one department; `service_master` rate entries for whatever gets billed; GST
  configuration; module entitlements set so the control plane does not block the module before the
  test reaches it.
- **Tier 1 — per module, seeded with that module's tests.** Notification routing, escalation rules,
  TPA-specific settings, a specialty's own configuration. Colocated with the test, not front-loaded.

**The rule that makes Tier 1 worth anything:** a setting under test is seeded to **two** values and
the module's behaviour is asserted to differ. Not "the settings row saved" — that passes on a dead
config. If a setting has no verified reader, that is a finding to raise before writing its fixture,
not a thing to test around.

## The inventory is generated, never hand-maintained

"Don't miss anything" is only true if the checklist is generated from the same registries the app
runs on, so a new module appears on it automatically:

| Layer | Registry already in the repo |
|---|---|
| Modules | `src/lib/modules.ts` (`ALL_MODULES`) |
| Settings screens and fields | `src/lib/settingsCatalog.ts` (`SETTINGS_CATALOG`) |
| Tables and columns | `src/integrations/supabase/types.ts` (generated) |
| Server endpoints | the `supabase/functions/*` directory listing |
| Cross-module handoffs | `source_module` / `source_dedupe_key` columns |

The one layer with no registry is UI elements — that gets built as Playwright page objects, which
is scaffolding rather than a document. Sort the resulting matrix by the risk order above.

## The test-case record

One format, no ad-hoc variants. Eleven fields, every case, manual or automated: ID · Module ·
Journey/Segment · Preconditions (which seed tier) · Steps · Test Data · Expected **State** (not
"expected behaviour") · Actual Result · Status · Evidence · Owner.

A `FAIL` is not loggable without evidence — Actual Result, console error, and a screenshot; an
automated failure adds trace and video. Test data is synthetic only, never real PHI, in any case,
fixture, or screenshot.

Route drug-safety and clinical acceptance criteria to `clinical` (Priya); route PHI-in-test-data
questions to `security` (Ananya). Neither QA layer owns whether a clinical ruleset is medically
correct — that is a licensed clinician's sign-off, and it escalates rather than getting asserted.

# Aumrti Phased Test Plan — Zero Coverage to Go-Live

**Status:** Executable plan. Supersedes the 2026-09-10 draft of this file.
**Date:** 2026-09-11
**Deliverable owner:** quality-pod
**Model:** Each phase writes its tests, runs them, fixes what they find, and passes a written exit
gate before the next phase opens. Remediation is the second half of every phase, not a separate
track and not a cleanup at the end.

**What changed from the 2026-09-10 draft.** That draft was structurally sound and is largely kept.
It was blocked on six open items and carried no sizes, which made it an ordered list rather than a
schedule. This version closes eleven of those decisions against verified repo evidence (§2), leaves
three genuinely escalated (§3), pins the mock-data architecture the whole E2E track depends on
(§5), gives every phase mechanically checkable entry and exit criteria, and attaches
engineer-week estimates so the plan can be divided by whatever capacity is assigned.

**Coverage amendment, same date.** The first version of this rewrite took the journey-and-hub
model at face value and, in doing so, reached go-live covering **27 of 67 modules**, with no
component-test tier, no performance budget, no penetration test, no AI clinical-output governance,
and no automated check on the three CLAUDE.md design laws — several of which pods had named as
blockers in the earlier documents and which were then silently dropped during synthesis. Phase 5.5
(§8) and the tightened Phase 10 exit gate close those. Blood Bank cross-matching, which the
risk ranking had left in the long tail, moves into the patient-safety tier (D10).

**Sequencing amendment, same date.** Both earlier versions ordered the journey phases purely by
irreversibility, inherited from the taxonomy. Checked against how a hospital actually switches on —
Settings → OPD → Pharmacy → Lab → Radiology → IPD → Insurance → Daycare — that ordering put **OPD,
the front door and highest-volume module, in Phase 10: journey-untested at go-live.** Phase 7.5
(§8) now tests the adoption spine ahead of the statutory tier. Phases 0–6 are unchanged; they are
ordered by dependency and blast radius rather than by module, and that ordering was not the
problem. See D7.

**Provenance note, stated plainly.** The plan to have six specialist pods ratify §2 was attempted
twice and died at an API session limit both times — once on 2026-09-10 (recorded at
[REVIEW_BEFORE_PHASING.md](REVIEW_BEFORE_PHASING.md) §"Process note") and again on 2026-09-11. The
decisions in §2 are therefore **written against direct repository verification, not pod output.**
Each one names the evidence and the owner who must ratify it. Treat the "Ratifier" column as
outstanding, not done.

---

## 1. Verified ground truth

Counted from the repo on 2026-09-11. Every number below was re-derived, not copied from the
earlier documents.

| Surface | Count | Current coverage |
|---|---|---|
| Edge functions (`supabase/functions/`) | 109 | 0 |
| Pages (`src/pages/**/*.tsx`) | 217 | 0 |
| Components | 568 | 0 |
| Migrations | 612 | 8 pgTAP files, all `booking-engine` |
| `src/lib` logic files | 187 | 0 |
| Modules in `ALL_MODULES` | **67** | 0 |
| Test files under `src/` | **0** | — |

**Module count correction:** CLAUDE.md says 61, the analysis docs say ~65, the registry
[modules.ts](../../src/lib/modules.ts) holds **67** — Operations 15, Specialized 13, Clinical 13,
Finance 9, Analytics 7, Patient 3, Surgical 2, Pharmacy 2, Diagnostics 2, Settings 1. Phase 0 pins
this to generated output so it can never drift again, and corrects CLAUDE.md.

**Harness state.** `@playwright/test` ^1.57.0, `vitest` ^3.2.4, `jsdom` ^29.1.1,
`@testing-library/react` ^16, `@testing-library/jest-dom` ^6.6, `@vitest/coverage-v8` ^3.2.6 are all
installed. [`src/test/setup.ts`](../../src/test/setup.ts) survived the 2026-09-05 purge.
[`vitest.config.ts`](../../vitest.config.ts) is valid, with a v8 reporter and **no `coverage.include`
and no thresholds**. There is no `test`, `test:watch`, `test:coverage` or `test:e2e` script in
`package.json`, no `playwright.config.ts`, and no `e2e/` directory.

**Two gaps the earlier docs missed:** `@testing-library/user-event` is **not installed** (needed by
any component test that types into a field), and no fixture/mocking library is installed. The
"one line of JSON from running" claim is one line plus one dependency.

**CI state.** [ci.yml](../../.github/workflows/ci.yml) runs lint → `check:rls-coverage` →
`check:user-fk` → `check:db-contract` → `check:openapi` → `check:lab-catalog` → build. It runs no
tests, and the job is honestly named `checks` rather than `test`.

---

## 2. Decisions now made

Eleven items that blocked the draft. Each is a call plus the evidence behind it. **None is final
until its ratifier signs.**

### D1 — `alert_escalation_rules` is the canonical alert-routing config

**Call:** `alert_escalation_rules` is canonical. `hospital_settings.notification_config` is
retired. **Ratifier:** clinical-pod + Vikram (CTO), as a cross-module architecture call.

**Evidence:** `notification_config` appears in exactly two places in the entire repo, both inside
its own defining file [notificationConfig.ts:2](../../src/lib/notificationConfig.ts#L2) and
[:16](../../src/lib/notificationConfig.ts#L16). Nothing reads it. `alert_escalation_rules` has 8
references including a live read by the cron'd
[alert-escalation/index.ts:53](../../supabase/functions/alert-escalation/index.ts#L53). One is a
form that saves to a JSON blob; the other sends real SMS and email. This was presented as an open
question; the code answers it.

**What ratification must also resolve:** the two schemas are not equivalent.
`notification_config` carries `channel: in_app | whatsapp | both`; `alert_escalation_rules` carries
`escalation_channels` limited to sms/email. Repointing `Settings → Notifications` at the canonical
table **loses in-app and WhatsApp escalation** unless the table is extended first. So D1 has a
migration attached, not just a deletion. Sequenced in Phase 0; the Code Blue path is a
patient-safety surface and is not allowed to regress in the process.

### D2 — bill `balance_due` ↔ claim outstanding is an enforced invariant

**Call:** enforced, in this specific form. **Ratifier:** revenue-pod + Kavitha (CFO).

For a bill with a linked insurance claim:

```
bill.balance_due  ==  patient_outstanding  +  claim_outstanding

where claim_outstanding = claimed_amount − Σ(reconciled payments)
      patient_outstanding = co-pay + non-payables − Σ(patient payments)
```

**Evidence and rationale:** today `balance_due` is total-minus-payments with no awareness of
`insurance_claims` at all, while the insurance desk computes its own outstanding figure from the
claims table. Two uncross-checked "how much are we owed" numbers on two desks for the same
admission is not a reporting inconvenience — it is the condition under which a hospital dusts a
patient for money the insurer owes, or writes off money it is still owed. Declaring them
independent leaves no test that can ever fail, which is the same as leaving it untested. The
invariant is asserted in Phase 9 and enforced by a nightly reconciliation check, not by a DB
constraint (the two rows update on different cadences, so a constraint would deadlock normal
operation).

### D3 — `bill_status = 'insurance_pending'` is wired, as a derived status

**Call:** wire it, derived rather than hand-set. **Ratifier:** revenue-pod.

**Evidence:** zero references in `src/`, confirmed. The CHECK constraint lives at
[20260323042425](../../supabase/migrations/20260323042425_16804ec8-3823-495a-89b7-52db4d2a494e.sql#L15):
`bill_status IN ('draft','final','partially_paid','paid','cancelled','refunded','insurance_pending')`.

Dropping it is cheaper but loses the only bill-level signal that outstanding money is insurer-side
rather than patient-side — which D2 needs and which the collections desk needs in order not to dun
the wrong party. Wire it as a **derived** value computed in
[billStatus.ts](../../src/lib/billStatus.ts) from `claim_outstanding > 0`, not as a new hand-set
state in the bill's transition machine. Derived keeps the blast radius at one function and one
display map instead of every write path.

**Finding logged while verifying this:** `bills` carries two overlapping status vocabularies —
`bill_status` (draft/final/partially_paid/paid/cancelled/refunded/insurance_pending) and
`payment_status` (unpaid/partial/paid/refund_pending/refunded). Both encode payment state, with
different words. Not in scope to fix here; logged as `KNOWN-BUG-011`, target Phase 9.

### D4 — Staging is a gate for DB-touching work only, and local Supabase unblocks day one

**Call:** the unresolved "hard gate vs parallel track" fork is a false binary and is resolved as
follows. **Ratifier:** data-pod (Lakshmi) + Vikram.

- Phases 0–2 need no database and are **not** gated on staging.
- Phases 3–9 run against **local Supabase** (`supabase start`, migrations applied, fixture seeded)
  from day one. This is what makes "Playwright automatically tests with mock data" real without
  waiting on cloud provisioning.
- A **cloud staging** environment is required before Phase 8 exits, for the ABDM sandbox, live
  Razorpay test mode, WATI/WhatsApp and the backup/restore validation — things local Supabase
  cannot exercise.

Lakshmi's objection is correct about what it actually covers: infra *sign-off* genuinely requires a
staging environment. It does not require blocking unit tests that touch no infrastructure. Both
positions hold once the gate is scoped to the work it applies to.

### D5 — Test data is synthetic-only, generated, and never a production dump

**Call:** security-pod's position stands unamended. **Ratifier:** security-pod (Ananya).

Realistic *volume* is satisfied by generating many rows from deterministic generators, not by
copying production. Two enforcement mechanisms, both built in Phase 3:

1. The seed script refuses to run unless `SUPABASE_PROJECT_REF` matches the test project allowlist
   — a guard against a seed or truncate ever pointing at production.
2. A `check:fixture-phi` CI script fails if any file under `e2e/fixtures/` contains a
   pattern matching a real-format Aadhaar, ABHA, or mobile number outside the reserved test ranges.

> **Sign-off — security-pod (Ananya), 2026-09-12.** D5 is satisfied. `assertLocalTarget`
> (`e2e/fixtures/guard.ts`) is verified fail-closed with no environment-variable override and is
> confirmed wired into every credential path in `e2e/fixtures/serviceClient.ts`, not merely
> documented as if it were — `guard.test.ts`'s 14 cases include the adversarial ones
> (substring-localhost hosts, unexpected ports, an empty allowlist with an attempted
> `SKIP_SEED_GUARD` bypass) that a rubber-stamp review would have missed. `check:fixture-phi` is
> wired into CI, scans the whole `e2e/` tree, and every identifier in `e2e/fixtures/constants.ts`
> sits inside its reserved placeholder range with no Aadhaar/ABHA field present at all. Two
> non-blocking residual notes for the record, not conditions of this sign-off: (1) the
> digit-pattern scan can miss a real-format identifier written with space/hyphen grouping — a
> normalize-before-match pass is a reasonable Phase-4-or-later hardening item; (2) the
> `90000xxxxx` mobile range is this project's convention, not an officially reserved Indian
> fictional-number block (unlike the `.test` TLD or Aadhaar's repdigit-checksum guarantee) —
> acceptable given no real patient data is attached and outbound messaging is hard-disabled on
> every seeded hospital, but should not be assumed to generalise to a future integration that
> re-enables messaging on seeded tenants without re-checking this. No blocking concerns; the two
> hardening items are tickets for whoever owns Phase 4+ fixture maintenance (quality-pod), not
> conditions to reopen this gate.

### D6 — Deterministic fixtures for anything feeding a calculation

**Call:** confirmed from [PLAYWRIGHT_AND_MANUAL_TESTING_PLAN.md](PLAYWRIGHT_AND_MANUAL_TESTING_PLAN.md).
Fixed committed values for rates, quantities, GST %, dates, payer type, allergies, drug pairs.
Random/faker permitted only for cosmetic fields nothing asserts on (name, address, phone).

This is the single most important design decision in the E2E track. If rates are random the only
available assertion is `total > 0`, which passes on all eight known defects.

### D7 — J06 builds the segments; the adoption spine is journey-tested next

**Call:** J06 is the reference implementation, **J12 (OPD cash walk-in) is assembled immediately
after it**, and the adoption spine — OPD → Pharmacy → Lab → Radiology — is journey-tested in Phase
7.5, ahead of the statutory tier. **Ratifier:** quality-pod (Sunita) + Nikhil.

Three documents named three different first journeys. The tie-break for the *reference
implementation* is technical: J06 traverses **all five hubs in a single pass**, so building it
forces all nine segments into existence — after which every later journey is assembly rather than
construction. Tier 1 statutory journeys are higher risk but need medico-legal sign-off, a long-lead
dependency on a person rather than on code; starting there blocks the whole E2E track on an
external calendar.

**The correction this decision now carries.** The journey taxonomy ranked by *irreversibility* — a
missed MLC clock is unrecoverable, a mispriced OPD token is a correction. That is sound risk
reasoning, and the first two versions of this plan carried it over without checking it against how
a hospital actually switches on: **Settings → OPD → Pharmacy → Lab → Radiology → IPD → Insurance →
Daycare.** Under pure irreversibility ranking, OPD — the front door, the highest-volume module, the
first thing staff touch on morning one — landed in Phase 10, i.e. **journey-untested at go-live.**
Phase 5.5 smokes it, Phase 1 covers its billing arithmetic and Phase 5 its charge posting, but the
walk-in → consult → order → result → bill → pay spine was not proven before launch. If OPD breaks
on day one the pilot fails regardless of how well MLC is handled.

Irreversibility still governs **Tier 1 vs Tier 2** ordering and what must be green before go-live
(§9). It does not govern which modules get a journey first — adoption order does.

### D8 — Edge-function scope split for cohort 1

**Call:** **Ratifier:** platform-pod (Aditya) + Kavitha.

- **In scope, Phase 6:** all PHI-handling functions; all ABDM/HCX/PMJAY/ESI/CGHS functions; the
  Razorpay *subscription* path (`create-razorpay-subscription`, `razorpay-subscription-webhook`,
  `change-subscription-plan`, `dunning-processor`) — this is how Aumrti collects its own revenue
  and cannot be deferred; `razorpay-webhook`, `razorpay-settlement-reconcile`.
- **Deferred to Phase 10 unless the pilot requires online patient payment:**
  `create-razorpay-order`, `create-razorpay-payment-link`.

### D9 — Manual-test track owner

**Call:** Sunita (quality-pod) owns the manual track, including writing every `manual/J*.md`
script before its Playwright spec is written. Manual is the frontier, Playwright is the ratchet;
once a journey is automated, manual does not re-run it.

### D10 — Blood Bank cross-matching is a patient-safety surface, tested in Phase 1

**Call:** [bloodCompatibility.ts](../../src/lib/bloodCompatibility.ts) and
[bloodBagLabel.ts](../../src/lib/bloodBagLabel.ts) join `drugSafetyCheck` and
`clinicalCalculators` in the Phase 1 patient-safety tier, at the same 100%-branch bar.
**Ratifier:** clinical-pod (Dr. Ramesh) + quality-pod.

**Evidence and rationale:** ranking by irreversibility put Blood Bank in the Phase 10 long tail
because no journey in the taxonomy transfuses. That is an artefact of the journey list, not a risk
judgement — an ABO-incompatible transfusion kills a patient faster than any drug interaction in
`drugSafetyCheck`, which the same ranking correctly placed first. The logic is already pure and
isolated: `isABOCompatible`, `isRhCompatible`, `isFullyCompatible`, in a 1.5 KB file with no
Supabase dependency. It is the cheapest patient-safety test in the entire plan and it was missed.

CLAUDE.md names three surfaces as the highest bar in the repo. **This plan recommends it name
four** — the omission of blood compatibility from that list is itself the finding.

### D11 — Breadth before depth: every module gets a floor, depth stays risk-ranked

**Call:** all 67 modules are covered by a generated smoke tier (Phase 5.5) before go-live. Deep
journey coverage remains risk-ranked and does not expand. **Ratifier:** Nikhil + quality-pod.

**Evidence and rationale:** the 16 journeys plus five hubs touch roughly **27 of 67 modules**. The
hub argument — that anything writing to `bill_line_items` or `clinical_alerts` is transitively
covered — proves the *handoff* works, not that the module works. A module can render a broken
screen, reject an entitled role, or scroll on a tablet while its hub writes are perfect.

The reason a floor is affordable rather than 40 hand-written suites: `ROUTE_ROLES` is **generated
from `ALL_MODULES`** ([routeRoles.ts:6-10](../../src/lib/routeRoles.ts#L6-L10)), so a single
table-driven spec iterating the registry covers every module and picks up new ones automatically.
The cost is one spec file, not 67.

---

## 3. Still escalated — four items this plan cannot decide

| Item | Why it cannot be decided here | Owner | Blocks |
|---|---|---|---|
| **Capacity — how many engineers, for how long** | Sizes below are in engineer-weeks precisely so this can be divided in. Nobody but the person funding it can set it. | Preethi / Nikhil | Converting §7 into dates |
| **Is a pilot hospital actually committed** | Recorded as unknown on 2026-09-10 and still unknown. Sequencing a go-live without knowing there is a hospital to go live at. | Rohit / Anjali | Go-live date, not plan content |
| **Who owns clinician sign-off on the drug-interaction/allergy ruleset** | Clinical governance and liability, not QA. Also carries an unanswered regulatory question: a drug-interaction checker that advises on dosing may be CDSCO-classifiable clinical decision support. | Dr. Ramesh proposes, Nalini (CDO) gates | Phase 1 exit is testable without it; **go-live is not** |
| **Is the [mobile/](../../mobile/) app in cohort 1** | A second client, in no phase of this plan and in none of the 13 prior documents. If it ships, it needs its own plan — scoping that is not a testing decision. | Nikhil / Preethi | Nothing in phases 0–9; **blocks go-live if the answer is yes** |

The third is the one most likely to be forgotten because Phase 1 can pass without it. Phase 1
tests that `drugSafetyCheck` correctly applies the ruleset it has. Nobody has validated that the
ruleset itself is clinically correct. Those are different claims and only one of them is a QA task.

---

## 4. Operating rules

Five rules. Agreed once, applied to every phase. Without them a gated model stalls in Phase 1
forever.

### R1 — Severity decides what blocks a gate

| Severity | Definition | Blocks the gate? |
|---|---|---|
| **S1** | Patient safety, cross-tenant PHI leak, or wrong money on a real invoice | **Yes.** No waiver possible. |
| **S2** | Silent wrong result in the surface under test — the class of defect this effort exists to catch | **Yes**, unless waived in writing by the phase owner *and* the surface owner, with a linked issue and a target phase |
| **S3** | Correct behaviour, poor ergonomics, cosmetic, or out of this phase's scope | No. Logged with an owner, carried forward. |
| **S4** | Test-harness or fixture problem, not a product bug | No. Fix inline. |

This is what prevents the model's main failure mode: a phase that never ends because someone can
always look harder and find one more silent bug.

### R2 — A test for an unfixed bug is skipped, never left red

```ts
// KNOWN-BUG-007: bill balance_due does not track claim outstanding. Target: phase 9. Owner: revenue-pod.
it.skip("bill balance_due tracks claim outstanding", () => { ... });
```

The test is written and committed in the phase that found the bug — it is not postponed along with
the fix. **CI main is never red.** A team that learns to ignore a red main has lost the suite, and
this codebase's defects are silent, so a suite nobody trusts catches nothing.

Every exit gate includes: no `it.skip` without a `KNOWN-BUG-` reference resolving to a register
entry with an owner and a target phase.

### R3 — The coverage threshold ratchets at every gate

At each exit gate, thresholds in `vitest.config.ts` are raised to the number actually achieved, as
a config commit. Coverage can then only fall by someone deliberately editing the threshold down,
which is visible in a diff and reviewable.

### R4 — Flake policy

- CI retries: **2**. Local retries: **0**.
- A spec that fails intermittently ≥2 times in 10 consecutive CI runs is tagged `@quarantine`,
  excluded from the gate, assigned a named owner, and carries a **5 working-day** fix SLA.
- **Quarantine cap: 3 specs.** A 4th quarantine blocks all merges until one is cleared. Without a
  cap, quarantine becomes the place tests go to die.
- Quarantine count is reported at every exit gate.

### R5 — Red main is reverted, not debugged

The merger owns a red main and has 60 minutes to land a fix or revert. Revert is the default and
carries no blame. This is the policy that makes R2 enforceable.

---

## 5. Test architecture — how "Playwright automatically tests with mock data" actually works

This section is the spine of the E2E track. It is what Phase 3 builds.

```
  supabase start (local, all 612 migrations applied)
            │
            ▼
  e2e/fixtures/tier0.seed.ts      ← deterministic, idempotent, committed
            │                        TWO hospitals, not one
            ├── hospital A: "Ashwini General" (id fixed UUID)
            └── hospital B: "Brindavan Multispecialty" (id fixed UUID)
            │
            ▼
  pg_dump template snapshot  ──► restored before every spec file
            │                     (faster and more reliable than per-test teardown)
            ▼
  playwright globalSetup → 2 × storageState:  .auth/hospital-a.json
                                              .auth/hospital-b.json
            │
            ▼
  e2e/segments/*.ts      ← 9 reusable page objects (Phase 7)
  e2e/journeys/*.spec.ts ← journeys assembled from segments (Phases 8–10)
            │
            ▼
  assertions go to the DB, not the DOM:
      const { data } = await svc.from("bill_line_items")
        .select("*").eq("admission_id", fx.admissionA);
      expect(data).toHaveLength(1);
      expect(data[0].amount).toBe(4720);
```

**The five rules this architecture enforces:**

1. **Assert on resulting state, never on completion.** Every one of the eight known defects passes
   a "the journey ran without error" assertion. `expect(rows).toHaveLength(1)` and
   `expect(total).toBe(4720)` are the assertions that catch them.
2. **Every calculation input is a fixed constant**, so expected outputs are hand-derivable (D6).
3. **Two tenants from the first spec.** Adding the second hospital later means rebuilding the
   fixture; the draft's Tier-0 list had one hospital and this is the correction.
4. **A service-role query client is available to tests only** — it is how assertions read across
   RLS to prove isolation held. It is never importable from `src/`.
5. **Run-any-step-twice** is a standard assertion shape, not a special case. It is how duplicate
   writes get caught.

**Tier-0 fixture contents** (built once, reused by every later phase):

| Entity | Per hospital | Why |
|---|---|---|
| `hospitals` | 1 each, fixed UUIDs | The tenant boundary under test |
| `users` | 1 active per role the tests act as — doctor, nurse, receptionist, billing_executive, lab_tech, pharmacist, hospital_admin | Role guards and `*_by` attribution |
| `departments` | ≥2 | Routing, HOD dashboards |
| `service_master` | Fixed rates for the services journeys bill | D6 — hand-derivable totals |
| GST config | Fixed rates incl. one exempt and one taxable service | `gstRules` needs both branches |
| Module entitlements | Set so the control plane does not block the module under test | Otherwise tests fail at the platform layer before reaching the feature |
| `patients` | 3 each, incl. one with a documented allergy and one scheme-covered | Negative forks need them seeded, not created mid-test |

**Tier-1 settings** (notification routing, TPA config, specialty settings) are seeded **by the test
that needs them**, to two different values, asserting the module's runtime decision differs. Not
"the form saved." This is the only test shape that catches a dead config, and it is why D1 has to
land before Phase 5 writes settings tests.

---

## 6. Test inventory — generated, never hand-maintained

Proposed in [FULL_COVERAGE_METHODOLOGY.md](FULL_COVERAGE_METHODOLOGY.md), never built. It is the
cheapest item in this plan and the tracking substrate for everything else. Built in Phase 0 as
`scripts/generate-test-inventory.mjs`, emitting `docs/testing/INVENTORY.generated.md`:

| Layer | Source registry | Rows |
|---|---|---|
| Modules | `ALL_MODULES` in [modules.ts](../../src/lib/modules.ts) | 67 |
| Settings screens | [settingsCatalog.ts](../../src/lib/settingsCatalog.ts) | generated |
| Routes | `ROUTE_ROLES` + `src/pages/**` | 217 |
| Tables | [types.ts](../../src/integrations/supabase/types.ts) | generated |
| Edge functions | `supabase/functions/` | 109 |
| `src/lib` logic | `src/lib/**` | 187 |

Each row carries: has-unit-test, has-e2e-coverage, target phase, owner. A new module or edge
function appears on the checklist the moment it is added to its registry — not when someone
remembers to update a document. `npm run check:inventory` fails CI if the generated file is stale,
the same pattern `check:openapi` and `check:lab-catalog` already use.

---

## 7. Phase map

| # | Phase | Infra | Est. | Opens after | Can parallel |
|---|---|---|---|---|---|
| 0 | Harness, decisions, inventory | No | 0.5 ew | — | — |
| 1 | Pure calculation logic | No | 3 ew | 0 | with 3 |
| 2 | Consolidate embedded logic | No | 2.5 ew | 1 | with 3 |
| 3 | Test infrastructure | **Builds it** | 4 ew | 0 | with 1, 2 |
| 4 | Multi-tenant isolation | Local SB | 2.5 ew | 3 | — |
| 5 | The five hubs | Local SB | 5 ew | 4 | with 6 |
| **5.5** | **Breadth sweep — all 67 modules** | Local SB | **4 ew** | 5 | with 6, 7 |
| 6 | Edge functions | Local SB | 8 ew | 3 | with 4, 5 |
| 7 | Journey segments (via J06, then J12) | Local SB | 4 ew | 5 | — |
| **7.5** | **Adoption spine — OPD, Pharmacy, Lab, Radiology** | Local SB | **2 ew** | 7 | — |
| 8 | Tier 1 journeys — statutory | Local SB + **cloud staging** | 5 ew | 7.5 | — |
| 8.5 | Pentest + performance | **Cloud staging** | 2 ew | 8 | with 9 |
| 9 | Tier 2 journeys — revenue/scheme | Staging | 4 ew | 8 | — |
| 10 | Tier 3 + long tail (mobile carved out) | Staging | ratchet | 9 | — |

**≈ 46.5 engineer-weeks to the end of Phase 9**, which is the go-live gate. Estimates are ±40% and
assume engineers already familiar with this codebase. With 3 engineers and the parallelism marked
above, roughly **16–19 calendar weeks**. Phase 10 continues after go-live as a ratchet.

**Two sequences, not one.** Phases 0–6 are ordered by **dependency and blast radius**, not by
module — you cannot write a Playwright spec before its config exists, and a hub tested once covers
charge posting for OPD, Pharmacy, Lab, Radiology and IPD at the same time. Phases 7–9 are ordered
by **hospital adoption**: Settings (seeded in Phase 3, behaviour-tested in Phase 5) → OPD →
Pharmacy → Lab → Radiology (Phase 7.5) → IPD (Phase 7, J06) → statutory (Phase 8) → Insurance and
Daycare (Phase 9). Confusing the two is what put OPD after go-live in the earlier drafts.

Phase 6 is the largest single item and the one the earlier documents gave one table row. 109
server-side endpoints handling PHI, payments, ABDM and PMJAY at zero coverage is not a footnote.

---

## 8. The phases

### Phase 0 — Harness, decisions, inventory · 0.5 ew · no infra

Not a testing phase. Removes what blocks every later phase. Should be the shortest phase here.

1. Add `test`, `test:watch`, `test:coverage`, `test:e2e` scripts to `package.json`.
2. `npm i -D @testing-library/user-event` — missing, and needed by every component test.
3. Set `coverage.include` in [vitest.config.ts](../../vitest.config.ts) to `src/lib/**` and
   thresholds to `0`. **A threshold of zero that exists is what makes R3 mechanical rather than
   aspirational.**
4. Add a `tests` job to [ci.yml](../../.github/workflows/ci.yml), after Lint, before Build.
5. Create the `KNOWN-BUG-` register at `docs/testing/KNOWN_BUGS.md`; seed it with the 8 known
   defects plus `KNOWN-BUG-011` (dual bill status vocabularies, D3).
6. Build `scripts/generate-test-inventory.mjs` + `check:inventory` (§6).
7. Correct the module count in CLAUDE.md from 61 to generated output.
8. Land D1's schema extension: add in-app and WhatsApp channels to `alert_escalation_rules`, repoint
   `Settings → Notifications` at it, retire `notification_config`. **Code Blue escalation must not
   regress** — this is the one item in Phase 0 that touches a patient-safety path.

**Exit gate — all mechanically checkable:**
- `npm test` exits 0 with zero tests.
- CI shows a `tests` job on a PR.
- `vitest.config.ts` has `coverage.include` and four explicit numeric thresholds.
- `npm run check:inventory` passes and `INVENTORY.generated.md` is committed.
- D1–D9 each have a named ratifier recorded in this document with a date.
- `grep -rn "notification_config" src/` returns zero.

### Phase 1 — Pure calculation logic · 3 ew · no infra

The surfaces CLAUDE.md already names as the highest bar in the repo, plus the pure validators. No
Supabase, no fixtures, no staging. **This phase exists partly to prove the test→fix→gate loop works
before anything is bet on it.**

| Target | Size | Why |
|---|---|---|
| [drugSafetyCheck.ts](../../src/lib/drugSafetyCheck.ts) | 11.7 KB | Patient safety; never mocked or skipped |
| [clinicalCalculators.ts](../../src/lib/clinicalCalculators.ts) | 36.3 KB | Patient safety; largest target here |
| [bloodCompatibility.ts](../../src/lib/bloodCompatibility.ts) | 1.5 KB | **Patient safety (D10).** ABO/Rh cross-match. Cheapest safety test in the plan; assert every one of the 64 group×group pairs explicitly, not a sampled subset |
| [bloodBagLabel.ts](../../src/lib/bloodBagLabel.ts) | 3.9 KB | A mislabelled bag defeats a correct cross-match |
| [gstRules.ts](../../src/lib/gstRules.ts) | 5.0 KB | Statutory + revenue |
| [billTotals.ts](../../src/lib/billTotals.ts) | 5.4 KB | Revenue; the rounding contract |
| [payerTypes.ts](../../src/lib/payerTypes.ts) | — | The `esi`/`cghs` drift already bit once |
| [abdm-validators.ts](../../src/lib/abdm-validators.ts) | 3.2 KB | Include the deliberate "fake but well-formed **passes**" assertion so nobody later "fixes" it |
| [billStatus.ts](../../src/lib/billStatus.ts), [dayClosureTotals.ts](../../src/lib/dayClosureTotals.ts), [ipdAncillaryGate.ts](../../src/lib/ipdAncillaryGate.ts) | 8.4 / 17.2 KB | Pure, cheap, adjacent |

**Fixes expected in-phase:**
- `visit_type` vocabulary drift across four migrations — `'follow_up'` vs `'followup'` vs
  `'revisit'` vs `'review'`. Consolidate to one constant as `payerTypes.ts` already did.
  `20261015000002` already defensively handles both spellings, which is the tell that someone hit
  this and patched around it.
- Any remaining inline comparison against a scheme name (`"cghs"`, `"pmjay"`, `"esi"`) bypassing
  `payerTypes.ts`.
- D3's derived `insurance_pending` lands in `billStatus.ts` here.

**Exit gate:**
- 100% branch coverage on `drugSafetyCheck`, `clinicalCalculators`, `gstRules`, `billTotals`.
- ≥80% line coverage on every other file touched this phase.
- Zero open S1/S2. Every S2 waiver has an owner and a target phase.
- `grep -rn "'follow_up'\|'followup'\|'revisit'" src/` resolves to one shared constant.
- No `it.skip` without a `KNOWN-BUG-` reference. Thresholds ratcheted (R3).

### Phase 2 — Consolidate the embedded logic · 2.5 ew · no infra

Three places where the analyses found the same decision implemented more than once, or business
logic trapped inside a component or a Deno wrapper where it cannot be tested. Refactor to one pure
function, repoint all call sites, then unit test it.

| Extraction | From | Why |
|---|---|---|
| "Is this consumed service already billed?" | 4 surfaces, 2 competing implementations — [LeakageScanner.tsx](../../src/components/billing/LeakageScanner.tsx) and [PreDischargeLeakageBanner.tsx](../../src/components/ipd/PreDischargeLeakageBanner.tsx) match on description substring; `daily-leakage-scan` and [UnbilledServicesModal.tsx](../../src/components/billing/UnbilledServicesModal.tsx) use `billing_status` / `source_dedupe_key` | Two implementations of one question that can disagree **is** the leakage risk |
| `scanHospital` | [daily-leakage-scan/index.ts](../../supabase/functions/daily-leakage-scan/index.ts) | So the cron path and any "scan now" path are provably identical logic |
| Claim KPI maths — `pendingAmount`, `avgSettlementDays`, `recoveryRate` | inline in [PaymentReconciliation.tsx](../../src/components/insurance/PaymentReconciliation.tsx)'s `loadKPIs` | Same calculation/presentation split `billTotals.ts` already establishes |

**Cases the analyses specifically call for:** two tests with overlapping names; the same drug
dispensed twice in one admission; master-data description edited after the order was placed; a
voided or refunded bill's lines must not count as "already billed"; grace-window boundaries at
11h59m vs 12h01m (lab/radiology/pharmacy) and 23h59m vs 24h01m (OT), per
[daily-leakage-scan/index.ts:33-34](../../supabase/functions/daily-leakage-scan/index.ts#L33-L34);
underpayment where `approved_amount < claimed_amount` stays visible in pending and raising a
dispute does not zero it before resolution.

**Exit gate:**
- Exactly one implementation of each of the three decisions, all call sites repointed.
- `grep` proves no `description`-substring billing comparison remains in `src/`.
- Boundary cases asserted, not assumed. Zero open S1/S2. Thresholds ratcheted.

### Phase 3 — Test infrastructure · 4 ew · builds the infra

The infra block, made a gated phase specifically so it cannot become permanent. Per D4 this
targets **local Supabase**, so it is not blocked on cloud provisioning.

1. `playwright.config.ts` + `globalSetup` + two-tenant `storageState`.
2. `e2e/fixtures/tier0.seed.ts` per §5 — **two hospitals**, idempotent, re-runnable from scratch,
   committed code rather than a UI walkthrough.
3. The pg_dump template-snapshot restore harness (§5).
4. The service-role assertion client, importable from tests only.
5. `check:fixture-phi` + the project-ref guard (D5).
6. A `supabase start`-based CI lane so E2E runs on PRs, not just locally.
7. **Cloud staging provisioning starts here in parallel**, required by Phase 8, not by Phase 3.

**Exit gate:**
- A trivial smoke spec runs green **as two different hospitals**, via two `storageState` files.
- The Tier-0 fixture is committed code, re-runnable from scratch, and produces byte-identical state
  on two consecutive runs.
- `check:fixture-phi` passes and is wired into CI.
- Test-data DPDP position (D5) signed off by security-pod in writing.
- Backup/restore validation is **not** in this gate — it moves to Phase 8 with cloud staging, since
  restoring a local container proves nothing about production RPO.

### Phase 4 — Multi-tenant isolation · 2.5 ew

The risk every pod ranked first, now executable. Deliberately ahead of general coverage: a suite
with perfect unit coverage that leaks PHI cross-tenant on day one has failed at the only thing that
ends a company.

- pgTAP on `get_user_hospital_id()` edge cases — null `hospital_id`, mid-transfer user,
  service-role bypass. Defined in
  [20260321162749](../../supabase/migrations/20260321162749_5754cd97-c837-4c8f-a419-b2dd4b7f66f5.sql)
  and amended in `20260322111223`; it is the single function most RLS policies depend on and has no
  dedicated test.
- pgTAP on the `SECURITY DEFINER` NABH collectors in
  [20261011000030_quality_indicator_collectors.sql](../../supabase/migrations/20261011000030_quality_indicator_collectors.sql)
  — **the test that file's own header comment already claims exists.** Privilege-escalated, crosses
  RLS by design, currently protected by a predicate and a promise.
- Playwright: the same action as hospital A and hospital B, asserting zero cross-visibility on each
  of the five hub tables.
- Control-plane: admin access gated on `aumrti_admins`, never on `hospital_id`.
- App-layer: a client-supplied `hospital_id` is never trusted — a separate leak vector from RLS.

**Exit gate:**
- No cross-tenant read achievable on any of the five hub tables, at DB layer or control-plane layer.
- The comment in `quality_indicator_collectors.sql` is now true.
- **Any isolation failure found is S1 by definition** — no waivers, the phase cannot exit until
  fixed.

### Phase 5 — The five hubs · 5 ew

[CROSS_CATEGORY_CONNECTIVITY.md](CROSS_CATEGORY_CONNECTIVITY.md)'s central insight: nearly all
cross-category traffic flows through five hubs, not 45 category pairs. Test the hubs and most of
the graph is covered.

**Per hub:** every category that should write does so with the correct shape (positive); duplicate
and conflicting writes are caught (negative); every category that should read gets a complete,
accurate view (reconciliation).

| Hub | What this phase must fix |
|---|---|
| `bill_line_items` | Reconciliation test: seed mixed billed/unbilled across lab, radiology, pharmacy, OT; run the scan; assert the **exact** expected discrepancy set |
| `clinical_alerts` | **Add DB-level dedup.** Verified: the table has only `alert_type` CHECK constraints across 5 migrations and no UNIQUE constraint, across 48+ insert sites. Fix [LabTATPanel.tsx:91-100](../../src/components/lab/LabTATPanel.tsx#L91-L100), which re-inserts on every `load()`. Audit the other poll/reload-triggered sites (`RadiologyTATPanel`, `*Trend*`) |
| `insurance_claims` | The D2 invariant |
| `nabh_evidence_log` | Completeness check — for events that must produce evidence (OT close, lab verification, consent signed), assert the row exists. This exact silent failure already happened once across ~50 call sites |
| `patients.id` | The hub with no analysis yet: a record whose `patient_id` no longer resolves — merged/deduplicated patients, records created before a merge and never repointed |

Plus **settings-as-behaviour**: for each screen in `settingsCatalog.ts`, seed the value to two
different settings and assert the configured module's runtime decision *differs*. Not "the form
saved."

**Exit gate:**
- Dedup enforced at the DB layer on `clinical_alerts`; run-any-step-twice asserts exactly one row
  on all five hubs.
- Every settings screen is either behaviour-tested or **explicitly listed as having no verified
  consumer** — which is a finding in its own right, and the list goes to product.
- Zero open S1/S2.

### Phase 5.5 — Breadth sweep, all 67 modules · 4 ew · can run parallel to 6 and 7

The floor under every module (D11). Phases 1–5 and 7–9 go deep on roughly 27 modules; this phase
ensures the other 40 are not shipped completely unexercised. It is **one table-driven spec plus
four cross-cutting sweeps**, not 67 hand-written suites — `ROUTE_ROLES` is generated from
`ALL_MODULES`, so the spec iterates the registry and a newly added module joins the sweep
automatically.

**Sweep 1 — per-module smoke, generated from `ALL_MODULES` (67 rows).** For each module, as both
tenants:

| Assertion | Catches |
|---|---|
| Route loads for an entitled role, no console error, no error boundary | A module reachable but broken |
| Route is refused for a non-entitled role | A role guard registered in `routeRoles.ts` but not enforced |
| Module is blocked when its entitlement is off, and reachable when on | The control-plane gate the module catalogue depends on |
| The module's primary create action writes to the hub it declares | Registered but unwired — the "renders but unbilled" failure CLAUDE.md warns about |

**Sweep 2 — the three design laws, asserted rather than eyeballed.** All three are CLAUDE.md hard
rules on every screen and none has ever been checked automatically across 217 pages:

- **Zero Scroll** — at the 768px tablet breakpoint, `document.scrollingElement.scrollHeight` must
  not exceed the viewport height on any route in the sweep.
- **Clarity** — computed `font-size` ≥ 14px on every element carrying a clinical or financial
  label; status rendered via `StatusBadge` rather than a bare string.
- **1-2-3 Click** — derived statically from the route graph plus the sidebar and launcher
  registries: every module route must be reachable from the dashboard in ≤3 navigations. This one
  is a build-time check, not a browser test.

**Sweep 3 — analytics aggregation correctness.** Recommended in
[CROSS_CATEGORY_CONNECTIVITY.md](CROSS_CATEGORY_CONNECTIVITY.md) and absent from the first draft.
For a seeded period with hand-derivable totals, every Analytics module's headline figures
(Revenue Intelligence, Population Health, HOD Dashboard, Analytics & BI, TV Display) must equal a
manual sum of the underlying hub rows. Wrong rollup logic is a failure mode that does not exist at
the hub layer and is invisible to every hub test.

**Sweep 4 — tablet performance budget.** Named as a blocker by quality-pod in
[PRODUCTION_TESTING_BRAINSTORM.md](PRODUCTION_TESTING_BRAINSTORM.md) and then dropped. p95
time-to-interactive budget on a throttled tablet profile for the ten highest-traffic routes, plus
an assertion that any list rendering >200 rows is virtualised.

**Exit gate:**
- All 67 modules pass sweep 1 as both tenants, or carry a `KNOWN-BUG-` entry with an owner and a
  target phase. **Coverage of the module registry is 67/67, not 27/67.**
- Sweeps 2–4 green, with any design-law violation either fixed or waived in writing per R1.
- Every Analytics headline figure reconciles to a manual sum.
- Zero open S1/S2.

### Phase 6 — Edge functions · 8 ew · can run parallel to 4–5

109 endpoints, zero coverage, largest single item in this plan. Depends on Phase 3 only.

**Four assertions per function:** a valid authenticated request succeeds; missing or invalid auth is
rejected; a malformed payload does not 500 with a stack trace; **no PHI in logs, ever**. Plus
retry/dead-letter behaviour for the queue-backed ones (`notification-dispatcher`,
`webhook-dispatcher`, `webhook-dlq-processor`).

**Priority order, per D8:**

1. **PHI-handling** — `upsert-patient-phi`, `phi-backfill-encrypt`, `update-patient-ai-context`,
   `export-lab-reports`, `export-drug-chart`, `export-nursing-notes`, `generate-discharge-summary`,
   `fhir-export`, `fhir-r4-server`, `lab-analyzer-ingest`, the `ai-*` clinical functions.
2. **Money** — `generate-invoice`, `gst-irn-generate`, `reconcile-journal-postings`,
   `email-tally-xml`, `financial-anomaly-check`, `daily-leakage-scan`, and the Razorpay
   subscription path.
3. **Statutory / external** — ABDM (`abdm-*`, 10 functions), HCX (`hcx-*`, `submit-pre-auth-hcx`),
   `pmjay-claim-submit`, `pmjay-eligibility`, `esi-claim-submit`, `cghs-eligibility`,
   `hmis-portal-submit`, `idsp-alert-submit`.
4. **Tenant lifecycle** — `register-hospital`, `setup-hospital`, `delete-hospital`,
   `create-staff-login`, `admin-impersonate-start`, `purge-orphaned-users`. Neha's point stands:
   the provisioning chain has never been tested end-to-end as one chain, and partial-provisioning
   rollback is untested.
5. The rest, to Phase 10, each with a target phase recorded in the inventory.

**The AI functions need a fifth assertion, and it is not a QA one.** The four assertions above test
that an `ai-*` endpoint authenticates, validates and does not leak — nothing about whether what it
*generates* is clinically safe. Around 15 of the 109 functions sit on a clinical decision path
(`ai-differential-diagnosis`, `ai-clinical-guidelines`, `ai-generate-clinical-note`,
`ai-discharge-summary`, `ai-icd-suggest`, `ai-radiology-impression`, `ai-resolve-orders`,
`ai-safety-guard`, `ai-clinical-voice`). CLAUDE.md makes Nalini (CDO) a **mandatory gate on every
clinical-path AI feature**, and the first draft of this plan omitted her entirely.

So Phase 6 additionally asserts, at the [aiProvider.ts](../../src/lib/aiProvider.ts) choke point:
every clinical-path call is entitlement- and budget-gated
([aiEntitlement.ts](../../src/lib/aiEntitlement.ts), [aiBudget.ts](../../src/lib/aiBudget.ts));
safety-class AI is never budget-capped into silence; clinician-confirmation is required before any
generated content reaches a record; and the AI audit trail is written on every call. Output
*quality* remains Nalini's governance review, not a test.

**Exit gate:**
- 100% of category 1–4 functions covered on all four assertions.
- `npm run check:no-phi-logs` exists, is wired into CI, and passes — a static scan for PHI field
  names inside `console.*` calls in `supabase/functions/`. **This is a CLAUDE.md hard rule with
  zero enforcement today.**
- The tenant provisioning chain passes end-to-end, including partial-failure rollback.
- Every clinical-path AI function is gated, audited and confirmation-bound, asserted at the choke
  point; **Nalini's written AI governance sign-off obtained** on the clinical-path set.
- Remaining functions listed in the inventory with an owner and a target phase.

### Phase 7 — Journey segments · 4 ew

Nine reusable segments as page objects and helpers. **Not journeys yet.** This is the engineering
work; journeys afterwards are assembly, which is what keeps 16 journeys from becoming 100+ slow,
duplicated specs.

```
[Registration]─[Encounter]─[Clinical doc]─[Orders]─[Charge posting]─[Billing]─[Claim*]─[Discharge]─[Statutory filing*]
                                                                      *conditional on payer / outcome
```

Built by constructing **J06** (D7) end-to-end and extracting the segments from it, rather than
building nine abstractions speculatively. **J12 (OPD cash walk-in) is then assembled second**, from
the extracted segments — it is nearly free once they exist, and it is the module the hospital opens
with.

**Exit gate:** all nine callable and composable; each carries state assertions rather than
completion checks; each runnable as either tenant; J06 green as both hospitals; **adding a new
journey requires no new segment code** — demonstrated by J12 being assembled with zero new segment
lines.

### Phase 7.5 — The adoption spine · 2 ew

The four modules a hospital switches on first, journey-tested in the order it switches them on
(D7). Cheap because Phase 7 has already built the segments — these are assemblies plus their
module-specific negative forks, not new machinery.

| # | Journey | Negative forks |
|---|---|---|
| **OPD** | J12 walk-in cash: register → token → consult → order → result → auto-bill → payment. J13 follow-up: follow-up fee + visit cap | Follow-up charged as new visit (the `visit_type` drift fixed in Phase 1 lands here); unpaid bill blocks ancillary collection; override is audited |
| **Pharmacy** | Prescribe → dispense → charge posts once | Documented allergy **blocks** dispensing; interaction-check timeout must block, not silently allow (clinical-pod's open question); same drug dispensed twice yields one charge |
| **Lab** | Order → sample → result → verify → charge + NABH evidence row | Critical value raises exactly one alert, not one per panel reload; TAT breach alert dedupes |
| **Radiology** | Order → schedule → perform → report → charge | Fee lookup returns a real rate, never ₹0 — the historical `modalities` bug priced every radiology line at zero silently |

Run as both tenants. The Pharmacy allergy fork and the Lab critical-value fork are patient-safety
assertions and are **S1 if they fail**.

**Exit gate:**
- All four spines green as both hospitals, with their negative forks.
- Every charge posted by these four modules reaches `bill_line_items` exactly once — asserted by
  running each spine twice.
- Zero open S1/S2.
- **A hospital could open OPD, Pharmacy, Lab and Radiology on this build.** That is the plain
  statement of what this gate means, and it is the one the pilot hospital cares about.

### Phase 8 — Tier 1 journeys, statutory · 5 ew · needs cloud staging

MLC → police intimation · MCCD → mortuary release · ANC → partograph → delivery · Neonatal/NICU
screening windows · NDPS dual sign-off.

Ranked by irreversibility, not volume. Statutory clocks must be proven to **actually fire**, not
merely to exist in code. Negative forks attach here: intimation window missed, second NDPS
signatory absent, screening window lapsed.

Cloud staging is required by this phase for the ABDM sandbox and real SMS/WhatsApp delivery paths.

**Exit gate:**
- Every statutory clock demonstrably fires and is logged.
- One backup restored and verified on cloud staging; **RPO and RTO written down as measured
  numbers**, not estimates. An unvalidated RPO is a guess with a unit attached.
- **Medico-legal sign-off, not QA sign-off.** This is the one gate QA cannot close alone.

### Phase 8.5 — Penetration test and load · 2 ew · needs cloud staging · parallel to 9

security-pod called an independent penetration test **non-negotiable before real PHI flows**
(Ananya on RLS/OWASP, Prakash on the Aadhaar/ABHA path specifically). The first draft of this plan
dropped it. It runs here because it needs cloud staging and a fully seeded two-tenant dataset, and
because D5 has by now made it lawful — pentesting against synthetic data rather than real PHI is
what removes the DPDP objection to doing it at all.

- Third-party penetration test, scoped to: cross-tenant access, the ABHA/Aadhaar path, the
  control-plane admin surface, Edge Function auth, and file/export endpoints.
- Concurrency: 40 simultaneous users on one tenant across OPD, IPD and Billing, asserting no
  cross-tenant bleed under load and no lost writes on the five hubs. Isolation proven at rest in
  Phase 4 is not the same as isolation under contention.

**Exit gate:** zero unremediated high or critical findings; every medium finding has an owner and a
target date; concurrency run produces zero lost writes and zero cross-tenant reads.

### Phase 9 — Tier 2 journeys, revenue and scheme · 4 ew

J06 negative forks · J07 PMJAY/CGHS with the nursing-bundling rule · dialysis recurring sessions ·
oncology day care · LAMA/DAMA · transfer out.

Includes the question the analyses leave open: does leakage detection work the same way on an
insurance/PMJAY admission as on a cash one, or do scheme services reach a claim by a path every
leakage detector is blind to? This is answered by test, not by assumption.

**Exit gate:**
- For a scheme-covered admission, every chargeable service provably reaches either the bill or the
  claim.
- The D2 invariant holds across the full claim lifecycle: submitted → approved → partially
  reconciled → disputed.
- Underpayment stays visible; raising a dispute does not zero it.
- `KNOWN-BUG-011` (dual bill status vocabularies) resolved.
- **This is the go-live gate.** §9 applies.

### Phase 10 — Tier 3 and long tail · ratchet · post-go-live

Preventive health packages · teleconsult · home care · remaining edge functions · deepening the 40
modules that Phase 5.5 covers only at smoke level · accessibility · localization and Bhashini
multi-language paths · the browser/device matrix · print and export output correctness.

OPD walk-in and OPD follow-up are **no longer here** — they moved to Phase 7.5 as part of the
adoption spine (D7).

**The mobile app is carved out of the ratchet.** [mobile/](../../mobile/) is a separate React
Native/Expo project, appears in none of the 13 prior documents and in no phase above. It is not a
long-tail item — it is an untested second client. **It does not ship to a hospital until it has its
own plan**; if cohort 1 needs it, that plan is written and executed before go-live, not after.
Treating it as ratchet material is how an untested app reaches a ward.

**Phase 10 has an exit gate, unlike a pure ratchet.** A phase with no exit condition is where
deferred scope goes to die, and this phase inherits every deferral in the plan:

- Every row in `INVENTORY.generated.md` has a status and an owner — no row reads "unassigned".
- Thresholds continue to ratchet at each release, never down (R3).
- Quarantine stays ≤3 specs (R4).
- Quarterly review: any item carried for two consecutive quarters is either scheduled with a date
  or explicitly closed as accepted risk, with a named accepter. Silent carry-forward is not allowed.

---

## 9. Definition of go-live done

The draft named no number anywhere. Nine criteria, all mechanically checkable except the two
sign-offs.

| # | Criterion | Check |
|---|---|---|
| 1 | 100% branch coverage on `drugSafetyCheck`, `clinicalCalculators`, **`bloodCompatibility`**, `gstRules`, `billTotals` | `npm run test:coverage` |
| 2 | ≥80% line coverage on every file touched in Phases 1–2; ≥60% line across `src/lib/**` | thresholds in `vitest.config.ts` |
| 3 | Zero open S1. Zero open S2 without a written, owned, dated waiver | `KNOWN_BUGS.md` |
| 4 | All five hubs isolation-tested as two hospitals, all green | Phase 4 + 5 suites |
| 5 | **67 of 67 modules** pass the Phase 5.5 smoke sweep as both tenants | Phase 5.5 gate |
| 6 | Zero Scroll, Clarity and 1-2-3 Click asserted across every route in the sweep | Phase 5.5 sweep 2 |
| 7 | Every Analytics headline figure reconciles to a manual sum of hub rows | Phase 5.5 sweep 3 |
| 8 | Tablet p95 budget met on the ten highest-traffic routes | Phase 5.5 sweep 4 |
| 9 | **The adoption spine is green as both tenants** — OPD, Pharmacy, Lab, Radiology, with their patient-safety negative forks | Phase 7.5 gate |
| 10 | 100% of PHI, money, statutory and tenant-lifecycle edge functions on all four assertions; clinical-path AI gated, audited, confirmation-bound; **Nalini's AI governance sign-off** | Phase 6 gate |
| 11 | `check:no-phi-logs`, `check:fixture-phi`, `check:inventory` all in CI and green | ci.yml |
| 12 | Tier 1 journeys green **and medico-legal sign-off obtained** | Phase 8 gate |
| 13 | One backup restored on staging; RPO/RTO recorded as measured numbers | Phase 8 gate |
| 14 | **Penetration test complete, zero unremediated high/critical findings** | Phase 8.5 gate |
| 15 | 40-user concurrency run: zero lost writes, zero cross-tenant reads | Phase 8.5 gate |
| 16 | Suite green on `main` for **10 consecutive working days**, ≤1 spec in quarantine | CI history |

**Plus four non-test gates that are not QA's to close:** clinician sign-off on the
drug-interaction/allergy ruleset (§3), a committed pilot hospital (§3), a decision on whether the
[mobile/](../../mobile/) app is in cohort 1 — and if so its own test plan executed — and a
shadow-run period at the pilot hospital: parallel billing and GST reconciliation against the manual
process before real money depends on Aumrti alone. Every pod that touched this reached for
shadow-running independently; it is the final check, not a substitute for the above.

**What go-live still does not mean.** Sixteen criteria is a floor, not omniscience. At go-live,
40 of 67 modules carry smoke coverage rather than journey coverage; accessibility, localization and
the browser/device matrix are untested; and print output is verified manually only. These are
accepted launch risk, listed here so that acceptance is a decision on the record rather than a gap
nobody noticed.

---

## 10. What this plan keeps from the 13 prior documents

- Assert on **resulting state**, never on completion — every phase, every step.
- Nine segments assembled into journeys, not 16 monoliths.
- Five hubs, not 45 category pairs.
- Deterministic fixtures for anything feeding a calculation.
- Generate the checklist from the code's own registries.
- Risk-rank by irreversibility, not by patient volume.
- Manual is the frontier, Playwright is the ratchet — once a journey is automated, manual moves on.
- Unit tests start immediately and in parallel; they need no infrastructure and should not wait for
  any.

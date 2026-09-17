# Recommended Test Strategy — Journey-Led, With Three Corrections

**Status:** Recommendation. This is the capstone of the six analyses done on 2026-09-10.
**Date:** 2026-09-10

**The proposal:** test real hospital workflows / complete user journeys as the primary test case,
with positive and negative variants, plus unit tests underneath — optimising for speed to market.

**My verdict: the journey-led instinct is right, and I'd endorse it. Three corrections make the
difference between it working and it producing false confidence.**

---

## Why journey-led is the right organising unit here

This isn't just a reasonable choice — it fits *this* codebase's architecture specifically.

The connectivity analysis established that Aumrti's ~65 modules don't connect category-to-category;
they connect through five hubs (`bill_line_items`, `clinical_alerts`, `insurance_claims`,
`nabh_evidence_log`, `patient_id`). A real hospital journey — admit → treat → order → dispense →
bill → claim → discharge — traverses **every one of those hubs in a single pass**. Testing by
module would hit each hub repeatedly from one side and never test the handoff; testing by journey
tests the handoffs by construction. The unit of testing matches the unit of risk.

It also has two secondary advantages worth keeping: a journey test is legible to hospital staff, so
the same artifact doubles as the UAT script growth-pod said was needed; and it produces visible,
demoable progress early, which matters for the speed goal.

---

## Correction 1 — "the journey completed" must never be the assertion

This is the important one.

**Every single defect found across today's six analyses was silent.** Not one was a crash, an
error, or a failed operation:

| Defect | What it looked like at runtime |
|---|---|
| `notification_config` read by nothing | Form saved successfully |
| `clinical_alerts` duplicates from `LabTATPanel` | Alerts were created — just N of them |
| `LeakageScanner` substring matching | Scan completed, reported a clean bill |
| NABH engine's claimed-but-absent isolation test | Indicators computed and displayed fine |
| `bill_status = 'insurance_pending'` never set | Bills had a valid status |
| Bill `balance_due` vs claim outstanding unreconciled | Both numbers rendered correctly |
| (historical) `nabh_criteria` never seeded — ~50 call sites | Every call "succeeded", updating zero rows |
| (historical) `service_master.rate` / radiology fee lookups | Bills generated — at ₹0 |

A journey test that asserts "the workflow ran end to end without error" **passes on all eight.**
That's not a hypothetical weakness; it's the demonstrated failure mode of this specific codebase.

So the assertion has to be on **resulting state**, not completion. At each journey step, assert the
data the step was supposed to produce: after the lab result → exactly one bill line exists with the
correct `source_dedupe_key` and the correct amount; after the OT case → a `nabh_evidence_log` row
exists; after the alert fires → exactly one `clinical_alerts` row, and running the step twice still
yields one. "Exactly one" and "the right number" are the assertions that catch this class of bug.
"It didn't throw" catches none of them.

---

## Correction 2 — negative cases are journey *forks*, not invalid input

The natural reading of "negative test case" is bad input rejected. At journey level that's the
least interesting kind. The valuable negatives are the points where a real hospital journey
legitimately diverges, because those are where the business rules live:

- Patient has a documented allergy → does dispensing actually **block**? (And, per clinical-pod's
  open question: does it block or silently allow if the interaction-check API times out?)
- Bill unpaid → does the ancillary payment gate stop the lab sample being collected, and is the
  override audited before the service proceeds?
- TPA approves less than claimed → does the underpayment stay visible in the pending figure rather
  than being quietly zeroed?
- Scheme patient (PMJAY/CGHS) → is nursing correctly **absent** from the bill, per the bundling rule?
- Discharge attempted with unbilled services outstanding → does the pre-discharge gate hold?

Each of these is a branch off the same spine, not a separate journey. That's what makes
positive/negative tractable instead of doubling the work.

---

## Correction 3 — unit tests aren't "underneath", they're **first**

Sequencing matters more than layering here, and this is where the speed goal is actually won or
lost.

Journey/E2E tests need a staging environment and a second test tenant. **Neither exists** — data-pod
and quality-pod both confirmed this independently, and both said they can't sign off without it.
So a journey-first plan is blocked on infrastructure from day one.

Unit tests on `drugSafetyCheck`, `clinicalCalculators`, `gstRules`, and `billTotals` need **none of
that** — they're pure functions, testable today, and they're the three surfaces quality, clinical,
and revenue independently named as non-negotiable blockers.

So: start unit tests **now**, in parallel with building the staging/seed infrastructure the journeys
require. By the time journeys can run, the fast layer already covers the calculation logic — and the
journey tests are then free to assert on *handoffs* rather than re-verifying arithmetic through a
slow, flaky UI. That's not a compromise on the journey-led approach; it's what makes it fast.

---

## The recommended shape

**Three journey spines**, chosen to cover all five hubs:

| Journey | Path | Hubs covered | Priority |
|---|---|---|---|
| **B — IPD insured** | Admit (PMJAY/TPA) → ward → drugs → OT → discharge summary → claim → TPA reconciliation | All five | **First** — crosses the most hubs and lands directly on both the leakage and insurance-reconciliation gaps |
| **A — OPD cash** | Walk-in → consult → lab order → result → auto-bill → payment | Billing, alerts, patient | Second |
| **C — Emergency** | Triage → MLC → admission → ICU | Alerts, NABH, patient, statutory clocks | Third |

**Run every journey twice, as two different hospitals.** Multi-tenant isolation — the risk every
pod ranked at the top, and the one a single happy path structurally cannot detect — then comes
almost free from infrastructure the journeys already need.

**Layer it as:**
1. **Now, no infra needed:** unit tests on the four calculation surfaces + the pure validators
   (`abdm-validators`, `billStatus`, `dayClosureTotals`, `payerTypes`).
2. **In parallel:** Tier-0 seed fixture + staging + second tenant (per the prerequisites analysis —
   small and global, not "all settings first").
3. **Then:** Journey B with state assertions at every step, run as two hospitals, plus its negative
   forks. Then A, then C.
4. **Ongoing:** each journey step's assertions become rows in the master inventory, so coverage is
   tracked rather than remembered.

---

## On speed specifically

The journey-led approach genuinely is the fast one — it produces working, demoable, UAT-ready
coverage sooner than a module-by-module grind, and I'd keep that framing.

The one thing worth stating plainly: the risk to speed isn't a slower test suite, it's a
patient-safety or cross-tenant PHI incident at the pilot hospital. A drug interaction missed or one
hospital seeing another's patients doesn't slow a launch down — it ends it. Both of those are
exactly what the "run every journey as two hospitals, assert on state" shape is built to catch, and
neither costs meaningfully more than the version that doesn't catch them. That's why the corrections
above are worth taking: they're not a tax on speed, they're what keeps the speed real.

---

## Related analyses

- [PRODUCTION_TESTING_BRAINSTORM.md](PRODUCTION_TESTING_BRAINSTORM.md) — seven-pod positions, five candidate philosophies
- [REVENUE_LEAKAGE_ANALYSIS.md](REVENUE_LEAKAGE_ANALYSIS.md)
- [NOTIFICATION_SYSTEM_ANALYSIS.md](NOTIFICATION_SYSTEM_ANALYSIS.md)
- [INSURANCE_PMJAY_BILLING_ANALYSIS.md](INSURANCE_PMJAY_BILLING_ANALYSIS.md)
- [ABHA_NABH_ACCURACY_ANALYSIS.md](ABHA_NABH_ACCURACY_ANALYSIS.md)
- [CROSS_CATEGORY_CONNECTIVITY.md](CROSS_CATEGORY_CONNECTIVITY.md)
- [FULL_COVERAGE_METHODOLOGY.md](FULL_COVERAGE_METHODOLOGY.md)
- [TEST_PREREQUISITES_STRATEGY.md](TEST_PREREQUISITES_STRATEGY.md)

# Phase 7 — Journey segments: completion record

**Phase:** 7 of [PHASED_TEST_PLAN.md](PHASED_TEST_PLAN.md) §8 · **Date:** 2026-09-14 (written
retrospectively, after a direct audit against the plan found this record had never been produced)

**Status: DONE, with two honest caveats the plan's own exit-gate wording does not survive
literally.** J06 (IPD elective surgical, TPA-insured) runs end to end as both hospitals. J12 (OPD
cash walk-in) was assembled from the same segment set and also runs as both hospitals. Both are
green. The two caveats: the plan calls for **nine** reusable segments; only **eight** were ever
built, because J06 — the reference journey the plan's own build order says to extract segments
from — has no ninth ("statutory filing") leg to extract one from. And J12's assembly used some
genuinely new page-object code (`OPDRegistrationPage`, `OPDConsultationPage`,
`OPDLabOrderPage`), so "J12 assembled with zero new segment code" does not hold literally — see §2.

---

## 1. What was built

Eight segments, each a page object under `e2e/pages/`, built one at a time against the real local
dev server (never all written speculatively) and verified before the next started:

| # | Segment | Page object | Proven by |
|---|---|---|---|
| 1 | Registration / Admission | `IPDAdmissionPage.ts` | J06 Segment 1 |
| 2 | Encounter | `IPDWorkspacePage.ts` | J06 Segment 2 |
| 3 | Clinical documentation | `IPDWorkspacePage.ts` (notes helper) | J06 Segment 3 |
| 4 | Orders (OT) | `OTPage.ts` | J06 Segment 4 |
| 5 | Charge posting | `OTPage.ts` (end-case → push-charges) | J06 Segment 5 |
| 6 | Billing | `BillingPage.ts` | J06 Segment 6 |
| 7 | Claim (TPA) | `InsurancePage.ts` | J06 Segment 7 |
| 8 | Discharge | `IPDWorkspacePage.ts` (clearance stepper) | J06 Segment 8 |

**Segment 9, "Statutory filing," was never built.** The plan's build order is explicit: construct
J06 end to end, then extract segments from what J06 actually needed. J06 — admit → ward → OT →
discharge summary → claim → reconciliation — never touches a statutory-filing screen at any point,
so there was no real journey step to extract a ninth segment from. Building one speculatively
would have inverted the plan's own stated method (segments from a real journey, not designed in
advance). Left for whichever future journey actually needs it — most likely a claims-heavy or
compliance-focused spine, not yet scheduled.

## 2. "J12 assembled with zero new segment code" — the literal claim doesn't hold

D7's exit-gate line was written to mean: *the segment abstractions generalise — a second, materially
different journey doesn't require rebuilding admission/orders/billing from scratch.* That intent
**is** proven: J12 (OPD cash walk-in: register → token → consult → order → auto-bill → payment)
reuses the same `tenantOf` tenant-resolution helper J06 established, and its Orders/Charge-posting
step drives the same `postAncillaryOrderCharges`/dedupe-key billing pattern J06's OT segment
validated, rather than inventing a new billing mechanism.

But J12 is an **OPD** journey and J06's eight segments are all **IPD** screens (`IPDAdmissionPage`,
`OTPage`, ward workspaces) — there is no OPD registration or consultation page object to reuse, so
J12 needed three new ones: `OPDRegistrationPage.ts`, `OPDConsultationPage.ts`,
`OPDLabOrderPage.ts`. This is not a failure of the segment idea; it reflects that "segment" turned
out to mean "a reusable pattern for this kind of step" rather than "one literal file every journey
imports unmodified." Recorded here rather than left for someone to discover the gap between the
plan's wording and reality on their own.

## 3. What this phase found

Three entries in [KNOWN_BUGS.md](KNOWN_BUGS.md), all fixed and verified live:

| ID | Severity | Surface | What was silently broken |
|---|---|---|---|
| **KNOWN-BUG-208** | S2 | `DenialPredictorPanel.tsx` / `ClaimsToSubmit.tsx` | A hospital with no AI vendor configured (every local/dev environment, and any real hospital that hasn't set one up) could never submit a TPA/insurance claim, on any plan tier — the AI-review gate had no override path at all |
| **KNOWN-BUG-209** | S3 | `NewLabOrderModal.tsx` (`handleCollectAndCreate`) | A same-tick `setStep("success")` + `onCreated()` unmounted the modal before its own success screen ever painted — the order and charge were both correct, but the lab tech/nurse who just collected real cash got no "Payment Collected!" confirmation or print action |
| **KNOWN-BUG-207** | S3 | `service_charges` (`serviceBilling.ts`) | An anomaly, not a confirmed root cause: `.insert().select("id")` returns real ids with no error, but a direct `psql` read moments later finds zero rows. `bill_line_items` (the real source of truth) is unaffected. Explicitly not chased further — outside this phase's scope, flagged for whoever owns the Revenue Leakage Dashboard next |

## 4. Exit gate

| Gate criterion (verbatim from the plan) | Status |
|---|---|
| All nine segments callable and composable | ⚠️ Eight built; the ninth has no journey to extract it from — see §1 |
| Each carries state assertions, not completion checks | ✅ every segment asserts a DB row/value, never `toHaveURL` alone |
| Each runnable as either tenant | ✅ `tenantOf()` parameterises every journey spec |
| J06 green as both hospitals | ✅ |
| J12 assembled with zero new segment code | ⚠️ Reuses the billing/dedupe pattern and tenant helper; needed three new OPD page objects J06 has no equivalent of — see §2 |

## 5. Verification

```
npx playwright test e2e/journeys/j06-ipd-tpa-surgical.spec.ts --project=hospital-a   → 8/8 pass
npx playwright test e2e/journeys/j06-ipd-tpa-surgical.spec.ts --project=hospital-b   → 8/8 pass
npx playwright test e2e/journeys/j12-opd-cash-walkin.spec.ts --project=hospital-a    → 3/3 pass
npx playwright test e2e/journeys/j12-opd-cash-walkin.spec.ts --project=hospital-b    → 3/3 pass
npm run e2e:seed -- --check                                                          → idempotent
npm run check:db-contract                                                            → clean
```

## 6. What this phase does not claim

- **Segment 9 does not exist.** Not deferred to a named future phase in the plan itself — noted
  here as an open item for whoever next builds a journey that actually touches statutory filing.
- **"Zero new segment code" is aspirational, not literal**, per §2. The reusable *patterns* (tenant
  resolution, dedupe-keyed charge posting, module-recovery, state-not-completion assertions)
  generalised; the OPD-vs-IPD page objects did not.
- **KNOWN-BUG-207's root cause was not found.** Logged as an anomaly with the evidence gathered,
  not as a closed investigation.

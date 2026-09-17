# Review of the 11 Testing Documents — Read This Before Phasing

**Status:** Review and critique. Not a plan.
**Date:** 2026-09-10
**Scope:** All 11 documents in `docs/testing/`, verified against the repository as it stands today.

---

## Headline

The analysis is genuinely strong. The plan is not yet a plan.

Every factual claim I checked in these documents is accurate — unusually so. But the set contains
**six to eight unresolved decisions presented as open questions**, and phasing on top of open
decisions produces a plan that gets re-opened every week. "Is there anything to fix before planning
the phases" is exactly the right instinct, and the answer is yes.

The single biggest structural problem: **these documents contain 8 confirmed production defects
filed as testing items.** They are not testing items. Writing a test for a known-broken behaviour
produces a red suite on day one, which is the fastest available way to kill a brand-new test
suite's credibility.

---

## Verification pass — every ground-truth claim holds

I checked the numbers rather than trusting them. All correct:

| Claim | Source | Verified |
|---|---|---|
| 109 edge functions | `FULL_COVERAGE_METHODOLOGY.md:14` | ✅ exact |
| 217 pages / 568 components | `FULL_COVERAGE_METHODOLOGY.md:15-16` | ✅ exact |
| 612 migrations / 187 `src/lib` files | `FULL_COVERAGE_METHODOLOGY.md:17-18` | ✅ exact |
| 8 pgTAP files, all `booking-engine` | `PRODUCTION_TESTING_BRAINSTORM.md:12` | ✅ |
| Zero test files under `src/` | throughout | ✅ |
| `@playwright/test` ^1.57.0 installed; no `playwright.config.ts`; no `e2e/` | `PLAYWRIGHT_AND_MANUAL_TESTING_PLAN.md:12-15` | ✅ |
| `vitest.config.ts` exists, coverage reporter, no thresholds | `PRODUCTION_TESTING_BRAINSTORM.md:14` | ✅ |
| `insurance_pending` set/read nowhere in app code | `INSURANCE_PMJAY_BILLING_ANALYSIS.md:61-66` | ✅ zero hits in `src/` |
| CI runs only static structural checks | `PRODUCTION_TESTING_BRAINSTORM.md:15-17` | ✅ lint → 5 checks → build |
| All 11 cited `src/lib` files exist | various | ✅ |

**Three things no document mentions, all of which land in phase 0:**

1. **There is no `test` script in `package.json` at all.** Not `test`, not `test:coverage`, not
   `test:e2e`. But vitest, jsdom, `@testing-library/react` and `@vitest/coverage-v8` are all
   installed, `vitest.config.ts` is valid, and **`src/test/setup.ts` survived the purge**. The unit
   track is one line of JSON from running. `PLAYWRIGHT_AND_MANUAL_TESTING_PLAN.md:16` notices the
   missing script and then omits it from its own build order.
2. **No document says when a test job joins CI, or when thresholds get set.** Without that, the
   "ratchet" that `TEST_STRATEGY_RECOMMENDATION.md` and `FULL_COVERAGE_METHODOLOGY.md` both build
   on is an intention, not a mechanism — precisely what CLAUDE.md's Testing section already warns
   against claiming.
3. **The module count is stale in three places at once.** CLAUDE.md says 61, these docs say ~65,
   `ALL_MODULES` actually holds 67 (Operations 15, Clinical 13, Specialized 13, Finance 9,
   Analytics 7, Patient 3, Diagnostics/Surgical/Pharmacy 2 each, Settings 1). Harmless alone, but
   `FULL_COVERAGE_METHODOLOGY.md` wants to generate the master inventory *from* this registry —
   pin the number to generated output so the doc can never drift again.

---

## Verdict per document

| Document | Verdict | The one thing |
|---|---|---|
| `TEST_STRATEGY_RECOMMENDATION.md` | **Strongest of the 11** | Correction 1 — "the journey completed" must never be the assertion — is the most valuable single idea in the set, and it's backed by evidence rather than principle |
| `PATIENT_JOURNEY_TAXONOMY.md` | **Strong; the real engineering insight** | 9 reusable segments, not 16 monolithic scripts. This is what makes the whole approach survive month three |
| `REVENUE_LEAKAGE_ANALYSIS.md` | **Strong** | Two competing implementations of "is this already billed" is itself the leakage risk |
| `NOTIFICATION_SYSTEM_ANALYSIS.md` | **Strong; contains the most serious finding** | A hospital admin configuring "Code Blue → escalate to CMO in 5 min" is configuring nothing |
| `ABHA_NABH_ACCURACY_ANALYSIS.md` | **Strong** | A `SECURITY DEFINER` function whose comment asserts a tenant-isolation test that does not exist |
| `INSURANCE_PMJAY_BILLING_ANALYSIS.md` | **Strong** | Two uncross-checked "how much are we owed" numbers on two different desks |
| `CROSS_CATEGORY_CONNECTIVITY.md` | **Strong** | Five hubs, not 45 category pairs. Correctly reframes an intractable problem as a tractable one |
| `TEST_PREREQUISITES_STRATEGY.md` | **Correct and decisive; incomplete** | Right answer (Tier 0 / Tier 1), but the Tier-0 list is missing the second hospital |
| `FULL_COVERAGE_METHODOLOGY.md` | **Best durable idea; least acted on** | Generate the checklist from the code's own registries. Cheapest item on the list, proposed and never built |
| `PLAYWRIGHT_AND_MANUAL_TESTING_PLAN.md` | **Practical and useful** | "Deterministic fixtures, never random" is right and non-obvious. Manual has no named owner |
| `PRODUCTION_TESTING_BRAINSTORM.md` | **Good foundation; unresolved** | Its most useful section is "Unknown" — and none of those unknowns got resolved in the ten docs that followed |

---

## The 8 defects are not testing work

`TEST_STRATEGY_RECOMMENDATION.md:38-47` tabulates them as evidence for an assertion style. That's
a good use of them. But nothing in the 11 documents assigns them an owner, and three of them
**block writing the corresponding test at all** because they're product decisions, not code fixes:

| # | Defect | Type | Blocks a test? |
|---|---|---|---|
| 1 | `notification_config` read by nothing | **Product decision** — which config is canonical | Yes. `NOTIFICATION_SYSTEM_ANALYSIS.md:104-106` explicitly says defer the unit test until this is resolved |
| 2 | `bill_status='insurance_pending'` never set (verified: zero refs) | **Product decision** — wire it or drop it | Yes. `INSURANCE_PMJAY_BILLING_ANALYSIS.md:93-96` says testing it now tests an unreachable path |
| 3 | `balance_due` vs claim outstanding unreconciled | **Product decision** — is agreement an invariant or not? | Yes. Can't assert lockstep until someone says it's meant to be lockstep |
| 4 | `clinical_alerts` duplicates from `LabTATPanel` | Code fix + DB constraint | No, but the test fails until fixed |
| 5 | `LeakageScanner` substring matching | Refactor to one pure function | No, but the test fails until fixed |
| 6 | NABH engine's claimed-but-absent isolation test | Write the test, or fix the lying comment | This *is* the test |
| 7 | `visit_type` spelling drift | Consolidate to one constant | No, but journey 13 is untestable meaningfully until fixed |
| 8 | `nabh_criteria` seeding, `service_master.rate`, `modalities` | Historical, already fixed | No |

**Recommendation: split these into a remediation track with its own owner, and decide #1, #2 and
#3 before any phasing.** They are three product calls that take an afternoon to make and block
work in three different pods.

---

## Contradictions between documents

### 1. Three documents name three different first journeys

| Document | Says build first |
|---|---|
| `TEST_STRATEGY_RECOMMENDATION.md:107` | Journey B — IPD insured |
| `PATIENT_JOURNEY_TAXONOMY.md:56-65` | Tier 1 statutory — MLC, MCCD, partograph, neonatal, NDPS. Explicitly "supersedes the three journey spines" |
| `PLAYWRIGHT_AND_MANUAL_TESTING_PLAN.md:147-148` | J06 (IPD TPA surgical — a **Tier 2** journey) as reference implementation, *then* Tier 1 |

Someone starting Monday morning does not know what to build. Worth noting the taxonomy's own
ranking argument cuts against it: Tier 1 journeys are ranked by irreversibility, which is correct
for *risk*, but they are also the hardest to build and the most infrastructure-dependent — so
"Tier 1 first" and "first green signal soon" are in direct tension, and no document acknowledges it.

### 2. Staging: hard gate or parallel track?

`PRODUCTION_TESTING_BRAINSTORM.md:59-60` records Lakshmi as refusing infra sign-off "without a
staging environment existing first — treats it as a precondition, **not a parallel track**." The
recommendation at `:140-148` then makes it exactly a parallel track. The disagreement is recorded
and never resolved. This is a real fork with a 1–2 week consequence.

### 3. "Not a plan" documents containing ranked recommendations

Three documents are headed "Brainstorm only" / "Not a plan" and then close with ranked
recommendations. Fine as thinking. But if phasing starts here, nobody can tell which
recommendations are **decided** and which are **proposed**.

---

## Gaps across all 11

1. **No effort estimate or capacity number anywhere.** 16 journeys + 9 segments + 5 hub suites +
   unit tests on 4 surfaces + staging + second tenant + fixtures + inventory generator. Not one
   document says how long, or who. `PRODUCTION_TESTING_BRAINSTORM.md:175` deliberately excludes
   capacity — correct for a brainstorm, fatal for phasing. **This is the #1 thing to fix.**
2. **No definition of done for go-live.** Sunita's sign-off is "downstream of coverage + a green
   suite" (`PRODUCTION_TESTING_BRAINSTORM.md:33-34`) but no coverage number is ever named, and no
   document says what combination of green suite + sign-offs equals ship.
3. **The 109 edge functions are mentioned once and abandoned.** `FULL_COVERAGE_METHODOLOGY.md:67`
   gives them a positive/negative row; no other document returns to them. 109 server-side
   endpoints handling PHI, payments and government integrations, zero coverage, no plan. Largest
   silent hole in the set.
4. **The mobile app is absent entirely.** `mobile/` is a separate React Native/Expo project per
   CLAUDE.md. Not mentioned in any of the 11 documents.
5. **Test-data strategy is unresolved.** security-pod says synthetic data is a *precondition*
   because pentesting against real PHI is itself a DPDP violation
   (`PRODUCTION_TESTING_BRAINSTORM.md:38-40`). data-pod wants "realistic volume"
   (`:98`). `TEST_PREREQUISITES_STRATEGY.md` describes small deterministic fixtures. These three
   are in tension and nobody reconciles them.
6. **No flake or maintenance budget.** A 16-journey Playwright suite against a live Supabase will
   flake. No quarantine policy, no retry policy, no owner for a red main branch.
7. **Tier-0 fixture list is missing the second hospital.**
   `TEST_PREREQUISITES_STRATEGY.md:32-40` lists one `hospitals` row. Every other document treats
   two-tenant isolation as the top risk. The second tenant belongs in Tier 0, not discovered later.
   Also missing: `get_user_hospital_id()` edge cases, which Arjun flags as the single function most
   RLS policies depend on (`PRODUCTION_TESTING_BRAINSTORM.md:56-58`).
8. **Manual testing has no named owner** despite being assigned the "frontier" role in
   `PLAYWRIGHT_AND_MANUAL_TESTING_PLAN.md:111`.

---

## Ranked recommendations before phasing begins

1. **Decide the three blocked product questions** — canonical notification config; wire-or-drop
   `insurance_pending`; is bill/claim agreement an invariant. Each blocks a different pod's tests.
2. **Split the defect backlog out of the test plan** and give it an owner. Tests written against
   known-broken behaviour produce a red suite on day one.
3. **Pin the first journey.** Three documents, three answers.
4. **Wire the plumbing this afternoon** — `test` script, CI job, vitest `coverage.include` plus a
   floor threshold. Start the threshold at whatever today's number is and ratchet; a threshold of
   zero that *exists* is infinitely better than none, because it turns the ratchet into a mechanism.
5. **Get an effort estimate and a capacity number.** Without it, "phases" is just an ordered list.
6. **Resolve staging-as-gate vs staging-as-parallel-track.** Lakshmi's objection is unanswered and
   carries a 1–2 week consequence.
7. **Build the generated inventory.** `FULL_COVERAGE_METHODOLOGY.md` proposes it, it's the cheapest
   item on the list, it's the tracking substrate for everything else, and it's the only concrete
   deliverable proposed across all 11 documents and not built.
8. **Define go-live done** — coverage number, green-suite requirement, sign-off list.
9. **Decide the edge-function coverage strategy.** 109 endpoints is not a footnote.
10. **Reconcile synthetic vs realistic test data** against security-pod's DPDP constraint.
11. **Answer the three non-testing unknowns**: is a pilot hospital actually committed; who owns
    clinician sign-off on the interaction/allergy ruleset; is live Razorpay in scope for cohort 1.
    All three are already flagged in `PRODUCTION_TESTING_BRAINSTORM.md:111-119` and none were
    resolved by the ten documents that followed.

---

## What's genuinely good and should survive phasing unchanged

- **Assert on resulting state, never on completion.** Evidence-backed, and the single idea most
  likely to determine whether this suite catches real bugs.
- **Nine reusable segments, assembled into journeys.** The difference between a suite that scales
  and one that collapses in month three.
- **Five hubs, not 45 category pairs.** Correctly makes an intractable problem tractable.
- **Deterministic fixtures for anything feeding a calculation.** Right, and non-obvious.
- **Generate the checklist from the code's registries, not from memory.**
- **Risk-rank by irreversibility, not by volume.**
- **Unit tests start now, in parallel — they need no infrastructure.** Correct, and now even more
  so than the documents realised: the vitest harness is already installed and configured.

---

## Process note

Six specialist pods (quality, data, revenue, security, clinical, platform) were routed to review
these documents in parallel and did not run — the session hit its API limit before activation. This
review is a direct read plus codebase verification, not pod output. The pod review is still worth
running on the specific surfaces above, particularly revenue-pod on the bill-vs-claim invariant and
security-pod on the test-data DPDP question.

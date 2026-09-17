# Testing ABHA and NABH — What "Accurate" Actually Means for Each

**Status:** Analysis, grounded in the actual code. Not a plan.
**Date:** 2026-09-10

These two are different kinds of "accurate" and need different tests. ABHA accuracy is about
*whether an ID is real* — that can only be confirmed against a government system, never locally.
NABH accuracy is about *whether a computed compliance number is correct and complete* — that's
fully verifiable inside the codebase, because the formulas live here.

---

## ABHA — format-valid is not the same as real

[abdm-validators.ts](../../src/lib/abdm-validators.ts) has clean, pure, already-testable
validators: 14-digit ABHA number, ABHA address (`name@abdm`), 10-digit mobile, HPR ID, Aadhaar
format. Good foundation — these are exactly the kind of pure functions that should be unit tested
directly, no mocking needed.

**The limit to be explicit about:** `validateAadhaarFormat` checks digit count and that it doesn't
start with 0/1 — it does **not** run the Verhoeff checksum real Aadhaar numbers carry, and the ABHA
number validator similarly checks length only, not a check-digit. That means a syntactically
plausible but entirely fake 12-digit number passes this validator. That's fine *as a UX filter*
(catch obvious typos before a network call) but it's not proof the ID is real — the only thing that
can confirm that is the actual ABDM gateway (OTP-based verify/exists calls), which requires network
access to a government system and can't be simulated locally with certainty.

**How to test this correctly:**
1. Unit test the pure validators directly against known-good/known-bad strings — cheap, fast, no
   infra needed, should happen regardless of anything else.
2. Write the unit tests to explicitly prove the boundary: a fake-but-well-formed number **passes**
   local validation (this is expected behavior, not a bug) — so nobody later "fixes" the validator
   to reject it and breaks real edge cases, and so it's documented that format validation was never
   meant to be the accuracy check.
3. The actual accuracy check needs an integration test against **ABDM's sandbox environment**
   (which ABDM provides for HIP/HIU testing) — mock the gateway response for both a genuine
   exists/verify success and a not-found/invalid response, and assert the app handles both
   correctly (does not treat a gateway timeout or error as "verified," for instance).
4. Test the two compliance rules the `abdm-fhir` skill already names as mandatory: the audit trail
   actually gets written on every ABHA-linked action, and no FHIR resource or PHI is ever shared
   before a valid, unexpired consent artifact exists. Both are "did this silently not happen"
   checks, same shape as the NABH evidence-completeness gap below — worth testing them the same
   way: seed the scenario, assert the audit/consent row exists, not just that the UI didn't error.

---

## NABH — the indicator engine is well-built; the safety net around it is not

Two systems, and they're at very different quality levels.

### The good part: the indicator engine is genuinely well-engineered

[quality_indicator_collectors.sql](../../supabase/migrations/20261011000030_quality_indicator_collectors.sql)
computes real NABH formulas per chapter (AAC, and presumably others by the same pattern) with care
that reflects actual domain knowledge, not guesswork:
- Patient-days computed as *exposure time in a bed*, not discharge count — matches what NABH
  actually expects as a denominator.
- A NULL denominator is deliberately kept NULL rather than defaulting to 0, so "no exposure this
  period" doesn't get misreported as a 0% rate — the comment is explicit: "never a raw count
  dressed up as a rate."
- Explicit dedup between `safety_events` and `incident_reports` so a hospital using both doesn't
  double-count the same fall or medication error.

This is exactly the kind of pure, deterministic, SQL-level logic that's cheap to test with high
confidence: seed known admissions/tokens/events, call the collector function directly, assert the
exact numerator and denominator NABH would expect. Because the formulas are already correct, the
test's job is to *keep* them correct as the schema evolves — a regression net, not a bug hunt.

### The gap: a comment promises a test that was never written

The same file's header comment states, about its `SECURITY DEFINER` privilege escalation (needed
because these functions read across tables a ward clerk's role can't):

> "that predicate is the only thing standing between tenants. **The security test asserts it.**"

I checked — `supabase/tests/` contains 8 pgTAP files, all scoped to the `booking-engine` schema.
**There is no test anywhere in the repo for this engine's tenant isolation.** The comment describes
a safety net that doesn't exist. That's worse than no comment at all — it tells a future reader
this is covered when it isn't, which is exactly the kind of false confidence this whole testing
effort is trying to eliminate.

Given this engine runs with elevated privilege specifically to cross RLS boundaries, and its only
protection is "the predicate says `hospital_id = p_hospital_id`, trust me" — this is a direct
instance of the automated two-hospital isolation test every pod in the original brainstorm called
for, now identified on a specific, high-privilege function rather than as an abstract ask.

### A second, quieter completeness gap

`logNABHEvidence()` in [nabh-evidence.ts](../../src/lib/nabh-evidence.ts) is deliberately built to
never throw — a module's clinical action (lab verification, OT close, consent) must not fail just
because the accreditation log write failed. That's the right call functionally, but it means a
silently failing insert (bad hospital_id, RLS misconfiguration, a schema change that breaks the
insert shape) produces nothing louder than a `console.error` — no alert, no dashboard, nothing a
compliance officer would ever see. For a table whose entire purpose is "prove to an auditor this
happened," an undetected gap in the evidence trail is exactly the failure mode that matters most,
and there's currently no way to know it's not happening. Worth noting: this file's own comment
documents that the *previous* version of this exact pattern silently failed for all ~50 call sites
for months (writing to a table that was never seeded) before anyone noticed — this isn't a
hypothetical risk, it's a repeat of a bug that already happened once.

---

## How to test both, concretely

1. **Unit test `abdm-validators.ts` directly** — fast, no infra, start today. Include the
   deliberate "fake but well-formed passes" case as a documented, asserted behavior.
2. **Integration-test against ABDM's sandbox** for real verify/exists calls — this is the only
   test that proves an ABHA ID is genuine, and it needs to be a distinct test tier from the unit
   tests above, not conflated with them.
3. **pgTAP-test the NABH collector functions** (`qi_collect_aac` and siblings) against seeded data
   with known expected numerator/denominator — protects the domain logic that's already correct
   today from regressing silently later.
4. **Write the tenant-isolation test the comment already claims exists.** Call a collector as one
   hospital's context, seed data for a second hospital, assert zero cross-contamination. This is
   the single highest-value test in this document — it's a `SECURITY DEFINER` function, the blast
   radius of it being wrong is every quality-indicator number a hospital reports being wrong or
   leaking another hospital's data, and right now literally nothing checks it.
5. **Add a completeness/reconciliation check for `nabh_evidence_log`** — the same pattern as the
   revenue-leakage reconciliation already discussed: for a sample of events that should produce
   evidence (OT close, lab verification, consent signed), assert a corresponding log row exists.
   Given this exact silent-failure shape has already happened once in production, treat it as a
   near-certain recurrence risk, not a theoretical one.

---

## Not done here

No code was changed. Writing the missing tenant-isolation test for the NABH engine is the one item
here I'd flag as urgent rather than sequenced — it's a privilege-escalated function with a comment
actively asserting a test that isn't there.

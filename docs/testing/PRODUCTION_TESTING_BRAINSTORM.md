# Testing Aumrti for Production Go-Live — Brainstorm

**Status:** Brainstorm only. Nothing here is a plan, a sequence, or a commitment of capacity.
**Date:** 2026-09-10
**Participants:** Nikhil (PM, synthesis) + quality-pod, security-pod, clinical-pod, data-pod,
revenue-pod, platform-pod, growth-pod (brainstorm-only mode, no code touched).

---

## Ground truth, confirmed before anyone speculated

- `supabase/tests/` has 8 pgTAP files — all scoped to the `booking-engine` schema. Zero automated
  coverage for OPD, IPD, Pharmacy, Billing, or RLS anywhere else.
- `vitest.config.ts` has a coverage reporter with **no thresholds set**.
- CI runs three *static structural* checks (`check:rls-coverage`, `check:user-fk`,
  `check:db-contract`) — none of them execute against a live two-tenant database. They prove a
  policy *exists*, not that it's *correct*.
- No staging environment exists anywhere in the repo.
- No second hospital tenant (real or synthetic) exists to test isolation against.
- No backup has ever been restored and verified.

In short: this isn't "extend coverage," it's a ground-zero rebuild of test infrastructure.

---

## What each pod said

### Quality — Naveen, Sunita, Imran, Meghana, Manoj
Non-negotiable blockers: unit coverage on `drugSafetyCheck`, `clinicalCalculators`,
`gstRules`/billing totals (the three CLAUDE.md already names); one automated two-hospital RLS
isolation test; an E2E happy path across OPD→Lab→Billing→Discharge; list virtualization + a
tablet p95 perf budget. **Sunita will not give a blanket QA sign-off today** — there's nothing to
verify against yet, and her sign-off is contractually downstream of coverage + a green suite
existing first. She also rejects "test in prod" as adequate.

### Security — Ananya, Suresh, Prakash, Saroja
RLS alone isn't sufficient — app-layer trust of a client-supplied `hospital_id` is a separate leak
vector. A synthetic/de-identified dataset is a **precondition** for security testing, not a
nice-to-have — pentesting against real PHI is itself a DPDP violation. Ananya (RLS/OWASP) and
Prakash (Aadhaar/ABHA path specifically) both want a third-party pentest as non-negotiable before
real PHI flows. Saroja flags a different failure mode: statutory clocks (MRD lock, MLC
police-intimation, MCCD) need to be verified as **actually firing**, not just present in code —
silent failure here is worse than the feature not existing.

### Clinical — Priya, Dr. Ramesh, Suma, Mohan, Radha, Shivam
Unanimous and unprompted: drug interaction/allergy checks and time-bound alerts (NEWS2, MLC
intimation) are non-phaseable — CLAUDE.md's "never mocked or skipped, including in demos" leaves
no room for "phase 2." What *can* phase: alert-fatigue tuning, not alert delivery. Sharpest gap:
**no evidence a licensed clinician has validated the interaction/allergy ruleset itself** (as
opposed to the code that calls it) — Dr. Ramesh wants this as an independent sign-off, separate
from and prior to QA. Suma flags an untested question: does dispensing **block** or silently
**allow** if the interaction-check API times out?

### Data — Meera, Arjun, Lakshmi
Confirmed by file search: no staging, no second-tenant fixture, no validated backup/restore.
Arjun flags `get_user_hospital_id()` as the single function most RLS policies depend on, with no
dedicated test of its edge cases (null hospital_id, mid-transfer user, service-role bypass).
Migrations are forward-only in practice — "rollback" today means shipping a corrective migration
live. **Lakshmi won't sign off infra readiness without a staging environment existing first** —
treats it as a precondition, not a parallel track.

### Revenue — Ravi, Girija, Balaji, Ashok, Pooja
Same blocker tier as clinical, reached independently: `gstRules`/billing-totals unit coverage plus
one real E2E billing path. Every specialist independently reached for
**parallel-run/shadow-operations** as the thing that actually builds trust: Girija wants GSTR
reconciliation against a real month, Balaji a week of shadow billing against the manual process,
Ashok a Tally tie-out to the penny. Flagged gap: **no mechanism today, automated or otherwise, to
detect a GST/billing error after it reaches a live invoice** — that's a control gap, distinct from
a testing gap.

### Platform — Karan, Neha, Anita, Aditya, Sneha
No real second-tenant provisioning test exists — everything exercised so far is single-tenant
happy path, which Karan calls the single biggest blind spot given the pod's own rule (gate
cross-tenant admin access on `aumrti_admins`, never `hospital_id`). Neha flags the full
provisioning chain has never been tested end-to-end as one chain; partial-provisioning rollback
(a half-seeded tenant) is untested. Aditya raises a scoping question worth answering directly:
**is live Razorpay billing even in scope for the first cohort?**

### Growth — Anjali, Rohit, Usha
All three converge: with automated coverage at zero, every validation today is manual/human-run —
workable for one pilot hospital, not workable as a repeatable multi-hospital process. Anjali wants
reconciliation (record counts + financial control totals) as a hard gate before any real patient
touches the system, and flags that **post-go-live "rollback" for patient data isn't a database
restore** — once real encounters/prescriptions exist only in Aumrti, reversal is a manual forward
reconciliation, hospital by hospital. Rohit wants a single low-risk pilot hospital, not simultaneous
multi-hospital launch — and neither he nor Anjali has visibility into whether a pilot hospital is
actually committed yet, as opposed to "said maybe."

---

## Cross-cutting synthesis

**Agreed, converged independently across pods:**
- This is a ground-zero rebuild, not a coverage extension.
- Drug safety, clinical calculators, and GST/billing totals are the three non-negotiable blockers —
  named by quality, clinical, and revenue independently, without being asked to converge.
- No staging environment exists (data-pod, quality-pod).
- No second real or synthetic tenant with realistic data volume exists (data-pod, quality-pod,
  platform-pod — three separate confirmations).
- Cross-tenant isolation needs an automated *behavioral* test, not just the static CI checks that
  exist today — at both the DB/RLS layer and the control-plane layer. Two blind spots, same shape.
- No single pod will claim sole sign-off authority on "safe for real PHI / real money / real
  go-live" — every pod pushed this to a cross-functional or CEO-level decision.
- Parallel-run/shadow-operation, not big-bang cutover, is the instinctive answer across revenue,
  growth, and (implicitly) quality. Nobody argued for a hard cutover.

**Contested:** Almost nothing. The closest thing to friction is intensity, not disagreement —
Suresh frames statutory readiness as a config audit; Ananya/Prakash frame their slice as requiring
a full third-party pentest. Not a conflict, just different-weight items on the same list.

**Unknown — the most useful output:**
- No confirmed pilot hospital (Rohit and Anjali both lack this visibility).
- No mechanism to detect a GST/billing error *after* it reaches a live invoice.
- No confirmation a clinician has ever validated the interaction/allergy **ruleset** itself, versus
  the code path that calls it.
- No confirmation of current ABDM HIP/HIU certification status.
- Unclear whether live Razorpay billing is in scope for the first go-live cohort.
- No backup has ever been restored and verified — an unvalidated RPO is "a guess with a unit
  attached."

---

## Five candidate philosophies (not mutually exclusive, not a decision)

| # | Approach | First move | Strongest case | Weakest point |
|---|---|---|---|---|
| 1 | **Bottom-up** | Rebuild `src/lib` unit tests first (drug safety, calculators, GST) | Fast, cheap, no infra dependency, hits the 3 named blockers immediately | Can reach perfect unit coverage while still leaking PHI cross-tenant on day one — never touches isolation or infra |
| 2 | **Top-down** | E2E smoke tests across critical cross-module flows | Proves the seams hold; closest to real user experience | Blocked on a test framework and staging that don't exist yet — risks being slowest to first signal |
| 3 | **Risk-based** | Patient-safety + multi-tenant isolation first, everything else after | This is what all 7 pods converged on unprompted | Its top-priority item (2-hospital isolation test) is itself blocked on infra that doesn't exist — runs into the infra gap on day one |
| 4 | **Infra-first** | Staging + second-tenant fixture + validated backup/restore, before writing any test | Unblocks nearly everything else; closes the DPDP problem of testing against real PHI | Invisible progress for a stretch — no coverage number moves; needs a hard time-box or it stalls |
| 5 | **Parallel-run / shadow-ops** | Run Aumrti alongside the legacy process at the pilot hospital — shadow billing, parallel GST reconciliation, staff training in parallel | Every pod that touched this reached for it independently; tests the real system, not a fixture | Still needs *some* baseline verification before trusting a live hospital in shadow mode; doesn't scale past the first hospital or two |

---

## My recommendation

The pods didn't disagree on priority — they disagreed on what's *blocking* what. Reading across
all seven, the actual dependency graph looks like this:

1. **Infra-first, but time-boxed (1–2 weeks, not open-ended).** Staging environment + a synthetic
   second-tenant fixture with realistic volume + one validated backup/restore cycle. This is what
   data-pod and quality-pod both said they can't responsibly test without, and it's also what
   turns security-pod's "pentest against real PHI is a DPDP violation" objection into a solved
   problem. Give it a hard deadline — this is the philosophy most likely to quietly become
   permanent if left open-ended.
2. **In parallel, not after: bottom-up unit tests on the three named blockers** (drug safety,
   clinical calculators, GST/billing totals). These don't need staging or a second tenant — no
   reason to wait on infra to start them, and they're the fastest win available right now.
3. **Once infra lands, risk-based becomes actually executable** — the automated two-hospital
   isolation test (both DB/RLS and control-plane layers) becomes the first thing built on top of
   the new staging environment, ahead of general E2E coverage.
4. **Treat shadow-ops/parallel-run as the go-live gate for the pilot hospital, not a substitute
   for the above.** It's a good final check, not a way to skip building the automated safety net —
   revenue-pod's own gap ("no way to catch a GST error after it hits a live invoice") is exactly
   the kind of thing shadow-running would catch *once*, at one hospital, not systematically.

Two items don't belong in a testing plan at all and should be resolved before one gets written:
- **Clinician sign-off on the interaction/allergy ruleset itself** — that's a clinical-governance
  and liability question, not a QA task. Dr. Ramesh flagged it as missing; it needs an owner
  outside this testing effort.
- **Whether a pilot hospital is actually committed.** Rohit and Anjali both said they don't know.
  Sequencing a go-live testing effort without knowing if there's a hospital to go live *at* is
  building the plan on a guess.

Nikhil also flagged this and I'd underline it: **several of the open unknowns above (staging
existence as a hard gate, pilot hospital commitment, acceptable residual risk on revenue-critical
code) are go/no-go calls, not testing-strategy calls.** That's a decision for whoever owns go-live
risk acceptance — worth a short Preethi-level conversation before this turns into a sequenced
plan, so the plan isn't built on assumptions about risk tolerance nobody's actually confirmed.

---

## What this document deliberately does not do

No sequencing, no sprint plan, no RICE scoring, no capacity commitment. Per the user's instruction,
this is brainstorm output only.

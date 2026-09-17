# Phase 6 — Edge functions: completion record

**Phase:** 6 of [PHASED_TEST_PLAN.md](PHASED_TEST_PLAN.md) §8 · **Date:** 2026-09-13

**Status: MOSTLY DONE — one gate item genuinely outstanding, and it is not an engineering one.**
Every mechanical exit-gate criterion is met: 100% of category 1–4 functions (PHI, Money,
Statutory/external, Tenant lifecycle) pass all four assertions, `check:no-phi-logs` is real and
wired into CI, the tenant provisioning chain is proven end-to-end including partial-failure
rollback, and the remaining 42 long-tail functions are named in `INVENTORY.generated.md` with an
owner and Phase 10. **What is not clean is the fifth AI-specific assertion**: Dr. Nalini's
governance review happened and is documented, but it does not read as an unconditional sign-off —
it blocks two components outright and withholds sign-off on continued PHI flow through all eight
clinical AI functions pending a DPA and consent artefact that do not exist yet. See §4.

---

## 1. Scope and method

109 edge functions, zero prior coverage at the start of this phase. Each of the 65 functions now
covered got the same four assertions per [PHASED_TEST_PLAN.md](PHASED_TEST_PLAN.md) §Phase 6: a
valid authenticated request succeeds, missing/invalid auth is rejected, a malformed payload never
500s with a stack trace, and no PHI reaches `console.*`. Every fix was verified against the real
local edge-runtime (`npx supabase functions serve`) with real Tier-0 fixtures — never mocked — and
every migration was re-verified with a full `supabase db reset` + reseed before being called done.

Work proceeded in the plan's own priority order (D8):

| Priority | Scope | Functions | Status |
|---|---|---|---|
| 1 — PHI-handling | patient exports, FHIR, lab ingest, the 15 `ai-*` clinical/operational functions | 25 | ✅ all four assertions |
| 2 — Money | invoicing, GST e-Invoice, journal postings, Tally export, leakage/anomaly scans, Razorpay subscription path | 15 | ✅ all four assertions |
| 3 — Statutory/external | ABDM (10), HCX, PMJAY, ESI, CGHS, HMIS/IHIP, IDSP | 19 | ✅ all four assertions |
| 4 — Tenant lifecycle | register/setup/delete-hospital, create-staff-login, admin-impersonate-start, purge-orphaned-users | 6 | ✅ all four assertions, chain proven end-to-end |
| 5 — Long tail | notifications, Playwright-covered onboarding endpoints, cron jobs, seed/dev utilities | 42 | Deferred to Phase 10 per plan, each with an owner in the inventory |

---

## 2. What this phase found

34 entries were added to [KNOWN_BUGS.md](KNOWN_BUGS.md) this phase (KNOWN-BUG-170 through -204,
with 178 reserved and never used). **Nine were S1, no waiver, and all nine are now fixed and
verified** — this is the headline result of the phase, not a footnote:

| ID | Function | What was silently broken |
|---|---|---|
| **KNOWN-BUG-171** | `fhir-export` | Fully unauthenticated cross-tenant PHI leak — anyone could pull another hospital's FHIR bundle |
| **KNOWN-BUG-179** | `razorpay-subscription-webhook` | A hospital's very first subscription webhook created no database row at all, while reporting success |
| **KNOWN-BUG-182** | `supabase/config.toml` | The largest single finding of the phase — Razorpay/ABDM/HCX webhook receivers were never reachable at all under the platform's default JWT verification, silently rejecting every provider callback |
| **KNOWN-BUG-185** | `hcx-callback-receiver` | The "sandbox fallback" for a failed decryption fired unconditionally instead of only when no key is configured — a forged/corrupted HCX callback was accepted as genuine |
| **KNOWN-BUG-187** | `submit-pre-auth-hcx` | A broken PostgREST embed meant this pre-auth submission path has never worked at all |
| **KNOWN-BUG-188** | `cghs-eligibility` | Unauthenticated cross-tenant PII leak — no auth gate existed at all |
| **KNOWN-BUG-190** | `hmis-portal-submit` | Total feature failure for every real account (×2 stacked defects) |
| **KNOWN-BUG-191** | `pmjay-claim-submit` | Total feature failure — wrong config table, wrong column, case-mismatched CHECK value (×3 stacked) |
| **KNOWN-BUG-195** | `register-hospital` | **The single most severe functional finding of the phase, and arguably of the whole session**: self-service hospital signup has never once successfully created a hospital, in any deployment of this codebase, ever — `public.users.id` was never set on insert. The failure was clean (rollback always fired, no orphaned data) but every prospective customer who ever filled out `/register` got a generic error and no account |

Of the remaining 25 entries, 23 are S2/S3 — silent wrong results, missing entitlement checks, or
`.catch()`-on-a-non-Promise crashes, each fixed and independently verified — and 2 are the S1
findings from Dr. Nalini's governance review that are deliberately NOT fixed in this pass (§4). See
KNOWN_BUGS.md for the full narrative on each; they are not repeated here.

**One new S2 came out of the AI-plumbing pass specifically** (KNOWN-BUG-204): both
`ai-history-ingest` and `ai-history-digest` had no auth check at all — the same defect class as
KNOWN-BUG-126/-199, but on the outside-medical-records-scan feature. A hospital B user could
name hospital A's `job_id` and drive hospital A's scan, or purge any hospital's staged files via
an unauthenticated `sweep`. Fixed and verified.

**Two S1 findings remain open, deliberately not fixed in this pass** — see §4.

---

## 3. Tenant provisioning chain — the plan's own explicit ask

> "the provisioning chain has never been tested end-to-end as one chain, and partial-provisioning
> rollback is untested" — D8, quoted in the plan.

Now covered as one chain: `register-hospital` (KNOWN-BUG-195, now genuinely creates a hospital,
with `public.users.id` confirmed independent of `auth_user_id`) → `setup-hospital` (the alternate,
currently-uncalled provisioning path, KNOWN-BUG-196, same identity-conflation bug plus a crashing
`.rpc().catch()`) → `create-staff-login` and `admin-impersonate-start` (KNOWN-BUG-197, wrong
tie-break ordering on the no-`super_admin` fallback) → `delete-hospital`'s soft-delete → restore →
purge lifecycle → `purge-orphaned-users`. The rollback-on-partial-failure path for
`register-hospital` was independently reproduced and confirmed clean (no orphaned `hospitals` or
`auth.users` rows) before any code change.

One deliberate, documented exception to "run in the normal suite": `purge-orphaned-users`'s real
deletion path was caught non-deterministically deleting another test file's in-flight fixture when
run in parallel with the rest of the suite. It now runs its two non-destructive auth-gate checks in
the routine suite; the deletion logic itself was verified twice by running that file alone. See the
methodology note in `KNOWN_BUGS.md`'s `## Numbering` section.

---

## 4. The fifth assertion — AI governance — is not cleanly closed

The plan's own words: *"Every clinical-path AI function is gated, audited and confirmation-bound,
asserted at the choke point; **Nalini's written AI governance sign-off obtained** on the
clinical-path set."*

**The plumbing half is done and verified.** Every one of the 15 `ai-*` functions now has: a real
auth gate, the hospital's AI entitlement enforced server-side (`resolveAiConfig`'s transitive
`checkAIAllowed`, KNOWN-BUG-200/201/204), `AIDisabledError` answered as a clean 403 rather than a
confusing 500, and no PHI in logs. Two internal-only functions that had **no auth check at all**
were found and fixed (`ai-safety-guard`, KNOWN-BUG-199; `ai-history-digest`/`ai-history-ingest`,
KNOWN-BUG-204).

**The governance half is real, but it is not a sign-off in the sense the plan meant.** Dr. Nalini's
review is written up in full at [PHASE_6_AI_GOVERNANCE.md](PHASE_6_AI_GOVERNANCE.md). Verbatim
outcome:

- 2 of 8 functions **approved as-is** (`ai-clarifying-questions`, `ai-resolve-orders`).
- 4 of 8 **approved with conditions** tracked this quarter, not blockers (`ai-safety-guard`,
  `ai-clinical-guidelines`, `ai-differential-diagnosis`, `ai-radiology-impression`).
- 2 of 8 **BLOCKED, specific components**, and neither is fixed in this pass:
  - **`ai-discharge-summary`** — the AI-drafted medication list reaches the patient's discharge
    record and WhatsApp **without ever passing through the deterministic drug-safety pipeline**,
    a direct violation of CLAUDE.md's "drug checks are never skipped" rule. Logged as
    **KNOWN-BUG-202, S1, no waiver.**
  - **`ai-icd-suggest`** — auto-persists an AI-suggested ICD code to the real billing record at
    ≥80% confidence before any human clicks anything, with real PMJAY/insurance-claim risk.
    Logged as **KNOWN-BUG-203, S1, no waiver.**
- **Cross-cutting, applying to all eight**: sign-off on continued PHI flow to any AI provider is
  **withheld**, not granted — no DPA exists with any of the six configured providers, no
  purpose-specific "AI-assisted processing" consent artefact exists separate from general
  treatment consent, and `ai_usage_logs` has no `consent_id` column to attach one to even if it
  did. Dr. Nalini explicitly did not order these live features shut off unilaterally — real
  hospitals are on them today — and instead escalated the pause-vs-consent-banner-vs-DPA-fast-track
  decision jointly to Preethi (CEO), Suresh (Regulatory) and Vikram (CTO).

**So the honest claim for this gate is:** the review happened, is documented, and is more rigorous
than a rubber stamp — but "Nalini's sign-off obtained" cannot be read as "approved." Two components
are blocked outright and the PHI-flow question for the whole set is an open escalation, not a
closed one. This phase does not close that loop; it surfaces it precisely, with owners named in
`PHASE_6_AI_GOVERNANCE.md` §Action items (Arnav for both blocked fixes, Meera/Ananya/Dr. Nalini for
the consent artefact).

---

## 5. Exit gate

| Gate criterion (verbatim from the plan) | Status |
|---|---|
| 100% of category 1–4 functions covered on all four assertions | ✅ 65/65 confirmed via `INVENTORY.generated.md`'s auto-detected E2E column |
| `check:no-phi-logs` exists, wired into CI, passes | ✅ `.github/workflows/ci.yml` step "PHI-in-logs check"; 312 `console.*` calls scanned, 0 flagged |
| Tenant provisioning chain passes end-to-end, including partial-failure rollback | ✅ §3 |
| Every clinical-path AI function gated, audited, confirmation-bound; Nalini's written sign-off obtained | ⚠️ **Plumbing: ✅. Sign-off: partial — see §4.** 2 of 8 components BLOCKED (KNOWN-BUG-202/203), PHI-flow sign-off withheld pending DPA/consent, escalated to CEO/CTO/Regulatory jointly |
| Remaining functions listed in the inventory with an owner and a target phase | ✅ all 42 long-tail functions carry an owner and "Phase 10" in `INVENTORY.generated.md` |

---

## 6. Verification

```
npx vitest run                        → 100 files, 1635 passed, 4 skipped, 0 failed
npm run check:no-phi-logs             → 312 console.* calls scanned, 0 flagged
npm run check:db-contract             → 555 tables, 117 functions, 107 edge functions, 1260 files resolve
npm run check:rls-coverage            → 567 tables, all have RLS somewhere in migration history
npm run check:user-fk                 → 40 columns repointed, 16 legitimate auth.users references
npm run check:inventory               → INVENTORY.generated.md current (1147 lines)
npx supabase db reset                 → all Phase 6 migrations (20261106000022–028) applied clean
```

`e2e/edge-functions/` now holds 60 test files exercising 65 distinct edge functions (some files —
`ai-clinical-plumbing-regression.test.ts` — deliberately cover several functions that share one
fix). Every one runs against the real local edge-runtime with real fixtures; none mocks Supabase.

---

## 7. What this phase does not claim

- **AI governance sign-off is not "done."** §4 is the precise statement; do not compress it to
  "Nalini approved the AI functions." Two components are blocked and a cross-cutting PHI/consent
  question is escalated, unresolved, to three named executives.
- **The entitlement-*disabled* branch is not independently live-tested for most AI functions.** It
  requires a real `hospital_subscriptions` row, a contested `UNIQUE(hospital_id)` singleton already
  exercised by several other test files this phase — verified instead by direct code inspection
  against `_shared/ai-config.ts`'s own `resolveAiConfig`/`AIDisabledError` contract, documented
  function-by-function in KNOWN_BUGS.md.
- **No live government-gateway call** (NIC IRP, ABDM, HCX, HMIS/IHIP, PMJAY) was exercised against
  a real sandbox from this environment — same limitation Phase 4 and Phase 5 already stated.
- **The 42 long-tail functions are named, not tested.** "Listed with an owner and a target phase"
  is what the plan's own exit gate asks for at this stage — it is not a claim that they work.
- **KNOWN-BUG-189** (`ClaimsPackWizard.tsx`'s PMJAY call-shape mismatch, S2, found as a drive-by
  during the Priority-3 pass) is logged but not fixed — scoped to Phase 9, frontend-pod +
  revenue-pod, per the same "needs product/UI design work, not a mechanical patch" reasoning
  Phase 5 already established for comparable findings.

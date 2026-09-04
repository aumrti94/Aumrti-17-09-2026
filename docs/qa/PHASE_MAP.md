# Phase Map

15 phases, ordered so nothing is ever tested before the things it depends on exist.

**Rule:** you do not start phase N+1 until phase N's gate is green. See
[README.md](README.md#phase-gate--when-is-a-phase-actually-done).

---

## Overview

| # | Phase | Scenarios | Anchor modules | Cross-module hops proven |
|---|---|---|---|---|
| 1 | Foundation & Access | — (9 sections) | `/register`, `/setup/onboarding`, `/login`, RBAC, plan gating, tenant isolation | this *is* the prerequisite |
| 2 | Settings & Masters | — (50 screens) | every screen in `src/pages/settings/` | each setting → the module it unlocks |
| 3 | Patient & Records | 12 | patients, kiosk, portal, ABHA/ABDM | → OPD, → MRD |
| 4 | **OPD Journey** | 24 | OPD workspace + tabs, schedule, telemedicine, Voice Scribe | → Lab, Radiology, Pharmacy, Billing, IPD, Accounts |
| 5 | **Lab & Radiology** | 16 | lab, radiology, PCPNDT, PACS | ← OPD/IPD orders, → Billing, → chart |
| 6 | Pharmacy | 14 | IP queue, dispensing, retail POS, stock, NDPS, returns | ← prescriptions, → Billing, → Inventory |
| 7 | **IPD Journey** | 20 | IPD, ICU, nursing, day care, dietetics, physio, dialysis, discharge | ← OPD, → Lab/Rad/Pharmacy, → Billing, → Insurance |
| 8 | Billing, Payments & Accounts | 20 | billing, day closure, payments, accounts/ERP | ← every clinical module, → GST, → journals |
| 9 | Insurance & Govt Schemes | 16 | insurance, PMJAY, CGHS/ECHS, HCX | ← Billing, ← IPD |
| 10 | Emergency, OT & Critical Ops | 18 | emergency, MCI, ambulance, OT, CSSD, blood bank, mortuary | → IPD, → Billing, → Lab |
| 11 | Back Office | 14 | HR, my-HR, inventory/procurement, MRD, housekeeping, biomedical, FMS, assets | ← Pharmacy, ← Accounts |
| 12 | Specialty Clinical | 22 | oncology, IVF, dental, mental health, AYUSH, vaccination, chronic disease, ANC, neonatal, partograph, ophthalmology, anaesthesia, home care, packages, PRO, LMS, CRM | → Billing, → IPD |
| 13 | Quality, NABH, IPC & ABDM | 10 | quality, NABH, JCI, IPC, ASP, HMIS, ABDM | ← every clinical action |
| 14 | Analytics & AI Suite | 67 | analytics, forecasts, population health, revenue intelligence, clinical intelligence, research + all 67 AI feature keys | ← every module's data |
| 15 | Platform / SaaS Admin + Regression | 8 | `/platform/*` (20 sub-routes), then full multi-persona journeys | everything |

**Total: ~230 scenarios, ~2,500–3,000 cases.**

Phases 1 and 2 have no scenarios — they are prerequisite setup, tested by surface
(every screen, every field, every permission) rather than by patient story. Scenarios begin
at Phase 3, when there is finally a patient to follow.

---

## Why this order

**1 → 2 first.** You cannot test OPD if there are no doctors, no departments, no
consultation fee and no lab catalogue. Worse, this app doesn't tell you they're missing —
it bills a hardcoded ₹500 and silently drops unmatched lab tests. Testing modules before
masters produces a pile of fake bugs.

**3 → 4 → 5 → 6 → 7 follows the patient.** A patient is registered, seen in OPD, sent for
tests, given medicines, and sometimes admitted. Testing in this order means every phase has
real data waiting for it from the phase before, instead of you hand-crafting fixtures.

**8 → 9 after the clinical modules,** because a bill is only meaningful once there are
charges to put on it, and a claim is only meaningful once there's a bill.

**10 → 11 → 12 are breadth.** They depend on the core being proven but not on each other.

**13 → 14 last of the functional work,** because quality evidence and analytics are
downstream of everything — they have nothing to show until the modules above have generated
real activity.

**15 is platform admin plus full regression** — the super-admin view of hospitals as
tenants, then complete journeys run end to end as a final proof.

---

## Per-phase detail

### Phase 1 — Foundation & Access
**Goal:** prove a hospital can be created, staff can log in, and each role sees exactly what
it should — no more, no less.

| Section | Covers |
|---|---|
| 1A | `/register` — 5 steps + phone OTP |
| 1B | `/setup/onboarding` — 14 steps in 6 sections |
| 1C | `/login`, `/reset-password`, `/auth/callback`, session lifecycle |
| 1D | Staff login creation — 17 accounts covering all 16 `app_role` enum values |
| 1E | RBAC route matrix — every role × every route |
| 1F | Tab & action permission gates |
| 1G | Plan / subscription gating |
| 1H | Multi-tenancy isolation (Hospital A vs B) |
| 1I | `/admin/go-live` checklist |

**Done when:** all 16 assignable roles can log in, each lands on its correct route, every
blocked route is genuinely blocked, and Hospital A cannot reach Hospital B's data by any
route tried.

> ⚠️ Section 1D/1E also probe a real discrepancy found during setup: the `app_role` enum has
> **16** values, but `src/lib/modules.ts` gates routes on **48** role strings. Roles like
> `blood_bank_technician` and `quality_officer` are named as a module's intended user but
> cannot be assigned to anyone. See [MOCK_DATA_BOOK.md](MOCK_DATA_BOOK.md#️-finding-before-you-start-the-role-list-doesnt-line-up).

### Phase 2 — Settings & Masters
**Goal:** every one of the 50 currently-routable settings screens saves correctly with real
mock data entered through the UI, every dropdown offers (and accepts) every one of its
option values, and the module downstream of each setting visibly changes.

> **Scope note:** `/settings/modules` and `/settings/product-mode` are excluded from this
> pass. Their page components and `App.tsx` routes are currently removed from the working
> tree (uncommitted, bundled with an unrelated edit) — see the correction in
> `SETTINGS_PREREQ_MATRIX.md`. Re-add both to `settings.helpers.ts`'s `SETTINGS_ROUTES` and
> to `settings-forms.ts`'s `SCREEN_FORMS` once that is resolved; the full catalogue is 52
> routes.

Tested in dependency order — Tier 0 (profile, departments, staff, roles, plan) before
Tier 1 (per-module masters). Each screen gets: load, create, edit, delete, validation
negatives, permission check, **a downstream verification** — e.g. after adding a lab
test, it must appear as a chip in the OPD Rx tab — and, for every dropdown/select/radio
field, every option value individually, not sampled (see Section 2L).

**Done when:** the QA tenant is fully configured and every Tier-1 prerequisite in
`SETTINGS_PREREQ_MATRIX.md` is satisfied.

**Cases:** [cases/phase-02-settings.csv](cases/phase-02-settings.csv) — **1,056 cases across 12
sections**, matched 1:1 by **1,056 tests in 25 spec files**.
**Specs:** [e2e/phase-02-settings/](../../e2e/phase-02-settings/), run with `npm run qa:phase2`.

| Section | Cases | Covers |
|---|---:|---|
| 2A Settings hub | 20 | `/settings` hub, catalogue↔router parity, aliases, deep links |
| 2B Identity | 134 | profile, branding, white-label, language & region, support, training |
| 2C Plan & entitlement | 42 | plan, AI features — the three stacked AI gates |
| 2D Structure | 167 | departments, wards & beds, shifts, bank accounts, config values (23 categories) |
| 2E People & access | 72 | staff, roles, doctor schedules |
| 2F Services, rates & money | 100 | services, payers, GST, approvals, Razorpay |
| 2G Clinical masters & alerts | 158 | lab tests, drugs, notifications, radiology, ICD, consent, OT, protocols, thresholds, day care, templates |
| 2H Workflows & communications | 96 | OPD queue, discharge, ancillary payment, WhatsApp, report schedules, TV display, inventory |
| 2I Integrations, data & API | 116 | integrations, HL7, ABDM, HMIS, API keys/portal/hub, AI languages, backup, retention, change log |
| 2J Downstream verification | 48 | **the gate** — every "symptom if missing" in SETTINGS_PREREQ_MATRIX |
| 2K Isolation & permissions | 48 | A-vs-B on 20 master tables, 14 role refusals, the `hospital_settings` RLS finding |
| 2L Full-tenant sweep | 55 | all 50 screens in dependency order, then the Phase 3 readiness gate |
| **Total** | **1,056** | |

> The docs previously published "230 cases / 228 tests" for this phase. Neither artefact ever
> existed in git, and the specification they described — every option value, every invalid
> input, every screen — cannot fit in 230 rows. The real number is what honest coverage of the
> 50 screens costs.

> **Phase 2 is authored to strict 1:1 parity.** Every CSV row has exactly one Playwright test
> and every test has exactly one row — no row is `MANUAL-ONLY`. `node scripts/qa-parity-check.mjs 02`
> enforces it and fails the build otherwise, because without a check the rule rots within a
> week: someone adds a row and forgets the spec, and the tracker shows it as "not tested yet"
> forever rather than "no longer tested".
>
> The same script enforces the **quality bar** the first attempt at this phase failed —
> no blank `mock data`, no unfalsifiable Expected Result, no `Supabase Verify: None` on a case
> that writes, and every `Steps` field must name a concrete target — a route for a UI case, or a
> table for a case that talks to PostgREST directly (2K's isolation checks have no screen to open).
>
> **Dropdowns get one row and one test per option value**, never a sample. The Wards screen
> alone contributes 25 (11 ward types + 4 bed statuses + 9 bed categories), and Configurable
> Dropdowns contributes one per category for all 23. Sampling is exactly what would have
> missed `BUG-P2-001`.
>
> **Test titles must be literal, never template literals.** A title built with `${…}` carries
> no parseable `TC#`, so the tracker reporter can never map its result back to a row. Phase 1's
> `P1E.rbac-route-matrix.spec.ts` has that defect today and 40 of its rows can never receive an
> automated result. Loop bodies are fine; loop-generated titles are not.

> **Section 2J is the gate.** It re-proves every "symptom if missing" from
> `SETTINGS_PREREQ_MATRIX.md` in one sitting, so anything that fails from Phase 3 onward is a
> real defect rather than a configuration gap. Run it last, with the tenant fully configured.

> **A handful of P1 cases need a live clinical workflow to assert against** — a bill to
> finalise, an admission to price, stock to decrement. Under 1:1 parity each still has its own
> test; the test asserts everything provable from configuration and then `test.skip`s with a
> named reason, which records `N/A` in the tracker rather than a false pass. The phase that
> owns the workflow re-runs the same case against real data.

### Phase 3 — Patient & Records
**Goal:** prove the 12 patient-story scenarios in
[JOURNEY_SCENARIOS.md](JOURNEY_SCENARIOS.md#phase-3--patient--records--12-scenarios) hold —
registration, de-duplication, emergency/newborn, ABHA/ABDM, kiosk, patient portal, edit +
audit trail, DPDP soft-delete/erasure, documents, and cross-tenant isolation.

**Cases:** [cases/phase-03-patient-records.csv](cases/phase-03-patient-records.csv) — **100
cases across 10 sections**.
**Specs:** [e2e/phase-03-patient-records/](../../e2e/phase-03-patient-records/), run with
`npm run qa:phase3`.

| Section | Cases | Covers |
|---|---:|---|
| 3A Registration | 19 | Full-detail registration, UHID format/sequence, DPDP consent gate, field validation |
| 3B Duplicate detection | 5 | The missing de-dup check on `/patients` — documented as an expected-FAIL today |
| 3C Emergency & newborn | 13 | Minimal-data ED registration, Brought Dead → mortuary routing, the phone-search link path, newborn creation |
| 3D ABHA / ABDM | 10 | Sandbox verify, linking + consent log, unlink, live-Aadhaar/mobile-OTP cases left MANUAL-ONLY |
| 3E Kiosk | 10 | Self-registration, the separate `K...` UHID series, the missing new-patient dedup |
| 3F Patient portal | 10 | OTP login (automated via service-role `generateLink`), own-data-only scoping, the third `PAT-...` UHID series |
| 3G Edit & audit trail | 9 | Phone/address edits via both surfaces, the DB-trigger `audit_log` proof |
| 3H Soft-delete / erasure | 11 | `is_active` toggle, admission/bill delete guards, the one-way (no reactivate) gap, no per-patient DPDP erasure |
| 3I Documents | 8 | Upload, tenant-scoped storage path, oversize/type rejection, delete, cross-tenant storage RLS |
| 3J Cross-tenant | 5 | `/patients/:id/summary`'s missing hospital_id filter relying entirely on RLS |
| **Total** | **100** | |

> **Six cases are deliberately MANUAL-ONLY** (`TC-P3C-012`, `TC-P3D-005`, `TC-P3D-006`,
> `TC-P3D-009`, `TC-P3D-010`, `TC-P3I-007`) — each needs something a script cannot produce (a
> live IPD/OPD encounter context, a real Aadhaar/mobile OTP, a deliberately-broken database
> insert, or — for `TC-P3D-005`/`006` — a live UI path that turns out not to exist at all, see
> Finding #6 below). Their `Playwright Spec` column is blank by design, same precedent as
> Phase 1's hospital-registration OTP cases.
>
> **Findings written as tests that currently FAIL, on purpose**, because a feature that only
> works when used correctly is not tested:
>
> | # | Finding | Locked by |
> |---|---|---|
> | 1 | No de-dup check on `/patients` registration | `TC-P3B-001` |
> | 2 | No DPDP consent field on Emergency Registration | `TC-P3C-003` |
> | 3 | Newborn `mother_patient_id` has no UI to set it | `TC-P3C-012` (code-inspection) |
> | 4 | Kiosk's separate non-atomic `K...` UHID series, no dedup on new-patient mode | `TC-P3E-003`/`005` |
> | 5 | No Reactivate control for a soft-deleted patient | `TC-P3H-010` |
> | 6 | ABHASearchPanel's verify+consent+link UI has **no live entry point anywhere in the app** — `PatientRegistrationModal`'s `editPatient` prop is never passed by any caller (`grep -r "editPatient=" src/` → 0 matches), and `PatientSummaryPage.tsx`'s ABHA tab only mounts the panel once `abha_id` is already set. A fresh ABHA link can never be created through the live UI with a logged consent record. | `TC-P3D-005`/`006` (code-inspection), confirmed live by `TC-P3D-008` |
> | 7 🔴 | **Patient portal is non-functional for genuine OTP sessions** — an OTP-authenticated Supabase Auth user has no row in `users`, so `get_user_hospital_id()` returns `NULL`, and every `patients` RLS policy silently excludes it, for both reads and writes. Every portal login looks identical to "no matching patient," whether a real match exists or not, and self-service profile creation fails to insert a row at all. First live run: `TC-P3F-001`/`005`/`006`/`010` (expect a real match to succeed) all failed exactly this way; `TC-P3F-007` (expects the "0 matches" branch) passed for every login, including ones that should have matched. Routed to **Meera** (RLS policy owner) per `.agents/agents.md`. | `TC-P3F-001`/`005`/`006`/`008`/`010` |
>
> Log each as `BUG-P3-NNN` on first run rather than quarantining the case — Finding #7
> especially should not be "fixed" by loosening the test; it is the test doing its job.
>
> **`03` is not yet in `STRICT_PHASES`** in `scripts/qa-parity-check.mjs` — run
> `node scripts/qa-parity-check.mjs 03` manually to check 1:1 parity before flipping it on.

### Phase 4 — OPD Journey
**Goal:** prove the 24 OPD scenarios in
[JOURNEY_SCENARIOS.md](JOURNEY_SCENARIOS.md#phase-4--opd-journey--24-scenarios) hold — token to
consultation to prescription to bill, every payer variation, the clinical safety blocks, and
the five cross-module hops out to Lab, Radiology, Pharmacy, Billing and IPD.

**Cases:** [cases/phase-04-opd-journey.csv](cases/phase-04-opd-journey.csv) — **260 cases across
12 sections**, matched 1:1 by **260 tests in 12 spec files**.
**Specs:** [e2e/phase-04-opd-journey/](../../e2e/phase-04-opd-journey/), run with `npm run qa:phase4`.

| Section | Cases | Covers |
|---|---:|---|
| 4A Queue & tokens | 26 | `/opd` load, walk-in registration, `generate_token_number`, priority, MLC flag, the four refusals |
| 4B Fee engine & revisit | 24 | doctor → dept → global → ₹500 precedence, follow-up window at day 5 / **7** / 8 / 12, free follow-up, emergency precedence |
| 4C Appointments & slots | 18 | slot booking and consumption, double-booking, check-in → token, blocked and full slots |
| 4D Payer variations | 22 | cash, TPA, PMJAY, corporate, **CGHS with and without a referral** |
| 4E Consultation workspace | 24 | encounter, six tabs, vitals bands and boundaries, diagnosis + ICD, MRD record and retention |
| 4F Drug safety & prescribing | 26 | route/frequency masters, quantity maths, NDPS badge, **the allergy block and its override** |
| 4G Orders — Lab & Radiology | 22 | BILLED & ORDERED, the silently-dropped test, **PCPNDT Form F** |
| 4H Billing & discounts | 28 | consultation charge + idempotency, partial payment, the discount tiers and their boundaries |
| 4I Downstream hops | 20 | admit to IPD, physio referral, prescription → pharmacy |
| 4J Telemedicine & Voice Scribe | 14 | teleconsult shell and billing; 6 dictation/video cases MANUAL-ONLY |
| 4K Edge cases | 20 | **two tokens one day**, MLC, duplicate caught at OPD, no-show |
| 4L RBAC & isolation | 16 | role reach, the doctor's own-queue filter, A-vs-B on four OPD tables |
| **Total** | **260** | |

> **Phase 4 is authored to strict 1:1 parity** — every CSV row has exactly one Playwright test
> and vice versa. Check it with `node scripts/qa-parity-check.mjs 04 --advisory`. `04` is
> deliberately **not** yet in `STRICT_PHASES`; add it once the phase has actually been run, the
> same position `03` is in today.

> **Six cases are MANUAL-ONLY** (`TC-P4J-008`, `TC-P4J-011` … `TC-P4J-014`, plus the live-video
> half of `TC-P4J-008`) — each needs a human speaking into a microphone or two live video
> sessions, which a script cannot produce. Following the Phase 2 precedent they still carry a
> spec: the test asserts everything provable without speech and then `test.skip`s with a named
> reason, so the tracker records `N/A` rather than a blank cell or a false PASS. **Do not make
> them green by weakening them** — a transcription error here is a prescribing error.

> **Eight findings, all found by reading the code while authoring the phase rather than by
> running it. The five P1s were FIXED before the phase was ever run**, so their cases are
> **regression locks expected to PASS** — a red result means the fix has been reverted, not that
> the test is stale. Do not quarantine them.
>
> | # | Finding | Fix | Locked by | Owner |
> |---|---|---|---|---|
> | 1 🔴 | **Brand names defeated the allergy check.** `checkDrugSafety` normalised only the strength (`"Mox 500"` → `"mox"`) then substring-matched `drug_allergy_cross_reactivity`, which is keyed on **generics**. Nothing resolved brand → generic, though `drug_master` stores both. `Amoxicillin` blocked; `Mox 500` — the same drug, the way Indian doctors actually prescribe — passed silently. | ✅ `resolveAliases()` in [drugSafetyCheck.ts](../../src/lib/drugSafetyCheck.ts) resolves every name to its generic constituents (splitting combinations on `+`, `/`, `and`), and duplicates, interactions **and** allergies now all match on those aliases. 10 new Vitest cases, including the false-positive side. | `TC-P4F-022`, `TC-P4F-023` | Priya + Dr. Ramesh |
> | 2 🔴 | **No PCPNDT Form F on the OPD path.** Form F existed in one call site only; `syncRadiologyOrders` — what a consultation actually calls — created neither the `pcpndt_form_f` row nor the `is_pcpndt` flag. Statutory, not cosmetic. | ✅ New [src/lib/pcpndt.ts](../../src/lib/pcpndt.ts) holds the single determination, called by **both** paths; `syncRadiologyOrders` now writes the flag and the Form F and logs NABH evidence, and a failed Form F insert is surfaced loudly. | `TC-P4G-016`, `TC-P4G-017` | Priya + Suresh |
> | 3 🔴 | **The Form F trigger was a substring match** on `"obstetric"` in a free-text study name, so a clinically obstetric `"USG Pregnancy Profile"` was missed even on the path that had one. | ✅ Migration `20261013000019` adds `radiology_study_master.requires_form_f` with a backfill; the flag is authoritative and a broadened keyword list (pregnancy, antenatal, TIFFA, anomaly scan, nuchal…) covers legacy catalogues. | `TC-P4G-018` | Suresh |
> | 4 🔴 | **The allergy override was in nobody's record.** The modal promises "logged in the patient record", but `handleSafetyOverride` left `patient_id` NULL and no column named the prescriber at all. | ✅ Migration `20261013000017` adds `clinical_alerts.created_by`; `ConsultationWorkspace` now passes `patientId` and `userId` into `RxOrdersTab`, and a failed insert raises a destructive toast instead of failing silently. | `TC-P4F-020`, `TC-P4F-021` | Priya |
> | 5 🔴 | **The CGHS referral lookup could never run.** `handleFinalize` filters on `cghs_echs_beneficiaries.patient_id`, added by a guarded `ALTER` in `20260521000005` that only fires *if the table exists* — but the table is created in `20260901000010`, which sorts **later**. On a fresh database the column was never added, the lookup errored, and the block fired for **every** CGHS patient including those holding a valid referral. | ✅ Migration `20261013000018` re-applies the columns unconditionally and idempotently, plus the indexes and the service-role policy that sat inside the same skipped guard. | `TC-P4D-009`, `TC-P4D-012` | Meera |
> | 6 | `doctor_slots.booked_count` is incremented by a non-atomic read-then-write inside a `try/catch` that only warns. The `appointments_unique_slot` constraint is what actually prevents double-booking; `booked_count` is a display counter that can under-report. | ⏳ open — the DB constraint makes this cosmetic, so it is scoped rather than hot-fixed | `TC-P4C-013`, `TC-P4C-014` | Meera |
> | 7 | **Cancelling an appointment never releases the slot** — nothing decrements `booked_count`, so cancelled capacity can never be resold. | ⏳ open — needs a product decision on whether a cancellation reopens the slot | `TC-P4C-017` | Nikhil (scope) |
> | 8 | **The two order-sync functions disagree.** An unmatched *lab* test is silently dropped; an unmatched *radiology* study is created anyway against a fallback modality. Same failure, opposite handling, so no single mental model is correct. | ⏳ open — which of the two behaviours is correct is a clinical call, not a test's to make | `TC-P4G-009`, `TC-P4G-020` | Arjun |
>
> **A ninth defect surfaced while fixing #4 and was fixed with it:** `encounterId` was declared
> in `RxOrdersTab`'s props and used to fetch the placed orders, but **was never passed by
> `ConsultationWorkspace`** — so the "BILLED & ORDERED" confirmation chip could never appear at
> all, on any order. `TC-P4G-007` locks it.
>
> **`TC-P4K-005` is a REGRESSION LOCK, not an expected failure.** The encounter-to-bill backfill
> takes "the most recent unlinked OPD bill today", guarded by `.is("encounter_id", null)`. That
> guard is present, so the two-tokens-one-day scenario should PASS — a red result means the guard
> has been removed and every second same-day consultation is charging the wrong visit.
>
> Two behaviours are documented as **current**, not as defects, because the right answer is a
> product decision rather than a test's to make: OPD orders and vitals do not carry into an
> admission (`TC-P4I-005`/`006`, per P4-S15), and a consultation can be completed with an empty
> chief complaint (`TC-P4E-008`).

### Phase 5 — Lab & Radiology
**Goal:** prove the 17 scenarios in
[JOURNEY_SCENARIOS.md](JOURNEY_SCENARIOS.md#phase-5--lab--radiology--17-scenarios) hold —
order to sample to result to release, the critical value and the delta check, auto-verification
and dual validation, the radiology worklist and report, and the statutory PCPNDT Form F.

**Cases:** [cases/phase-05-lab-radiology.csv](cases/phase-05-lab-radiology.csv) — **24 journeys
across 12 sections**, matched 1:1 by **24 tests in 12 spec files**.
**Specs:** [e2e/phase-05-lab-radiology/](../../e2e/phase-05-lab-radiology/), run with `npm run qa:phase5`.

> **Phase 5 is 24 complete journeys, not 154 field pokes.** This is the biggest shape change in the
> programme, and it was made because an audit of the previous 154 cases found that **39 (25%) never
> opened a browser at all** — they read Supabase and asserted a column, and four of them read
> `src/*.tsx` off disk — while **83 more (54%) seeded an order straight into the database, opened
> one screen, clicked once**. Sample *receive* and *process* were clicked twice in 154 cases. Every
> radiology order in the phase was a service-role insert; `NewRadiologyOrderModal` had never once
> been completed. Five Lab tabs had never been opened by any test.
>
> A hospital going live does not care whether the flag column reads `CH`. It cares whether a patient
> can be registered, billed, bled, resulted, released and read by the doctor who asked the question.
> So each case is now one journey of 20–38 stages through the browser, with its positive, negative
> and boundary conditions asserted inline as it goes. All ~51 negative and ~21 boundary conditions
> from the old suite survive as stages; coverage went up while the row count went down.

> **How a 38-stage case stays diagnosable.** Every stage is a `test.step()` titled
> `S09/38 · lab_technician · Draw the sample at the collection workstation`, so one line of a
> failure report says the journey cleared payment and died at phlebotomy. `tracker-reporter.ts`
> parses that prefix into a **`Stages Passed / Total`** column (`31/38`) and a per-stage artefact,
> `docs/qa/results/latest-steps.json`. Hard `expect` is used only where the next stage physically
> depends on it; everything else is `expect.soft`, so one broken locator costs one red assertion
> rather than silently un-reporting the twenty-six conditions behind it.

> **One source for the stages.** `e2e/phase-05-lab-radiology/p5-manifest.ts` declares every case's
> stages, roles, patient, timeout and Supabase-verify targets. The spec imports them for its step
> titles and `node docs/qa/tracker/build-p5-cases.mjs` writes the same list into the CSV `Steps`
> column — so the steps a tester follows by hand and the stages the automation walks cannot drift.
> `qa-parity-check.mjs` enforces the shape mechanically: a Phase 5 row needs **at least 10 numbered
> stages, at least one `NEGATIVE:` and at least one `BOUNDARY:`**, which is what stops a narrow case
> being reintroduced wearing a journey's name.

> **Every case gets its own patient, and nothing is deleted.** Phases 1–4 share `PT-QA-NNNN` records
> and purge what they create; Phase 5 provisions `PT-QA-<case>-<run>` per case and leaves every
> order, sample, result, report and Form F in place. Three reasons:
>
> 1. **The failures here are about persistence.** L1 is "the result save is silently discarded", R1
>    is "the report shell is never created", L6 is "an amendment overwrites the original". Each is a
>    question about a row that should still exist — and an `afterEach` purge answers all three with
>    an empty table, which is also the answer a passing test gives.
> 2. **One patient cannot hold contradictory histories.** A journey asserting a patient's FIRST
>    result has nothing to compare against cannot share a chart with one asserting a 30-day-old
>    baseline. Under the old model both held only because a delete ran between them.
> 3. **An empty tenant is not a realistic tenant.** A worklist with exactly one order never
>    exercises "which of these eleven is the current one", which is where real defects live.
>
> The persona is deterministic from the case ID and clinically shaped where it matters — the Form F
> journeys get a woman of childbearing age, the false-positive side gets a man — so a statutory
> record can never pass for the wrong reason. Two fixtures are still REUSED because their premise is
> a patient who was already there: `PT-QA-0018` (the live admission an ancillary charge accrues to)
> and `PT-QA-0030` (the Hospital-B isolation control). Pin `QA_P5_RUN_TAG` to re-enter a previous
> run's charts; reset deliberately with `npm run qa:seed`.

> **A service-role write now needs a reason.** `p5-seed-of-last-resort.ts` permits one only for
> state that (a) predates the test's clock, (b) belongs to a tenant the test cannot log into, or
> (c) originates outside the product — a device, a PACS, a reference lab. Everything a user of this
> hospital could have done today, the journey does through the browser. That is why
> `seedLabOrder`, `advanceSamples`, `seedRadiologyOrder` and `seedUnpaidCharge` are gone: between
> them they used to skip the order wizard, the payment, the accession, the bill, the two-identifier
> check, the collection, the receipt and the processing — which is to say, the product.

> **Missing configuration is repaired, not reported as a defect.** `p5-prereqs.ts` provisions every
> `SETTINGS_PREREQ_MATRIX` Lab/Radiology row it finds absent — critical ranges, panel members,
> `requires_form_f`, PCPNDT registrations — and returns what it had to repair. `TC-P5L-001` reads
> the tenant BEFORE it runs, so a configuration gap surfaces as exactly one red case rather than
> forty phantom product defects. The state that used to cause that: migration `20261009000171`
> deactivates every lab test, and every lookup in the app filters `is_active = true`.

| Section | Journeys | Covers |
|---|---:|---|
| 5A Outpatient lab | 3 | consultation → prescription → desk payment → draw → bench → release → the doctor's chart; the panel group price; the desk order modal and every way it refuses |
| 5B Inpatient lab & ancillary money | 2 | post-paid ward accrual with no cash step; the pre-paid gate — four ways it holds, two ways it is bypassed |
| 5C Specimen lifecycle | 2 | rejection and recollection with no second charge, all eight reasons; barcode vs accession, receipt, processing, the mix-up guard |
| 5D Result correctness | 3 | the critical-value boundary battery and the phone call; the delta check with a 30-day baseline; the result workspace exhaustively |
| 5E Validation & pathology | 2 | dual validation and amendment; histopathology from specimen to a two-pathologist sign-off **[new surface]** |
| 5F External referral | 1 | referred out and back — five chips, three advances, and the four gaps that make it a dead end |
| 5G Instrument governance | 2 | a Westgard violation stops a release and only a supervisor restarts it; NABL calibration, the analyzer connector, mapping and an inbound message **[new surface]** |
| 5H Turnaround | 1 | when the TAT clock starts, when it breaches, and what the dashboards show **[new surface]** |
| 5I Radiology reporting | 3 | the order modal nobody had ever driven, the viewer, the report, the chart; critical findings; the AI impression |
| 5J PCPNDT | 2 | obstetric USG → Form F → the gate → the statutory register; the non-obstetric false positive |
| 5K RBAC & tenant isolation | 2 | the role matrix walked as a journey; nine tables and one write attempt across tenants |
| 5L Prerequisites | 1 | the phase cannot run against a hospital that is not configured for it |
| **Total** | **24** | 481 stages |

> **Delivery status.** Sections **A–H (16 journeys, the lab chain) are implemented and runnable**.
> Sections **I–L (8 journeys) are declared but not yet automated** — their stages, patients and
> verify targets are in the manifest and the CSV, so a tester can walk them by hand today, and the
> specs are `test.fixme` placeholders that report `N/A` rather than vanishing from the tracker.

> **Two run tiers.** `npm run qa:phase5:smoke` runs the six journeys that would stop a go-live — the
> money, the pre-paid gate, the specimen, the critical value, the radiology report and the statutory
> Form F — in roughly 25 minutes. `npm run qa:phase5` runs all 24 and takes closer to two hours at
> `workers=1`. Do not expect the full phase to run on every push; a suite that long stops being run,
> which is worse than the narrow cases it replaced.

> **Run 5L first, then again last.** It re-proves every "symptom if missing" in
> `SETTINGS_PREREQ_MATRIX.md`, so anything failing elsewhere is a real defect rather than a
> configuration gap. `TC-P5L-002` alone is worth the section: migration `20261009000171`
> deactivates every lab test, and on a tenant migrated after seeding that single state turns into
> roughly forty red cases across 5A–5D with no common cause visible from any of them.

> **`05` is deliberately NOT in `STRICT_PHASES`** in `scripts/qa-parity-check.mjs` — the same
> position `03` and `04` hold. Check it with `node scripts/qa-parity-check.mjs 05 --advisory`, and
> flip it on once the phase has actually been run.

> **Sixteen findings, all found by reading the code while authoring the phase rather than by
> running it.** Unlike Phase 4, **none have been fixed yet** — Phase 5 was authored to the
> instruction "write the failures separately, fix, then retest", so the cases that lock them are
> **expected to FAIL on the first run**. Do not quarantine them and do not weaken them to green.
> Full triage detail, with the fix→retest ledger, is in
> [results/PHASE_05_FAILURE_REPORT.md](results/PHASE_05_FAILURE_REPORT.md).
>
> | # | Finding | Severity | Locked by | Owner |
> |---|---|---|---|---|
> | L1 🔴 | **A delta result never saves at all.** `lab_order_items.delta_flag` is `boolean`, but a >50% swing writes the **string** `"delta"`; PostgREST returns `22P02` and the handler swallows it with a bare `console.error; return`. The entire result is discarded — no value, no flag, no critical alert, no toast — for precisely the results that moved most. | P1 | `TC-P5C-010`/`011`/`012` | Meera + Priya |
> | L2 🔴 | **A panel bills ₹0 per line.** Group rates are keyed by `group_id`; the bill-line loop looks them up by `test_id`. Every group-covered test writes `unit_rate: 0` and `"Lab: Test"` while the header still carries ₹1,100. On the IPD path the panel is never charged at all. | P1 | `TC-P5A-013`/`014` | Ravi |
> | L3 🔴 | **No critical ranges were ever seeded**, and `CH`/`CL` derives from them alone — so potassium 7.2 flagged `H` and no alert fired. Fixed in the seeder; `TC-P5C-001` and `TC-P5L-003` are now regression locks. | P1 | `TC-P5C-001`, `TC-P5L-003` | Meera |
> | L4 🔴 | **A pathologist can release an unacknowledged critical value.** `handlePathologistValidate` checks neither the critical gate nor the credential gate that `handleValidateAll` applies. | P1 | `TC-P5D-005`/`006` | Priya |
> | L5 🔴 | **No second-validator identity enforcement.** The submit step records nobody, so nothing can compare submitter against validator. Histopathology gets this right; lab orders do not. | P1 | `TC-P5D-009`/`010` | Priya |
> | L6 🔴 | **No result-amendment path exists at all** — no column, no table, no control. Yet a signed-off antibiogram can be silently overwritten. | P1 | `TC-P5D-011`/`012`/`013` | Priya + Meera |
> | L7 | `autoverify_eligible` and `lab_dual_validation_config` were never seeded and the latter has **no settings screen anywhere** — both paths unreachable. Seeder fixed. | P2 | `TC-P5D-001`/`007` | Meera + Kiran |
> | L8 | **External referrals are a disconnected register** — `patient_id` is always null, no order link, no result capture, no cost. | P2 | `TC-P5E-004`…`007` | Arjun |
> | L9 | A never-drawn sample can be **rejected**, queueing a recollection for a draw that did not happen; and neither rejection nor critical notification writes NABH evidence. | P2 | `TC-P5B-010`/`012`, `TC-P5J-005` | Priya |
> | L10 | The result workspace's "Mark Collected" is not payment-gate aware — silent no-op on a pre-paid tenant. | P2 | `TC-P5I-008` | Priya |
> | L11 | Gender-specific reference ranges are configurable but never applied; the "Ready" queue filter maps to a status nothing writes. | P3 | — (documented) | Kiran |
> | L12 | The barcode label fetches JsBarcode from a **CDN at print time** — a lab with no outbound internet prints a blank label. | P2 | `TC-P5B-006` | Kiran |
> | R1 🔴 | **An OPD-raised study can never be reported.** `syncRadiologyOrders` creates no `radiology_reports` shell; `saveDraft` and `validateAndSign` both return silently on its absence while the button stays enabled. The radiologist clicks Sign and *nothing happens*. | P1 | `TC-P5F-013`/`014`/`015` | Priya |
> | R2 🔴 | **`pcpndt_form_f` and `pcpndt_records` are two disconnected tables.** The auto-created statutory record appears in neither the register nor either gate, so every PCPNDT study is blocked until a human re-keys the whole form. | P1 | `TC-P5G-005`/`006` | Meera + Suresh |
> | R3 | The order modal's PCPNDT banner still uses the **pre-fix substring test**, so "USG Pregnancy Profile" creates a Form F with no warning shown. | P2 | `TC-P5G-013` | Priya |
> | R4 | `radiology_study_master.requires_form_f` is **not settable from any UI**, despite the migration comment claiming otherwise. | P2 | `TC-P5G-003` | Kiran + Suresh |
> | R6 | `scheduled` and `patient_arrived` are unreachable statuses with live worklist filters; `scheduled_time` is dead. | P3 | `TC-P5F-004` | Arjun |
> | R7 🔴 | On signing, `autoBillOpdInvestigation` runs for every non-admitted order **including one already paid at order time** — a double-bill candidate. | P1 | `TC-P5I-010` | Ravi |
> | R8 | The worklist is scoped to one `order_date` and hides `unbilled`, so an order whose charge failed is **invisible forever** with no view anywhere. | P2 | `TC-P5F-002`/`003` | Arjun |
> | R13/R14 | The DICOM viewer's AI impression is never persisted or attested while metering the same feature key; and `ai_impression_suggestion` is persisted **before** human review. | P2 | `TC-P5H-008`/`009` | Dr. Nalini |

### Phases 6–15
Scenario lists and section breakdowns are in [JOURNEY_SCENARIOS.md](JOURNEY_SCENARIOS.md).
Detailed cases are written phase by phase, when you reach each one — deliberately, so they
account for what earlier phases uncovered.

---

## Progress

Tracked live in the tracker's **Summary** sheet. This table is a manual snapshot only.

| Phase | Cases written | Run | Pass % | Open P1 | Gate |
|---|---|---|---|---|---|
| 1 | ✅ 177 | — | — | — | 🔴 not started |
| 2 | ✅ 1,056 (all 12 sections, 1:1 parity green) | — | — | — | 🔴 not run |
| 3 | ✅ 100 (10 sections, 94 automated + 6 MANUAL-ONLY) | — | — | — | 🔴 not run |
| 4 | ✅ 260 (12 sections, 1:1 parity green; 8 findings — 5 P1s fixed pre-run) | — | — | — | 🔴 not run |
| 5 | ✅ 146 (12 sections, 1:1 parity green; **workflow-shaped cases**; 19 findings — 8 P1s open, expected-FAIL on first run) | — | — | — | 🔴 not run |
| 6–15 | ⏳ written on arrival | — | — | — | ⏳ |

> **Five defects found while authoring Phase 2 — all FIXED, and their cases are now
> regression locks rather than expected failures.** Four screens showed a success toast and
> made no database call at all; the fifth was a dropdown missing a value the database supports.
>
> | Bug | Screen | Was | Now |
> |---|---|---|---|
> | `BUG-P2-001` | `SettingsWardsPage` | bed `Status` offered 4 of the 5 `bed_status` values — `cleaning` absent, so a bed in terminal cleaning had no correct state and was marked available while still dirty | `cleaning` added, with its own colour so it reads distinctly from `reserved`. Locked by `TC-P2D-017` and `TC-P2D-020` |
> | `BUG-P2-002` | `SettingsShiftsPage` | three hardcoded shifts, zero Supabase calls | persists to `shift_master`, with cross-midnight duration (22:00→06:00 = 8h, not −16). Locked by `TC-P2D-088`/`089`/`102` |
> | `BUG-P2-003` | `SettingsNotificationsPage` | fake 500ms `setTimeout` in front of a no-op | persists to `hospital_settings.notification_config` |
> | `BUG-P2-004` | `SettingsLanguagePage` | fake `setTimeout`, and no target table existed | persists to `hospital_settings.language_region`. Locked by `TC-P2B-009`/`010`/`018` |
> | `BUG-P2-005` | `SettingsProtocolsPage` | five hardcoded protocols, zero Supabase calls | persists to `clinical_protocols` |
>
> `notification_config` and `language_region` use the existing key/value `hospital_settings`
> table rather than a new one. `notification_preferences` was rejected as the target for
> BUG-P2-003 because it is per-**patient** channel booleans and cannot express this screen's
> per-alert-type In-App/WhatsApp/Both map.
>
> Pure logic moved to `src/lib/shiftTiming.ts`, `src/lib/notificationConfig.ts` and
> `src/lib/languageRegion.ts` so it is unit-testable without a browser — 13 Vitest cases cover
> the midnight wrap and the config merge.

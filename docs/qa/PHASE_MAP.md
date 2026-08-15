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
| 5 | Lab & Radiology | 16 | lab, radiology, PCPNDT, PACS | ← OPD/IPD orders, → Billing, → chart |
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

### Phases 3–15
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
| 3–15 | ⏳ written on arrival | — | — | — | ⏳ |

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

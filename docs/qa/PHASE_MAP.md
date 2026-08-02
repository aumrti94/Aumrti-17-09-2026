# Phase Map

15 phases, ordered so nothing is ever tested before the things it depends on exist.

**Rule:** you do not start phase N+1 until phase N's gate is green. See
[README.md](README.md#phase-gate--when-is-a-phase-actually-done).

---

## Overview

| # | Phase | Scenarios | Anchor modules | Cross-module hops proven |
|---|---|---|---|---|
| 1 | Foundation & Access | — (9 sections) | `/register`, `/setup/onboarding`, `/login`, RBAC, plan gating, tenant isolation | this *is* the prerequisite |
| 2 | Settings & Masters | — (53 screens) | every screen in `src/pages/settings/` | each setting → the module it unlocks |
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
**Goal:** every one of the 53 settings screens saves correctly, and the module downstream of
it visibly changes.

Tested in dependency order — Tier 0 (profile, departments, staff, roles, plan) before
Tier 1 (per-module masters). Each screen gets: load, create, edit, delete, validation
negatives, permission check, and **a downstream verification** — e.g. after adding a lab
test, it must appear as a chip in the OPD Rx tab.

**Done when:** the QA tenant is fully configured and every Tier-1 prerequisite in
`SETTINGS_PREREQ_MATRIX.md` is satisfied.

### Phases 3–15
Scenario lists and section breakdowns are in [JOURNEY_SCENARIOS.md](JOURNEY_SCENARIOS.md).
Detailed cases are written phase by phase, when you reach each one — deliberately, so they
account for what earlier phases uncovered.

---

## Progress

Tracked live in the tracker's **Summary** sheet. This table is a manual snapshot only.

| Phase | Cases written | Run | Pass % | Open P1 | Gate |
|---|---|---|---|---|---|
| 1 | ✅ yes | — | — | — | 🔴 not started |
| 2–15 | ⏳ written on arrival | — | — | — | ⏳ |

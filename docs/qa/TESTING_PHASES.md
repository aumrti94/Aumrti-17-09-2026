# Aumrti HMS — Testing Phases (Master Plan)

> **Purpose of this document:** the *order* in which we test Aumrti, module by module, following a real patient's journey through the hospital — so that every module AND every connection between modules is validated, and nothing is missed.
>
> **This document is phases only.** Detailed test cases (the actual click-by-click positive/negative steps) are written *per phase, later*, against this map.
>
> **Decisions locked (23 Jun 2026):**
> - App runs and login works today ✅ — so Phase 0 is "build reusable test data", not "make it run".
> - **Manual-first**, then automate. You click through by hand to learn the product and find bugs; Playwright locks it afterwards.
> - **Patient-journey ordering** — phases follow how a real hospital actually runs.

---

## How to read each phase

Every phase below has the same shape:

| Field | What it means |
|---|---|
| **Goal** | The one workflow this phase proves works end-to-end. |
| **Primary module(s)** | The screens you test as the main subject of the phase. |
| **Connected modules to validate** | The *handoff* — the next module that receives this module's data. This is where the hidden bugs live. |
| **Test as these roles** | Which user logins to use (positive = allowed, negative = should be blocked). |
| **Backend touched** | Key DB tables / Edge Functions / AI that must be checked behind the screen, not just the UI. |
| **Mock data needed** | What dummy data must exist before you can test this phase. |
| **Phase is DONE when** | Plain-language exit criteria. Not test cases — the goalposts. |

## The rhythm for EVERY phase (do not skip)

1. **Walk it manually** as the primary role — happy path first (positive).
2. **Try to break it** — wrong inputs, empty fields, wrong role, duplicate, cancel mid-way (negative).
3. **Check the backend** — did the row actually save in Supabase? Did the Edge Function fire? (don't trust the green toast).
4. **Log every bug** in one sheet (screen, what you did, what you expected, what happened).
5. **Fix the bugs** for that phase.
6. **Re-walk** until clean.
7. **Lock with Playwright** — only now write the automated script so it never breaks again.
8. **Only then** move to the next phase.

> **Golden rule (from Sunita):** Always keep **two test hospitals** logged in side by side. After every save, confirm Hospital A can NEVER see Hospital B's data. This is the #1 enterprise risk and must be re-checked in every clinical phase.

---

# PHASE 0 — Test Environment & Mock Data Foundation

**Goal:** Have one reusable, realistic dataset and a clean set of logins so every later phase has something to click on.

- **Primary work:** Stand up **2 test hospitals** (to prove isolation), create **1 login per role** (18 roles), and load a synthetic dataset.
- **Mock data to build (reuse existing seed functions as the base):**
  - Hospitals: `setup-hospital`, `register-hospital`, `seed_hospital_defaults`
  - Staff/logins: `create-staff-login`, `invite-doctors` → 1 doctor, nurse, receptionist, lab tech, pharmacist, billing exec, accountant, HR, quality officer, admin, super-admin
  - Catalogs: `seed-drugs`, `seed-pharmacy`, `seed_tpa_defaults`, `seed_ai_provider_defaults`, `seed_prompt_registry`, `seed_nis_vaccines`, `seed-dashboard`
  - **~30 synthetic patients** with deliberate variety: different ages (newborn → elderly), genders, with/without ABHA, allergy cases, pregnant patient (for PCPNDT), NDPS-relevant case, insurance vs cash vs PMJAY patient.
  - Service rates / GST rates loaded so billing has prices.
- **Phase is DONE when:** both hospitals exist with full mock data, you can log in as every role, and you have a written "test data cheat sheet" (which patient is for which scenario).

> Everything from here uses this dataset. Never test on a blank database.

---

# PHASE 1 — Identity, Tenancy & Access Control (the foundation)

**Goal:** Prove that the right people get in, the wrong people are blocked, and Hospital A can never see Hospital B.

- **Primary modules:** `/login`, `/register`, `/setup/onboarding`, `/settings` (staff, departments, roles, integrations, product-mode), `/modules` launcher.
- **Connected modules to validate:** RoleGuard on **all** routes — pick 1 page from each major module and confirm a wrong role is bounced.
- **Test as these roles:** every role (positive: see your modules; negative: blocked from others, e.g. nurse trying `/accounts`, `/settings`).
- **Backend touched:** auth, `get_user_hospital_id()`, RLS isolation policies, `routeRoles.ts` / `tabPermissions.ts`, `create-staff-login`, `reset-staff-mfa`, MFA.
- **Mock data needed:** the 2 hospitals + all role logins from Phase 0.
- **Phase is DONE when:** login/logout/password-reset/MFA work; every role sees only its allowed routes; **cross-hospital data leak test passes** (the non-negotiable). Onboarding wizard creates a hospital cleanly.

> **Why first:** if access control or tenancy is broken, every later test result is meaningless.

---

# PHASE 2 — Patient Registration & Master Index

**Goal:** Register a patient once, find them again, no duplicates, consent captured.

- **Primary modules:** `/patients` (registration, search, patient summary), `/booking`, `/kiosk` (self-check-in/register), `/portal` (patient portal), ABHA/ABDM creation, DPDP consent.
- **Connected modules to validate:** the new patient must appear in **OPD** (Phase 3) and be billable (Phase 10).
- **Test as these roles:** receptionist (positive), kiosk/self (positive), nurse/doctor (read), others (negative).
- **Backend touched:** `patients` table + audit triggers, consent_records (DPDP), `abdm-abha-create`, `abdm-abha-verify`, `abdm-hpr-verify`, `update-patient-ai-context`.
- **Mock data needed:** the 30 synthetic patients — but register a few **live** during the phase to test the real form.
- **Phase is DONE when:** a patient can be registered (with and without ABHA), found by search, has no duplicate, DPDP consent is stored, and the patient is visible to OPD.

---

# PHASE 3 — OPD / Outpatient Visit (the front door)

**Goal:** A registered patient walks in, gets a token, sees a doctor, gets vitals + a prescription + orders.

- **Primary modules:** `/opd` (token queue, walk-in, consultation, vitals, diagnosis/ICD, prescription), `/schedule` (appointments), `/tv` & `/ward-board` (waiting-room display), `/teleconsult` + `/telemedicine`.
- **Connected modules to validate (the handoffs):** prescription → **Pharmacy**, lab order → **Lab**, imaging order → **Radiology**, consultation → **Billing** charge, and "admit" → **IPD**.
- **Test as these roles:** receptionist (token/walk-in), doctor (consult/prescribe), nurse (vitals); negative: patient with no registration.
- **Backend touched:** encounters/visits, token queue, prescriptions, `ai-icd-suggest`, `ai-generate-clinical-note`, `ai-differential-diagnosis`, `ai-clinical-voice` / voice dictation, NABH evidence logging.
- **Mock data needed:** Phase-2 patients + doctor schedules + ICD/service catalog.
- **Phase is DONE when:** a full OPD visit completes and you can SEE the resulting order land in Pharmacy/Lab/Radiology queues and a billable charge appear. AI note/ICD suggestions return sensibly and are editable (human-in-the-loop).

---

# PHASE 4 — Diagnostics: Laboratory

**Goal:** A lab order from OPD/IPD becomes a sample, a result, a report — with critical-value alerts.

- **Primary modules:** `/lab` (order worklist, sample collection, result entry/workspace, validation, report).
- **Connected modules to validate:** order came from **OPD/IPD** (Phase 3/7); result flows back to the **doctor's view** and to **Billing**; critical result → **notification/alert**.
- **Test as these roles:** lab tech (collect/enter), doctor (view/acknowledge); negative: result entry without an order.
- **Backend touched:** lab orders/results tables, `lab-analyzer-ingest`, `scan-lab-tests`, `export-lab-reports`, critical-value alert → `alert-escalation` / `notification-dispatcher`.
- **Mock data needed:** lab test catalog + reference ranges; orders generated in Phase 3.
- **Phase is DONE when:** order → sample → result → validated report works; abnormal/critical results fire an alert; result is visible to the ordering doctor and billed.

---

# PHASE 5 — Diagnostics: Radiology & Imaging

**Goal:** An imaging order becomes a report, with the viewer and statutory registers working.

- **Primary modules:** `/radiology` (worklist, DICOM viewer, reporting workspace, AI impression), `/radiology/pcpndt-register`.
- **Connected modules to validate:** order from **OPD/IPD**; report back to **doctor**; charge to **Billing**; PCPNDT Form-F compliance.
- **Test as these roles:** radiologist (report), doctor (view); negative: PCPNDT entry missing mandatory fields must block.
- **Backend touched:** radiology orders/reports, DICOM panel, `ai-radiology-impression`, PCPNDT register tables + NABH evidence.
- **Mock data needed:** a pregnant synthetic patient (PCPNDT), imaging order catalog, a sample DICOM/study if available.
- **Phase is DONE when:** order → report → bill works; AI impression is a draft the radiologist edits; PCPNDT register enforces mandatory fields and stores Form-F data.

---

# PHASE 6 — Pharmacy & Drug Safety

**Goal:** An e-prescription is dispensed safely, with stock decremented and controlled-drug rules enforced.

- **Primary modules:** `/pharmacy` (prescription queue, dispense, NDPS/Schedule-H register, stock).
- **Connected modules to validate:** prescription from **OPD/IPD**; stock link to **Inventory** (Phase 13); charge to **Billing**.
- **Test as these roles:** pharmacist (dispense), doctor (prescribe); negative: dispense NDPS drug without dual sign-off must block; allergy/interaction must warn.
- **Backend touched:** prescriptions/dispense tables, `check-drugbank-ddi`, `ai-safety-guard`, `export-drug-chart`, NDPS register, stock movements.
- **Mock data needed:** drug catalog (`seed-drugs`/`seed-pharmacy`), a patient with a known allergy, an NDPS drug scenario.
- **Phase is DONE when:** dispense decrements stock and bills correctly; **drug-interaction and allergy checks are real (not mocked)**; NDPS dual sign-off is enforced.

---

# PHASE 7 — IPD / Inpatient (admission to discharge-ready)

**Goal:** Admit a patient, manage the bed, run nursing + doctor rounds, drug charts, ICU.

- **Primary modules:** `/ipd` (admission, bed/ward board, doctor rounds, overview), `/ipd/icu/:id`, `/ipd/day-care`, `/nursing` (acuity, medication admin, high-alert double-check, notes).
- **Connected modules to validate:** admission came from **OPD/Emergency**; orders flow to **Lab/Radiology/Pharmacy**; everything accrues to **Billing**; leads into **Discharge** (Phase 9).
- **Test as these roles:** doctor (orders/rounds), nurse (administration/notes), receptionist (admit/bed); negative: discharge a patient with pending dues/orders.
- **Backend touched:** admissions/beds tables, nursing tables, `generate-daily-census`, drug chart, NEWS2/acuity scoring, high-alert double-check, `export-nursing-notes`, NABH evidence.
- **Mock data needed:** ward/bed configuration, an admitted synthetic patient, active orders.
- **Phase is DONE when:** admit → bed assign → nursing/medication rounds → ICU flow works, all orders cross to the right modules, and the running bill accrues live.

---

# PHASE 8 — Emergency, Ambulance & Operation Theatre

**Goal:** Acute pathways — ED triage, mass-casualty, ambulance, and surgery — work and connect to IPD/Billing.

- **Primary modules:** `/emergency` (triage, ED board), `/emergency/mci` (mass casualty), `/ambulance`, `/ot` (scheduling, checklist, end-case), `/home-care`.
- **Connected modules to validate:** ED/OT → **IPD** admission, → **Lab/Radiology/Pharmacy**, → **Billing**; OT consumables → **Inventory/CSSD**.
- **Test as these roles:** doctor/nurse (ED, OT), receptionist (registration of unknown/MLC patient); negative: MLC case missing mandatory medico-legal fields.
- **Backend touched:** emergency/triage tables, OT scheduling + end-case modal, anaesthesia record, MLC documentation, NABH evidence.
- **Mock data needed:** an emergency/unknown patient, an OT case with surgeon/anaesthetist, MCI scenario.
- **Phase is DONE when:** ED triage → admit/treat → bill works; OT case schedules, records, and closes with consumables billed; MLC enforces statutory fields.

---

# PHASE 9 — Discharge & Medical Records (MRD)

**Goal:** Close the inpatient episode cleanly — discharge summary, coding, records, TAT.

- **Primary modules:** `/mrd` (coding, record retention), discharge summary generator, discharge TAT timer.
- **Connected modules to validate:** pulls from **IPD/OPD/Lab/Radiology/Pharmacy**; triggers **final Billing** (Phase 10) and **Insurance** claim (Phase 11).
- **Test as these roles:** doctor (summary), MRD/admin (coding/records); negative: discharge with incomplete summary or unbilled items.
- **Backend touched:** discharge tables, `generate-discharge-summary`, `ai-discharge-summary`, ICD/coding, record retention, `fhir-export` / `fhir-r4-server`, `abdm-fhir-package`.
- **Mock data needed:** a fully-treated admitted patient from Phase 7.
- **Phase is DONE when:** AI discharge summary drafts from real episode data and is editable; discharge TAT tracks; record is retrievable in MRD; episode is ready to bill and claim.

---

# PHASE 10 — Billing, Packages & Payments (the money spine)

**Goal:** Every charge captured across all modules turns into a correct GST bill that gets paid.

- **Primary modules:** `/billing` (charge capture, bill generation), `/billing/closure` (daily cash closure, Tally summary), `/packages`, `/payments`, `/pay/:token`.
- **Connected modules to validate:** charges from **OPD/IPD/Lab/Radiology/Pharmacy/OT**; feeds **Insurance** (Phase 11) and **Accounts** (Phase 12); revenue-leak detection.
- **Test as these roles:** billing exec, accountant, cashier; negative: bill without encounter, double-payment, refund.
- **Backend touched:** bills (atomic `generate_bill_number()` RPC), service_rates/GST, `generate-invoice`, `gst-irn-generate`, Razorpay (`create-razorpay-order`, `-payment-link`, `razorpay-webhook`), `ai-revenue-leak-detector`, `daily-leakage-scan`, `financial-anomaly-check`.
- **Mock data needed:** completed episodes from Phases 3–9 with chargeable items; service rates; a Razorpay sandbox key.
- **Phase is DONE when:** a bill aggregates ALL charges correctly, GST/IRN is right, UPI/payment link/refund work in sandbox, daily closure tallies, and revenue-leak flags missed charges.

> **Ravi's flag:** test the full bill of a patient who used OPD + lab + radiology + pharmacy + IPD — this is where charge-capture gaps hide.

---

# PHASE 11 — Insurance & Government Schemes

**Goal:** Cashless / claim pathways — pre-auth to claim submission — work for TPA, PMJAY, CGHS, ESI.

- **Primary modules:** `/insurance` (pre-auth, claims), `/pmjay`, CGHS/ESI flows.
- **Connected modules to validate:** pulls patient + bill + discharge from Phases 2/9/10; result posts back to **Accounts** (receivables).
- **Test as these roles:** insurance/billing exec; negative: claim with missing documents or ineligible patient.
- **Backend touched:** pre-auth/claims tables, `pmjay-eligibility`, `pmjay-claim-submit`, `cghs-eligibility`, `esi-claim-submit`, `submit-pre-auth-hcx`, `hcx-claim-submit`, `hcx-callback-receiver`, `insurance-automation`, `insurance-daily-alerts`.
- **Mock data needed:** PMJAY/CGHS/insured synthetic patients with scheme IDs; TPA defaults (`seed_tpa_defaults`).
- **Phase is DONE when:** eligibility check → pre-auth → claim submit works in sandbox for each scheme, callbacks update status, and approved/denied amounts post to receivables.

---

# PHASE 12 — Accounts / ERP / Finance

**Goal:** All revenue and costs roll up into correct books, GST returns, and Tally.

- **Primary modules:** `/accounts` (dashboard, reports, ledgers, financial statements, budget, fixed assets).
- **Connected modules to validate:** receives from **Billing** (Phase 10), **Insurance** (Phase 11), **HR payroll** (Phase 13), **Inventory** purchases.
- **Test as these roles:** accountant, CFO; negative: unbalanced journal, period mismatch.
- **Backend touched:** ledger/journal tables, `reconcile-journal-postings`, GST returns, Tally export (`email-tally-xml`), financial statements.
- **Mock data needed:** posted bills, payments, payroll, and POs from earlier phases.
- **Phase is DONE when:** journals balance, GSTR data is correct, Tally export matches, and financial statements reconcile to billing/payments.

---

# PHASE 13 — Supporting Operations (back-office)

**Goal:** The non-clinical engine — staff, stock, equipment, sterilisation, blood, food, facilities.

- **Primary modules:** `/hr` (payroll run, roster), `/inventory` + `/ims` (stock, PO, `send-po-email`), `/biomedical` + `/assets`, `/cssd` (sterilisation), `/blood-bank`, `/dietetics`, `/housekeeping`, `/fms/dashboard`, `/mortuary`, LMS/training.
- **Connected modules to validate:** Pharmacy/OT consume **Inventory**; payroll posts to **Accounts**; CSSD/Biomedical link to **OT**; blood bank links to **IPD/Emergency**.
- **Test as these roles:** HR manager, store keeper, biomedical, blood bank tech; negative: issue stock below zero, expired blood unit, payroll without attendance.
- **Backend touched:** HR/payroll tables, inventory/PO/GRN, asset/AMC schedules, CSSD cycles, blood inventory + `donor-reengagement`, `generate-daily-census`.
- **Mock data needed:** staff with salary structure + attendance, stock items, blood units, equipment list.
- **Phase is DONE when:** each back-office module completes its core workflow and correctly affects Inventory/Accounts/clinical modules it feeds.

---

# PHASE 14 — Specialty Clinical Modules

**Goal:** The deep specialty workflows each work and reuse the core patient/billing spine.

- **Primary modules:** `/dialysis`, `/oncology`, `/ivf`, `/mental-health`, `/dental`, `/physio`, `/ayush`, `/chronic-disease`, `/vaccination`, `/home-care`, `/specialty`.
- **Connected modules to validate:** each uses **Patients** (Phase 2), orders into **Lab/Pharmacy**, and bills via **Billing** (Phase 10).
- **Test as these roles:** the relevant specialist + nurse; negative: protocol/schedule violations (e.g., dialysis session without prior session data, vaccine outside schedule).
- **Backend touched:** specialty-specific tables, `seed_nis_vaccines`, protocol/cycle scheduling, NABH evidence.
- **Mock data needed:** patients enrolled in each specialty (a dialysis patient, an oncology patient on a protocol, an IVF cycle, a child for vaccination).
- **Phase is DONE when:** each specialty completes its signature workflow (a dialysis session, a chemo cycle, an IVF cycle step, a vaccination per NIS) and bills correctly.

---

# PHASE 15 — Quality, NABH, IPC & Statutory Reporting

**Goal:** The compliance layer captures evidence and submits to government portals.

- **Primary modules:** `/quality` (events, clinical audits, QI projects, committees, ASP, JCI), `/nabh/compliance`, `/ipc/dashboard`, `/hmis`, ABDM compliance dashboards (`/abdm`, `/ABDMComplianceDashboard`).
- **Connected modules to validate:** evidence comes from **every clinical phase** (NABH logging done throughout); submissions go to government.
- **Test as these roles:** quality officer/manager, admin; negative: incomplete incident report, missing evidence.
- **Backend touched:** quality/incident/audit tables, NABH evidence aggregation, `ai-nabh-assistant`, `ai-nabh-indicator-alert`, `hmis-portal-submit`, `idsp-alert-submit`, IPC surveillance.
- **Mock data needed:** the evidence trail generated naturally by Phases 3–14 + a few incidents.
- **Phase is DONE when:** incident → CAPA workflow works, NABH evidence aggregates from real clinical actions, and HMIS/IDSP submissions format correctly in sandbox.

---

# PHASE 16 — Analytics, AI Intelligence & Executive

**Goal:** The dashboards and AI layers read real data from all prior phases and are governed.

- **Primary modules:** `/analytics` (+ forecasts, population-health, revenue-intelligence), `/ai/clinical-intelligence`, `/research`, `/executive-dashboard`, `/hod-dashboard`, `/ceo-board`, AI Performance/Governance page.
- **Connected modules to validate:** consume data from **all** clinical + financial phases (these are the last because they need real data above them).
- **Test as these roles:** admin, CFO, HOD, doctor; negative: empty-data states, date-range edge cases.
- **Backend touched:** analytics queries, `ai-executive-digest`, `ai-clinical-guidelines`, `update-patient-ai-context`, `ai-proxy`, AI usage logging / cost tracking, prompt registry.
- **Mock data needed:** the cumulative data from Phases 0–15 (this is why it's near-last).
- **Phase is DONE when:** dashboards show correct aggregates matching source modules, AI digests/insights are accurate and cost-logged, and AI governance metrics (cache/cost/error) populate.

---

# PHASE 17 — Platform / SaaS Admin (super-admin & company-facing)

**Goal:** The side YOU operate as the vendor — onboarding hospitals, subscriptions, churn, success.

- **Primary modules:** `/platform` (hospitals list, hospital detail, churn radar, customer success, AI performance), subscription/billing of the SaaS, `/crm`.
- **Connected modules to validate:** controls tenancy created in **Phase 1**; subscription gates feature access.
- **Test as these roles:** super_admin only; negative: a hospital_admin must NOT reach platform screens.
- **Backend touched:** hospital_subscriptions, `change-subscription-plan`, `create-razorpay-subscription`, `razorpay-subscription-webhook`, `trial-lifecycle-cron`, `dunning-processor`, `delete-hospital`/`purge-orphaned-users`.
- **Mock data needed:** the 2 hospitals on different plans (trial vs paid).
- **Phase is DONE when:** you can onboard/suspend a hospital, change/renew a subscription, see churn/health scores, and confirm plan limits actually gate features.

---

# PHASE 18 — Cross-Cutting, Negative & Full-Journey Regression (final hardening)

**Goal:** Test the things that run *across* all modules, then one final unbroken patient journey.

- **Primary areas:**
  - **Communications:** `/notifications`, `/inbox`, WhatsApp (`send-whatsapp-meta`, `whatsapp-bot`), SMS (`send-sms`), email (`send-email`), push (`send-push-notification`), `notification-dispatcher`, `webhook-dlq-processor`.
  - **Resilience:** offline banner, error boundaries, failed Edge Function retries (DLQ), `alert-escalation`.
  - **Security (Ananya):** RLS penetration re-test across all tables, role-escalation attempts, no PHI in logs/errors.
  - **Performance (Lakshmi):** page load < target, Edge Function cold-start, large-list pages.
  - **Full regression:** one patient, one unbroken run — Register → OPD → Lab + Radiology → Pharmacy → Admit IPD → OT → Discharge → Bill → Insurance claim → Accounts → shows in Analytics. Positive AND negative at each step.
- **Phase is DONE when:** notifications fire on the right events across channels, security re-test passes, performance is acceptable, and the **single full patient journey completes with zero blocking bugs** — then you ship.

---

## Coverage check — every module area is in a phase

| Phase | Module areas covered |
|---|---|
| 0 | seed/setup, staff, hospitals |
| 1 | auth, login, register, setup, settings, admin, modules |
| 2 | patients, booking, kiosk, portal, abdm (ABHA), consent |
| 3 | opd, schedule, teleconsult, telemedicine, tv, ward-board |
| 4 | lab |
| 5 | radiology (incl. PCPNDT) |
| 6 | pharmacy |
| 7 | ipd, nursing, icu, day-care |
| 8 | emergency, ambulance, ot, home-care (acute) |
| 9 | mrd, discharge, fhir |
| 10 | billing, packages, payments, pay |
| 11 | insurance, pmjay, cghs, esi, hcx |
| 12 | accounts |
| 13 | hr, inventory, ims, biomedical, assets, cssd, blood-bank, dietetics, housekeeping, fms, mortuary, lms |
| 14 | dialysis, oncology, ivf, mental-health, dental, physio, ayush, chronic-disease, vaccination, home-care, specialty |
| 15 | quality, nabh, ipc, hmis, abdm dashboards |
| 16 | analytics, ai, research, executive/hod/ceo dashboards |
| 17 | platform, crm, subscriptions |
| 18 | notifications, inbox, whatsapp/sms/email, offline, security, performance, full regression |

> If a screen exists that you can't find a phase for, it belongs in the closest patient-journey phase — flag it and we slot it in.

---

## Test-case tracking format (use for EVERY test case, in every phase)

When we write test cases per phase, **each test case is one row** in this exact format — so nothing is ever missed and every result is traceable.

| Column | What goes in it | Example |
|---|---|---|
| **TC#** | Unique ID. Format `P<phase>-<module>-<nnn>` | `P3-OPD-001` |
| **Section** | Phase + module/screen being tested | `Phase 3 / OPD / Token Queue` |
| **Priority** | P1 = blocker/critical, P2 = important, P3 = minor | `P1` |
| **Test Case** | One-line title of what is being tested | `Receptionist generates token for walk-in patient` |
| **Steps** | Numbered click-by-click actions | `1. Login as receptionist 2. Open /opd 3. Click Walk-In 4. Select patient 5. Click Generate Token` |
| **Mockdata/dummydata to test** | Exact test data used (which patient, which login, which values) | `Patient: Ramesh Kumar (MRN TEST-014); Login: reception@test-a` |
| **Expected Result** | What SHOULD happen (positive) or be blocked (negative) | `Token T-12 issued, appears on TV board, encounter row created` |
| **Status** | `PASS` / `FAIL` / `BLOCKED` | `FAIL` |
| **Actual Result** | What actually happened | `Token issued in UI but no row in encounters table` |
| **Console Error** | Copy-paste the red error text from browser console (F12) | `POST /rest/v1/encounters 403 RLS policy violation` |
| **Screenshot** | Link/filename of the screenshot proof | `p3-opd-001-fail.png` |
| **Notes** | Anything else — bug ticket #, retest date, workaround | `Bug #41 raised; RLS policy missing on encounters` |

**CSV header row** (copy this into Google Sheets / Excel to start tracking):

```csv
TC#,Section,Priority,Test Case,Steps,Mockdata/dummydata to test,Expected Result,Status,Actual Result,Console Error,Screenshot,Notes
```

**Rules for filling it in (from Sunita):**
- Every phase gets **both positive and negative** test cases (happy path + try-to-break-it).
- `Status` starts blank, becomes `PASS`/`FAIL`/`BLOCKED` only after you actually ran it — never assume.
- A `FAIL` is not done until the bug is fixed AND the same TC# is re-run to `PASS`.
- `BLOCKED` = you couldn't even run it (e.g. data missing, another bug in the way) — note what blocked it.
- Always fill **Console Error** on a FAIL — that red text is what tells the developer the real cause.

---

## What happens after this document

1. **You approve / reorder these phases.**
2. For **Phase 0**, we build the reusable mock dataset first.
3. Then, **one phase at a time**, we write the detailed test cases (positive + negative, 11-field manual catalog + Playwright scenarios) — only for that phase — you run them, fix bugs, lock with Playwright, and move on.
4. You will *learn the product* as you walk each phase, because you're testing it as the real role would use it.

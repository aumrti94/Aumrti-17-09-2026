## Team Coordination Rules

### How to Activate a Module-Specialist Agent

**Step 1 — Name the module and task:**
> "Lab module — auto-report generation for microbiology cultures"

**Step 2 — Activate the specialist + required reviewers:**
> "@deepika, implement... CC: @arjun (cross-module contract), @kiran (new UI component), @meera (schema change)"

**Step 3 — Domain coordinator reviews after build:**
> Priya reviews clinical correctness → Ravi reviews billing correctness

**Step 4 — Platform agents review their concern:**
> Kiran (UX laws) → Meera (migration) → Sunita (E2E test)

Never activate all agents simultaneously. Invoke only those relevant to the current task.

---

### Activation Map: Which Agent Owns Which Module

| Module | Primary Agent | Domain Coordinator | CC Always |
|--------|--------------|-------------------|-----------|
| OPD & Consultation | Mohan | Priya | Kiran, Sunita |
| IPD & Ward Management | Radha | Priya | Kiran, Sunita |
| Emergency / ICU / MCI | Shivam | Priya | Kiran, Sunita |
| Nursing & Care Plans | Jaya | Priya | Kiran, Sunita |
| OT & Anaesthesia | Karthik | Priya | Kiran, Meera (OT schema) |
| Lab / LIMS / Pathology | Deepika | Priya | Kiran, Meera (lab schema) |
| Radiology / DICOM / RIS | Vishal | Priya | Kiran, Meera |
| Pharmacy & Formulary | Suma | Priya | Kiran, Ravi (billing side) |
| Blood Bank & Transfusion | Harish | Priya | Kiran, Meera |
| Diet & Nutrition | Nandita | Priya | Kiran |
| Specialty EMRs (ANC/Neo/Ophth/Dental) | Divya | Priya | Kiran, Sunita |
| Teleconsult & Telemedicine | Aryan | Priya | Kiran, Ravi (billing), Prakash (ABDM) |
| OPD/IPD Billing & Collections | Balaji | Ravi | Kiran, Meera (billing schema) |
| Insurance, TPA & Pre-Auth | Pooja | Ravi | Kiran, Selvi (PMJAY) |
| Accounts / ERP / Tally | Ashok | Ravi | Meera (schema) |
| GST & Tax Compliance | Girija | Ravi | Suresh (regulatory) |
| HR, Payroll & Attendance | Pradeep | Arjun | Kiran, Meera |
| MRD & Medical Records | Saroja | Priya | Kiran, Prakash (FHIR/ABDM) |
| CSSD & Sterilisation | Raji | Arjun | Kiran, Meera |
| IPC & Antibiotic Stewardship | Nirmala | Priya | Kiran, Ramya (NABH) |
| Quality, NABH & JCI | Ramya | Arjun | Kiran, Suresh (regulatory) |
| CRM & Patient Engagement | Ganesh | Arjun | Kiran, Ravi (loyalty billing) |
| Scheduling & Resource Mgmt | Kavya | Arjun | Kiran, Meera |
| ABDM & Digital Health | Prakash | Arjun | Ananya (PHI), Suresh (NHA mandates) |
| LMS & Staff Training | Usha | Arjun | Kiran, Ramya (NABH HRM) |
| Packages / Wellness / CDM | Babu | Ravi | Kiran, Balaji (billing), Nandita (diet) |
| Analytics, BI & HMIS | Santosh | Arjun | Meera (data model), Suresh (HMIS mandates) |
| Specialty Clinics (Oncology/Dialysis/IVF) | Latha | Priya | Kiran, Suma (pharmacy), Deepika (lab) |
| Government Schemes (PM-JAY/CGHS/ECHS) | Selvi | Ravi | Pooja (insurance), Suresh (regulatory) |
| Inventory, Procurement & Supply Chain | Vinod | Arjun | Ravi (procurement finance), Girija (GST/ITC), Ashok (posting) |
| Biomedical & Asset Management | Lalitha | Arjun | Suresh (CDSCO/AERB), Ashok (fixed assets) |
| Facility & Support Services (FMS/HK/Ambulance/Mortuary) | Murthy | Arjun | Nirmala (BMW/IPC), Suresh (fire/PCB), Saroja (mortuary MLC) |
| Allied Health & Rehab (Physio/Home Care) | Sridevi | Priya | Kiran, Ravi (therapy billing), Aryan (tele-monitoring) |

---

### Activation Map: Quality & Reliability Pod + Reach/Mobile/Support

| Surface | Primary Agent | Coordinator | CC Always |
|---------|--------------|-------------|-----------|
| Test automation (Vitest + Playwright, coverage gates) | Naveen | Sunita (QA) | Arjun (CI gate), Priya (clinical test criteria) |
| Test-case authoring (manual 11-field catalog + Playwright + mock data) | Meghana | Sunita (QA) | Naveen (framework), Nikhil (traceability), Ananya (no PHI in test data) |
| Playwright execution (implement, run, debug, flaky triage, run reports) | Imran | Sunita (QA) / Naveen | Deepak (defect triage), Lakshmi (CI), Ananya (mock data only) |
| Integration / interoperability (HL7/FHIR/devices, event bus) | Farhan | Arjun | Vikram (vendors), Ananya (PHI in-transit), Suresh (ABDM/govt) |
| Performance (bundle, virtualization, p95) | Manoj | Lakshmi + Kiran | Meera (queries) |
| Localization / i18n (vernacular UI) | Priyanka | Kiran | Rohit (adoption), Priya (clinical terms) |
| Mobile (React Native/Expo, offline-first) | Rohan | Vikram | Kiran (UX), Ananya (mobile PHI), Arjun (tenant isolation) |
| L2 technical support (production triage) | Deepak | Rohit | Lakshmi (incidents), owning module specialist |
| Implementation / data migration (go-live cutover) | Anjali | Rohit | Meera (schema/import), Ashok (financial tie-out), Saroja (medico-legal fidelity) |

**Quality & Reliability Pod Hard Rules:**
- **CI/test-gate rule:** no feature merges without tests for its critical-path logic; `drugSafetyCheck` + `clinicalCalculators` + `gstRules`/billing must reach high coverage first (Naveen + Sunita).
- **Test-case rule:** every test case (manual or Playwright) is authored in the standard 11-field template (`docs/qa/test-case-template.md`); a "FAIL" is not loggable without Actual Result + Console Error + Screenshot; test data is synthetic mock only, never real PHI (Meghana + Ananya).
- **Execution rule:** Imran implements + runs Playwright specs inside Naveen's framework (never a fork); failing runs capture trace + screenshot + video; flaky tests are quarantined + root-caused, never retried-to-green; a red main-branch suite is stop-the-line (Imran + Naveen + Lakshmi).
- **Integration rule:** no new component calls a third-party API or external system directly — all routes through Farhan's adapter/event-bus layer (Arjun + Ananya).
- **Performance rule:** any list that can exceed ~100 rows must virtualize; every module page meets the p95 tablet budget before ship (Manoj + Lakshmi).
- **i18n rule:** once i18next lands, no new user-facing string is hardcoded English — all strings are keys (Priyanka, enforced by Kiran).
- **PHI rule (all):** integration payloads, mobile offline stores, migration files, and support data access follow DPDP de-identification/least-privilege — mandatory Ananya review.

### Gap → Owner Map (Quality, Modules, Reach & Support)

| Gap (verified) | New owner | Reviewer |
|----------------|-----------|----------|
| Near-zero test coverage (3 files, 0 E2E, untested drugSafety/calculators/GST) | Naveen | Sunita, Arjun |
| No documented test-case catalog (manual + automated authoring, mock data) | Meghana | Sunita, Naveen |
| No Playwright execution owner (run, debug, flaky triage, run reports) | Imran | Naveen, Sunita |
| 94 scattered invokes, no integration layer/event bus, HL7/FHIR ad-hoc | Farhan | Arjun, Ananya, Suresh |
| Unmeasured performance, no bundle analysis/virtualization | Manoj | Lakshmi, Kiran |
| Inventory/Procurement (15 comp) unowned | Vinod | Arjun, Ravi |
| Biomedical/Assets (9 comp) unowned | Lalitha | Arjun, Suresh |
| FMS+Housekeeping+Ambulance+Mortuary unowned | Murthy | Arjun, Nirmala |
| Physiotherapy + Home Care unowned | Sridevi | Priya, Ravi |
| UI hardcoded English, no i18next | Priyanka | Kiran, Rohit |
| Mobile is a stub (0 RN files) | Rohan | Vikram, Ananya |
| No L2 production support owner | Deepak | Rohit, Lakshmi |
| No data-migration/go-live cutover owner | Anjali | Rohit, Meera |

---

### Activation Map: Platform Pod (Control Plane)

> The control plane is a SEPARATE system from the tenant app. Domain coordinator is **Vikram (CTO)**. Any cross-tenant code is a mandatory **Ananya** review (Critical blast radius).

| Control-Plane Surface | Primary Agent | Domain Coordinator | CC Always |
|-----------------------|--------------|-------------------|-----------|
| Control-plane architecture / `components/platform/` engines | Karan | Vikram | Ananya (cross-tenant), Lakshmi (SLO) |
| SaaS subscriptions & billing (Razorpay, dunning, proration) | Aditya | Vikram | Kavitha (revenue), Meera (sub schema) |
| Tenant provisioning & lifecycle (signup→provision, suspend/delete) | Neha | Vikram | Ananya (isolation), Meera (seeding RPCs) |
| Entitlements & feature flags (3-layer gating) | Anita | Vikram | Meera (schema), Deepa (packaging) |
| Growth / PLG / self-service (funnel, tours, NPS, nudges) | Rahul | Vikram | Deepa (pricing nudges), Rohit (onboarding) |
| Platform RevOps & analytics (MRR/ARR/NRR/LTV, churn) | Vivek | Vikram | Kavitha (metric integrity) |
| Cockpit UI & hospital-facing self-service portal | Sneha | Vikram | Kiran (3 Design Laws), Ananya (impersonation) |

**Platform Pod Hard Rules (apply to all 7):**
- **Cross-tenant rule:** any code reading across hospitals MUST gate on active `aumrti_admins`, never `hospital_id` — mandatory Ananya review.
- **Reconciliation rule:** MRR on any platform page MUST reconcile to Razorpay settlements AND be queryable from the DB — Kavitha + Vivek sign-off.
- **Webhook rule:** every payment/subscription webhook handler must be idempotent and write failures to a dead-letter queue — Karan + Lakshmi.
- Migrations still go through **Meera**; cockpit UI still obeys **Kiran's** 3 Design Laws.

---

### Activation Map: AI & Automation Pod

> Governance gate is **Dr. Nalini (CDO)** — she GOVERNS (SaMD, prompt content, ethics, cost ceiling); the Pod BUILDS the substrate. Every AI feature on a clinical decision path needs Dr. Nalini sign-off BEFORE build.

| Surface | Primary Agent | Governance / Coordinator | CC Always |
|---------|--------------|--------------------------|-----------|
| Clinical AI features (voice, safety-guard, clinical predictors) | Arnav | Dr. Nalini (SaMD) + Priya (clinical) | Ananya (PHI), Dr. Ramesh (alert fatigue) |
| AI platform infra (aiProvider, ai-proxy, prompt registry, evals) | Ishaan | Dr. Nalini (prompt content) + Vikram | Kavitha (cost), Meera (schema) |
| Automation / workflow / notification fabric | Tara | Karan (control-plane fabric) + Vikram | Lakshmi (SLO/DLQ), Ananya (PHI) |

**AI & Automation Pod Hard Rules (apply to all 3):**
- **Governor vs builder:** Dr. Nalini governs (gates, versions content, classifies SaMD); the Pod builds the registry/evals/guardrails/orchestration. Neither does the other's job.
- **PHI rule:** no PHI in prompts, transcripts, logs, eval datasets, cache keys, or notification payloads without de-identification (`sanitizeForLog` pattern) — mandatory Ananya review.
- **Prompt-registry rule:** once Ishaan's registry exists, NO production AI call uses an inline/hardcoded prompt — all prompts resolve from the versioned registry (Ishaan builds, Dr. Nalini governs the content).
- **Human-in-the-loop rule:** every clinical AI output on a decision path has an override and passes `ai-safety-guard` before reaching a clinician — never auto-act (Arnav, gated by Priya + Dr. Nalini).
- **Background-job rule:** every scheduled job/workflow step is idempotent with a dead-letter queue; patient-safety jobs carry the same SLA as billing (Tara, Lakshmi).

### Gap → Owner Map (AI & Automation)

| Missing / scattered | New owner | Reviewer |
|---------------------|-----------|----------|
| Prompt registry + versioning + rollback (56 scattered prompts) | Ishaan | Dr. Nalini, Meera |
| Prompt A/B testing framework | Ishaan | Dr. Nalini |
| AI eval / output-quality harness + model drift detection | Ishaan (platform) + Arnav (clinical) | Dr. Nalini |
| Centralised AI retry/fallback across providers | Ishaan | Vikram |
| AI cost optimisation (cache-hit-rate, model routing) | Ishaan | Kavitha |
| Clinical AI feature ownership (voice, safety-guard, predictors) | Arnav | Priya, Dr. Nalini |
| PHI redaction enforced on every AI path | Arnav + Ishaan | Ananya |
| Unified workflow/orchestration engine | Tara | Karan, Lakshmi |
| Notification fabric (consolidate 6 send-* fns, queue + dedup) | Tara | Lakshmi, Ananya |
| Cron/scheduled-job reliability + dead-letter queue | Tara | Lakshmi |
| Rules engine (alert_escalation_rules, auto_posting_rules) | Tara | Karan |

### Gap → Owner Map (currently stubbed / missing self-service automation)

| Missing / stubbed automation | New owner | Reviewer |
|------------------------------|-----------|----------|
| Dunning (retry → escalate → auto-suspend) | Aditya | Kavitha, Lakshmi |
| Self-service cancellation + retention flow | Aditya | Kavitha, Rohit |
| Proration on mid-cycle plan change | Aditya | Kavitha |
| MRR↔Razorpay settlement reconciliation | Aditya + Vivek | Kavitha |
| Auto-suspend past-due / email verification | Neha | Ananya |
| Onboarding tours auto-fire on first login | Rahul | Rohit |
| NPS survey automation (de-stub) | Rahul | Rohit |
| Lifecycle emails (trial-ending, payment-due) | Rahul | Deepa |
| Hospital-facing billing/usage/support portal | Sneha | Rohit, Ananya |
| Audited admin impersonation | Sneha + Karan | Ananya |
| Entitlement 3-layer consistency engine | Anita | Meera, Deepa |
| Webhook dead-letter queue + control-plane SLOs | Karan | Lakshmi |

---

### Activation Map: Strategy & Transformation Pod (McKinsey Engagement)

> Engagement sponsor is **Preethi (CEO)**; internal counterpart is **Nikhil (PM)**; all ₹ value-at-stake is validated by **Kavitha (CFO)**. The Firm ADVISES — every recommendation routes to the named build owner with a Day-1 action. Activate only the consultants the question needs.

| Workstream | Primary Agent | Sponsor / Coordinator | CC Always |
|------------|--------------|-----------------------|-----------|
| Growth / pricing / market entry / fundraising narrative | @partner + @em | Preethi | Deepa, Kavitha, Sanjay |
| Problem structuring / issue tree / hypothesis design | @ap | @partner | @em, Nikhil |
| Workplan / synthesis / storyline / steerco | @em | @ap | @consultant, @ba, Nikhil |
| Quantitative modeling / value-at-stake / business cases | @consultant | @em | Kavitha, Vivek (RevOps data) |
| Research / benchmarking / competitor fact base | @ba | @em | Deepa, Vivek |
| Digital & product transformation / operating model | @digital | @partner | Vikram, Arjun, Rahul |
| AI value capture / analytics ROI / responsible AI | @qb | @partner | Dr. Nalini (governs), Ishaan, Kavitha |
| Operational excellence / Lean / cost-to-serve | @ops | @partner | Lakshmi, Manoj, Rohit |
| Org design / transformation office / change & capability | @org | Preethi | Rohit, Nikhil |

**Strategy & Transformation Pod Hard Rules (apply to all 9):**
- **Advise, don't build:** the Firm recommends; Preethi approves priorities, Nikhil sequences, Arjun/Priya/Meera/pod-leads build. No commits to `supabase/migrations/`, components, or merges.
- **Quantify the prize:** every recommendation carries a ₹ value-at-stake with a confidence range — validated by Kavitha before board/investor exposure.
- **Fact-based, no PHI:** de-identified aggregates only; any data extract is a mandatory Ananya (DPDP) review; benchmarks cite dated sources.
- **Answer-first + CEO test:** MECE, led by the answer (Pyramid Principle / SCQA); every deliverable explains to a hospital board in 3 minutes.
- **No recommendation without an owner + Day-1 action:** each maps to an existing agent/pod and one concrete first step.

---

### Full Team Roster (79 agents)

**Leadership & Strategy (5):** Preethi (CEO), Vikram (CTO), Kavitha (CFO), Dr. Nalini (CDO/AI Governance), Nikhil (PM)
**Go-to-Market & Customer (3):** Deepa (GTM), Rohit (Customer Success), Sanjay (BD/Partnerships)
**Core Engineering & Review Gates (6):** Arjun (Lead Architect), Meera (DB/Infra), Kiran (Frontend/UX), Sunita (QA/Compliance), Lakshmi (DevOps/SRE), Ananya (Security/DPDP)
**Domain Coordinators (2):** Priya (Clinical Coordinator), Ravi (Finance Coordinator)
**Advisory & Regulatory (2):** Dr. Ramesh (Clinical Advisory/NABH), Suresh (Regulatory Affairs)

**Clinical Module Specialists (13) — coordinated by Priya:** Mohan (OPD), Radha (IPD), Shivam (Emergency/ICU), Jaya (Nursing), Karthik (OT), Deepika (Lab), Vishal (Radiology), Suma (Pharmacy), Harish (Blood Bank), Nandita (Diet), Divya (Specialty EMRs), Aryan (Teleconsult), Sridevi (Allied Health & Rehab)
**Finance Module Specialists (4) — coordinated by Ravi:** Balaji (Billing), Pooja (Insurance/TPA), Ashok (Accounts/ERP), Girija (GST)
**Operations Module Specialists (13) — coordinated by Arjun:** Pradeep (HR/Payroll), Saroja (MRD), Raji (CSSD), Nirmala (IPC), Ramya (Quality/NABH), Ganesh (CRM), Kavya (Scheduling), Prakash (ABDM), Usha (LMS), Babu (Packages/CDM), Vinod (Inventory/Procurement), Lalitha (Biomedical/Assets), Murthy (Facility & Support Services)
**Analytics & Govt-Scheme Specialists (3):** Santosh (Analytics/HMIS), Latha (Specialty Clinics), Selvi (Govt Schemes)
**Platform Pod (7) — coordinated by Vikram:** Karan (Platform Lead), Aditya (SaaS Billing), Neha (Provisioning), Anita (Entitlements), Rahul (Growth/PLG), Vivek (RevOps), Sneha (Cockpit/Portal)
**AI & Automation Pod (3) — governed by Dr. Nalini, coordinated by Vikram/Karan:** Arnav (Clinical AI/HMS), Ishaan (AI Platform Infra), Tara (Automation/Workflow)
**Quality & Reliability Pod (5):** Naveen (SDET/Test Automation framework, under Sunita), Meghana (QA Test-Case Author, under Sunita), Imran (Sr. Playwright Execution, under Sunita/Naveen), Farhan (Integration/Interoperability, under Arjun), Manoj (Performance, under Lakshmi/Kiran)
**Reach, Mobile & Production Support (4):** Priyanka (Localization/i18n, under Kiran), Rohan (Mobile Platform, under Vikram), Deepak (L2 Technical Support, under Rohit), Anjali (Implementation/Migration, under Rohit)
**Strategy & Transformation Pod — McKinsey Engagement (9) — sponsored by Preethi, internal counterpart Nikhil, ₹ validated by Kavitha:** Senior Partner (@partner), Associate Partner (@ap), Engagement Manager (@em), Consultant (@consultant), Business Analyst (@ba), Digital/Tech Transformation (@digital), QuantumBlack AI & Analytics (@qb), Operations/Lean (@ops), Org & Change (@org)

---

# Roster Index — all 79 specialists, one lookup

**Purpose:** this is the *awareness layer*. A leadership agent (Preethi, Nikhil, Vikram, Kavitha,
Dr. Nalini) reads this file to answer one question: **"who do I need, and how do I reach them?"**

Specialists are **not** invocable agents. You reach a specialist by invoking the **pod agent** in
the `Invoke via` column and naming the specialist in the prompt. The pod then loads that person's
ref file and works as them.

> Example: the task needs a migration → look up `Meera` → `Invoke via: data-pod` →
> `Task(subagent_type="data-pod", prompt="Meera: add index to lab_orders ...")`.

Pod files live at `.claude/agents/<pod>-pod.md`; ref files at `.claude/agents/refs/<pod>/<name>.md`.

---

## Leadership tier (invocable directly)

These five are real agents — call them by name and they will assemble the team themselves.

| Person | Handle | Role | Subagent | Call them when |
|---|---|---|---|---|
| Preethi | `@preethi` | CEO / Product Vision | `preethi-ceo` | Priority conflicts, build-vs-buy, OKRs, anything where two pods disagree on what matters |
| Nikhil | `@nikhil` | Product Manager | `nikhil-pm` | "Build feature X with whoever is needed" — scoping, sequencing, assembling a delivery team |
| Vikram | `@vikram` | CTO / Platform Strategy | `vikram-cto` | Architecture across systems, control plane, vendor/infra decisions, technical arbitration |
| Kavitha | `@kavitha` | CFO / Business Finance | `kavitha-cfo` | Unit economics, pricing, ₹ value-at-stake validation, revenue-model decisions |
| Dr. Nalini | `@nalini` | CDO / AI Governance | `nalini-cdo` | Any AI feature on a clinical path — SaMD classification, prompt governance, model ethics |

---

## Full roster (alphabetical)

| Person | Handle | Role | Pod | Invoke via | Activate when the task involves |
|---|---|---|---|---|---|
| Aditya | `@aditya` | SaaS Subscription & Billing Engineer | platform | `platform-pod` | Razorpay, dunning, proration, plan changes |
| Ananya | `@ananya` | Security, DPDP & Cyber Compliance | security | `security-pod` | **Any PHI. Mandatory CC on patient data, cross-tenant code, exports** |
| Anita | `@anita` | Entitlements & Feature-Flag Engineer | platform | `platform-pod` | Module gating, feature flags, plan entitlements |
| Anjali | `@anjali` | Implementation & Data Migration | growth | `growth-pod` | Go-live cutover, legacy data import, reconciliation |
| Arjun | `@arjun` | Lead Architect | data | `data-pod` | Cross-module contracts, architecture review, CI gates |
| Arnav | `@arnav` | Sr. Clinical AI Engineer | clinical | `clinical-pod` | Voice scribe, clinical predictors, ai-safety-guard |
| Aryan | `@aryan` | Teleconsult & Telemedicine | clinical | `clinical-pod` | Video consults, remote monitoring, teleconsult billing |
| Ashok | `@ashok` | Accounts, ERP & Tally | revenue | `revenue-pod` | Journal entries, Tally export, financial tie-out, fixed assets |
| Babu | `@babu` | Packages, Wellness & CDM | clinical | `clinical-pod` | Health packages, wellness plans, chronic disease mgmt |
| Balaji | `@balaji` | OPD/IPD Billing & Collections | revenue | `revenue-pod` | Patient bills, charge posting, advances, collections |
| Deepa | `@deepa` | GTM & Growth Strategist | growth | `growth-pod` | Positioning, packaging, launch, pricing narrative |
| Deepak | `@deepak` | L2 Technical Support | growth | `growth-pod` | Production triage, defect intake, customer-reported bugs |
| Deepika | `@deepika` | Lab, Pathology & LIMS | clinical | `clinical-pod` | Lab orders, results, analysers, microbiology |
| Divya | `@divya` | Specialty EMRs | clinical | `clinical-pod` | ANC, neonatal, ophthalmology, dental EMRs |
| Dr. Nalini | `@nalini` | CDO / AI Governance | data | `nalini-cdo` *(leader)* | **Gates every clinical-path AI feature before build** |
| Dr. Ramesh | `@ramesh` | Clinical Advisory / NABH Assessor | clinical | `clinical-pod` | NABH evidence, alert fatigue, clinical protocol validation |
| Farhan | `@farhan` | Integration & Interoperability | quality | `quality-pod` | HL7/FHIR, device integration, adapter/event-bus layer |
| Ganesh | `@ganesh` | CRM & Patient Engagement | frontend | `frontend-pod` | Campaigns, loyalty, patient comms UI |
| Girija | `@girija` | GST & Tax Compliance | revenue | `revenue-pod` | GST rates, CGST/SGST/IGST, GSTR-1/3B, IRN |
| Harish | `@harish` | Blood Bank & Transfusion | clinical | `clinical-pod` | Blood inventory, crossmatch, transfusion records |
| Imran | `@imran` | Sr. Playwright Execution | quality | `quality-pod` | Writing/running E2E specs, flaky triage, run reports |
| Ishaan | `@ishaan` | Sr. AI Platform Engineer | data | `data-pod` | aiProvider, ai-proxy, prompt registry, evals, AI cost |
| Jaya | `@jaya` | Nursing & Care Plans | clinical | `clinical-pod` | Nursing notes, care plans, shift handover, vitals charting |
| Karan | `@karan` | Platform Eng Lead / Control-Plane Architect | platform | `platform-pod` | Control-plane architecture, webhooks, DLQ, SLOs |
| Karthik | `@karthik` | OT & Anaesthesia | clinical | `clinical-pod` | OT scheduling, surgical safety checklist, anaesthesia records |
| Kavitha | `@kavitha` | CFO / Business Finance | revenue | `kavitha-cfo` *(leader)* | **Validates every ₹ claim before board/investor exposure** |
| Kavya | `@kavya` | Scheduling & Resource Management | frontend | `frontend-pod` | Appointment slots, resource calendars, queue management |
| Kiran | `@kiran` | Frontend & UX Developer | frontend | `frontend-pod` | **Mandatory CC on any new screen — enforces the 3 Design Laws** |
| Lakshmi | `@lakshmi` | DevOps / SRE / Infrastructure | data | `data-pod` | CI/CD, deploys, incidents, monitoring, SLOs |
| Lalitha | `@lalitha` | Biomedical & Asset Management | clinical | `clinical-pod` | Equipment registry, PM schedules, AERB/CDSCO compliance |
| Latha | `@latha` | Specialty Clinics | clinical | `clinical-pod` | Oncology, dialysis, IVF workflows |
| Manoj | `@manoj` | Performance Engineer | quality | `quality-pod` | Bundle size, virtualization, p95 budgets |
| Meera | `@meera` | Database & Infrastructure Engineer | data | `data-pod` | **Mandatory CC on every migration, RLS policy, schema change** |
| Meghana | `@meghana` | QA Test-Case Author | quality | `quality-pod` | Manual test-case catalog, mock data, traceability |
| Mohan | `@mohan` | OPD & Consultation | clinical | `clinical-pod` | OPD registration, consultation notes, prescriptions |
| Murthy | `@murthy` | Facility & Support Services | clinical | `clinical-pod` | Housekeeping, ambulance, mortuary, FMS, BMW |
| Nandita | `@nandita` | Diet & Nutrition | clinical | `clinical-pod` | Diet orders, nutrition assessment, kitchen workflow |
| Naveen | `@naveen` | SDET / Test Automation Architect | quality | `quality-pod` | Vitest/Playwright framework, coverage gates |
| Neha | `@neha` | Tenant Provisioning & Lifecycle | platform | `platform-pod` | Signup→provision, suspend/delete, seeding |
| Nikhil | `@nikhil` | Product Manager | growth | `nikhil-pm` *(leader)* | **Sequences all delivery work; sign-off before any new scaffold** |
| Nirmala | `@nirmala` | IPC & Antibiotic Stewardship | clinical | `clinical-pod` | Infection control, HAI surveillance, antibiotic policy |
| Pooja | `@pooja` | Insurance, TPA & Pre-Auth | revenue | `revenue-pod` | Claims, pre-auth, TPA queries, HCX |
| Pradeep | `@pradeep` | HR, Payroll & Attendance | revenue | `revenue-pod` | Payroll runs, attendance, statutory deductions |
| Prakash | `@prakash` | ABDM & Digital Health | security | `security-pod` | ABHA, health-record linking, FHIR R4, consent artefacts |
| Preethi | `@preethi` | CEO / Product Vision | growth | `preethi-ceo` *(leader)* | **Final arbiter on cross-functional priority conflicts** |
| Priya | `@priya` | Clinical Systems Developer | clinical | `clinical-pod` | **Clinical domain coordinator — reviews all clinical correctness** |
| Priyanka | `@priyanka` | Localization & i18n | frontend | `frontend-pod` | Vernacular UI, i18next keys, translation |
| Radha | `@radha` | IPD & Ward Management | clinical | `clinical-pod` | Admissions, bed management, ward transfers, discharge |
| Rahul | `@rahul` | Growth & PLG / Self-Service | platform | `platform-pod` | Funnels, onboarding tours, NPS, lifecycle emails |
| Raji | `@raji` | CSSD & Sterilisation | clinical | `clinical-pod` | Instrument tracking, sterilisation cycles, load records |
| Ramya | `@ramya` | Quality, NABH & JCI | quality | `quality-pod` | NABH chapters, accreditation evidence, quality indicators |
| Ravi | `@ravi` | Billing & Finance Developer | revenue | `revenue-pod` | **Finance domain coordinator — reviews all billing correctness** |
| Rohan | `@rohan` | Mobile Platform Engineer | frontend | `frontend-pod` | React Native/Expo, offline-first sync |
| Rohit | `@rohit` | Customer Success & Onboarding | growth | `growth-pod` | Go-live checklists, adoption, training requirements |
| Sanjay | `@sanjay` | Partnerships & BD | growth | `growth-pod` | Channel partners, integrations BD, alliances |
| Santosh | `@santosh` | Analytics, BI & HMIS | data | `data-pod` | Dashboards, HMIS returns, reporting data model |
| Saroja | `@saroja` | MRD & Medical Records | security | `security-pod` | Record retention, medico-legal fidelity, MLC, ICD coding |
| Selvi | `@selvi` | Government Schemes | revenue | `revenue-pod` | PM-JAY, CGHS, ECHS, scheme claim formats |
| Shivam | `@shivam` | Emergency, ICU & MCI | clinical | `clinical-pod` | Triage, ICU charting, mass-casualty, NEWS2 escalation |
| Sneha | `@sneha` | Platform Cockpit & Admin Tooling | platform | `platform-pod` | Admin cockpit UI, hospital self-service portal, impersonation |
| Sridevi | `@sridevi` | Allied Health & Rehabilitation | clinical | `clinical-pod` | Physiotherapy, home care, therapy plans |
| Suma | `@suma` | Pharmacy & Formulary | clinical | `clinical-pod` | Dispensing, formulary, drug interactions, NDPS |
| Sunita | `@sunita` | QA & Compliance Engineer | quality | `quality-pod` | **QA gate owner — signs off test adequacy before merge** |
| Suresh | `@suresh` | Healthcare Regulatory Affairs | security | `security-pod` | PMJAY/CGHS/NDPS/CDSCO mandates, fire/PCB, GST notifications |
| Tara | `@tara` | Sr. Automation & Workflow Engineer | data | `data-pod` | Cron jobs, notification fabric, rules engine, DLQ |
| Usha | `@usha` | LMS & Staff Training | growth | `growth-pod` | Training modules, competency tracking, role-specific SOPs |
| Vikram | `@vikram` | CTO / Platform Strategy | security | `vikram-cto` *(leader)* | **Technical arbiter; coordinates platform + AI pods** |
| Vinod | `@vinod` | Inventory, Procurement & Supply Chain | clinical | `clinical-pod` | Indents, GRN, stock, vendor POs, expiry |
| Vishal | `@vishal` | Radiology, DICOM & RIS | clinical | `clinical-pod` | Imaging orders, PACS/DICOM, radiology reporting |
| Vivek | `@vivek` | Platform RevOps & Analytics | platform | `platform-pod` | MRR/ARR/NRR/LTV, churn, settlement reconciliation |

### The Firm — strategy advisory bench (all via `growth-pod`)

Advisory only. They recommend; they never build. Every recommendation must name a build owner
from the table above plus a Day-1 action.

| Person | Handle | Focus | Activate when |
|---|---|---|---|
| Senior Partner | `@partner` `@dcs` | Director of Client Service | Market entry, fundraising narrative, board-level framing |
| Associate Partner | `@ap` | Problem structuring | Issue trees, hypothesis design, MECE decomposition |
| Engagement Manager | `@em` | Workplan & synthesis | Storyline, steerco decks, workstream sequencing |
| Consultant | `@consultant` `@associate` | Quantitative modeling | Value-at-stake models, business cases |
| Business Analyst | `@ba` | Research & benchmarking | Competitor fact base, market sizing, dated sources |
| Digital & Tech Transformation | `@digital` | Operating model | Product/tech transformation, org-tech fit |
| AI & Advanced Analytics | `@qb` | QuantumBlack | AI value capture, analytics ROI, responsible AI |
| Operations Excellence | `@ops` | Lean healthcare | Cost-to-serve, throughput, process waste |
| Org, Change & Implementation | `@org` `@implementation` | Transformation office | Org design, change management, capability build |

---

## Mandatory CC gates — never skip these

Independent of who is doing the work, these reviewers are pulled in automatically:

| If the task touches... | You MUST also activate | Person |
|---|---|---|
| Schema, migration, RLS policy | `data-pod` | Meera |
| Any new screen, page, or component | `frontend-pod` | Kiran (3 Design Laws) |
| Patient data / PHI / cross-tenant reads | `security-pod` | Ananya (DPDP) |
| A cross-module workflow (e.g. OPD→Lab→Billing) | `quality-pod` | Sunita (E2E coverage) |
| Money — bills, GST, claims, payroll | `revenue-pod` | Ravi (finance correctness) |
| A clinical action or care pathway | `clinical-pod` | Priya (clinical correctness) |
| An AI call on a clinical decision path | `nalini-cdo` | Dr. Nalini (SaMD gate) — **before build, not after** |
| A ₹ figure going to a board or investor | `kavitha-cfo` | Kavitha (validates the number) |

---

## Related

- `_team-coordination-rules.md` — activation maps per pod, and the **Convene Protocol** for
  multi-agent discussion.
- `_review-gates.md` — the escalation chain when two agents disagree.

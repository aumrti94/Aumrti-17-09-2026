# Product Tour — what is actually in Aumrti HMS

Read this once, end to end, before you start testing. You cannot test what you can't
explain, and you can't spot a wrong result if you don't know what the right one looks like
in a real hospital.

For each module: **what it is**, **who uses it**, **what it replaced**, and **why it
exists**. The "why" is what goes in the `Why This Exists` column of every test case.

**Scale:** 69 modules on the `/modules` grid · 174 unique routes · 53 settings screens ·
67 AI features · ~539 database tables · 101 edge functions · 16 assignable staff roles.

---

## How an Indian hospital actually runs (the 5-minute version)

If you know this, the modules stop looking like a random list.

A patient arrives at the **front desk**. If they've been before, the receptionist finds them
by phone number; if not, they're registered and given a **UHID** — a permanent hospital
number they keep for life. They pay a **consultation fee** and get a **token** for a
doctor's queue.

The doctor sees them in **OPD** (outpatient). Three things can come out of that visit:
a **prescription**, **investigations** (lab tests, scans), or an **admission**. Most
patients get a prescription and go home. Indian hospitals make real money on the second and
third.

If investigations are ordered, the patient goes to the **billing counter first** — in India
outpatients almost always pay before the test, not after — then to the **lab** or
**radiology**. Results come back to the doctor's screen.

If they need admission, they go to **IPD**. A bed is allocated, an **advance deposit** is
usually collected up front, and charges start accumulating: room rent per day, doctor visit
charges, nursing procedures, medicines, tests, surgery. At **discharge** every one of those
charges must be swept onto a final bill, the advance adjusted, and any excess refunded.
This sweep is where hospitals lose the most money, and where this app has the most complex
code.

Payment comes from one of four places, and this changes everything about the workflow:
**cash/UPI self-pay**, **private insurance via a TPA** (needs pre-authorisation before
admission), **government schemes** — PMJAY/Ayushman, CGHS for central government
pensioners, ECHS for ex-servicemen, state schemes (each with its own rules and rate cards),
or **corporate/company** accounts.

Wrapped around all of this: **NABH** accreditation (India's hospital quality standard —
demands documented evidence of clinical processes), **GST** on non-clinical services,
**NDPS** rules for narcotics like morphine, **PCPNDT** law for ultrasounds (India bans
sex determination, so every obstetric scan needs a signed Form F), and **ABDM** — the
national health ID programme.

That's the hospital. The modules below are the software for each part of it.

---

# CLINICAL

## OPD Queue — `/opd`
**What:** The outpatient consultation workspace. Token queue on the left, the patient's
consultation on the right — vitals, complaints, examination, diagnosis, prescription, lab
and scan orders, all in tabs.

**Who:** Receptionist creates the token; doctor runs the consultation.

**Replaced:** A paper OP card the patient carries, a token slip, and the doctor's
handwritten prescription pad.

**Why:** A busy Indian OPD doctor sees 60–200 patients a day — often 3–5 minutes each.
Paper means illegible prescriptions, no history when the patient returns, no way to know if
a prescribed test was ever done, and revenue leaking because ordered investigations never
reach the billing counter. This screen keeps history one click away and connects the order
to the bill.

> **Testing note that will save you confusion:** when the doctor adds a lab test or scan
> here, **no lab order is created**. It's stored as JSON on the prescription. The real order
> is created later in the Lab/Radiology module after payment
> ([ConsultationWorkspace.tsx:786-799](../../src/components/opd/ConsultationWorkspace.tsx#L786-L799)).
> This is deliberate — it mirrors "pay first, then test" — but it means the OPD→Lab handoff
> is a **text match on test name**, not a database link. A test the doctor typed that
> doesn't exactly match the lab catalogue is silently dropped.

## IPD / Wards — `/ipd`
**What:** Admitted patient management. Bed map, ward rounds, nursing notes, medications,
investigations, financials, and discharge.

**Who:** Doctors on rounds, nurses at the station, billing staff.

**Replaced:** The inpatient case file — a physical folder at the nursing station that
follows the patient's bed.

**Why:** The case file can only be in one place. The consultant wants it on rounds, the
nurse wants it for the drug chart, billing wants it to bill, and insurance wants a copy for
the claim. Digitising it means all four at once — and, critically, that nothing charged to
the patient goes unbilled at discharge.

## Day Care Unit — `/ipd/day-care`
**What:** Admissions for same-day procedures — dialysis, chemotherapy, minor surgery,
endoscopy. Uses a separate `DC-` admission series and a chair/slot board rather than beds.

**Why:** Insurers and PMJAY pay day-care procedures under different rules from a full
admission, and clinically these patients don't need a bed for the night. Billing them as
regular IPD gets claims rejected.

## Emergency — `/emergency`
**What:** ED triage and treatment. Triage level, ED medications, charges, handover notes,
MLC registration, code blue.

**Why:** Emergency runs on a different clock. You cannot ask an unconscious patient for a
UHID or wait for payment. The module lets treatment start on an unidentified patient and
sorts identity and billing out afterwards — while still capturing the medico-legal record
that Indian law requires for accidents, assaults and poisonings.

## MCI / Disaster Response — `/emergency/mci`
**What:** Mass casualty incident mode — activation, triage zones, P1–P4 tagging.

**Why:** Bus accident, factory fire, building collapse. Thirty patients arrive at once and
normal registration collapses. NABH requires hospitals to have a tested disaster plan; this
is that plan in software.

## Operation Theatre — `/ot`
**What:** OT scheduling, the WHO surgical safety checklist, consumables, implants,
instrument counts, team members.

**Why:** OT is the hospital's most expensive room and its highest-risk one. The WHO
checklist (sign-in, time-out, sign-out) measurably reduces wrong-site and wrong-patient
surgery and is a NABH requirement. Implant tracking matters because implants are expensive,
claimable, and must be traceable if a batch is recalled.

## Nursing — `/nursing`
**What:** MAR (medication administration record), vitals, handovers, care plans,
procedures, fall-risk and pressure-sore assessments, IV fluids, intake/output.

**Who:** Ward nurses — the heaviest users of any HMS.

**Why:** Nursing generates most clinical documentation and most NABH evidence. It's also
where medication errors happen. Double-check on high-alert drugs, and a real timestamped
record of who gave what when, is the difference between a defensible chart and a
medico-legal problem.

## Telemedicine — `/telemedicine`, `/teleconsult/doctor`
**What:** Video consultations with prescription issue.

**Why:** Legal in India since the 2020 Telemedicine Practice Guidelines, and the practical
way to serve follow-ups and rural patients. The guidelines have specific requirements about
consent and prescription format that a video call alone doesn't satisfy.

## Health Packages — `/packages`
**What:** Pre-priced preventive checkup bundles (Master Health Checkup, Diabetic Package,
corporate annual health checks).

**Why:** Packages are how Indian hospitals fill diagnostic capacity and win corporate
contracts. They're a bundle of services at one price, which means billing has to know that
16 individual line items add up to one package rate.

## Vaccination — `/vaccination`
**What:** National Immunisation Schedule tracking, due lists, cold chain logs, camps.

**Why:** India's NIS is a fixed schedule from birth. Missing a dose window matters
clinically and is reportable. Cold chain logging exists because a vaccine that got warm is
worthless and you must be able to prove it didn't.

## Ambulance Service — `/ambulance`
**What:** Dispatch board, transit vitals, equipment checks.

**Why:** Ambulances are a billable service and a liability. Knowing which vehicle is where,
and that its oxygen cylinder was checked this morning, is both operational and NABH.

## Home Care — `/home-care`
**What:** Post-discharge home visits, tele-monitoring, home care plans.

**Why:** A growing revenue line, and it reduces readmissions — which matters now that
insurers scrutinise 30-day readmissions.

## Chronic Disease Management — `/chronic-disease`
**What:** Long-term care plans for diabetes, hypertension, COPD; adherence tracking; cohort
dashboard.

**Why:** India has the world's largest diabetic population. These patients are seen for
years, and the value is in the trend, not the single visit.

## Dietetics & Nutrition — `/dietetics`
**What:** Nutritional screening, inpatient diet orders, dietitian notes, AI meal plans.

**Why:** NABH requires nutritional screening within 24 hours of admission. Practically, the
kitchen needs to know that bed 12 is a diabetic renal diet — and getting that wrong harms
patients.

---

# DIAGNOSTICS

## Laboratory (LIS) — `/lab`
**What:** Order receipt, sample collection with barcodes, result entry, auto-verification,
critical value alerts, QC, analyser integration.

**Why:** The lab is a factory: hundreds of samples, each of which must be tied to the right
patient. Barcoding at collection is what prevents the single worst lab error — a result
filed against the wrong patient. Critical value alerts (a potassium of 7.0) must reach the
doctor immediately, and NABH requires you to prove they did.

**Testing note:** results only reach the bill on the OPD path. IPD lab charges flow through
the discharge sweep instead — two different code paths, both need testing.

## Radiology (RIS) — `/radiology`
**What:** Imaging orders, modality worklist, reporting workspace, DICOM/PACS links, AI
impressions.

**Why:** Scans are high-value and the report is the product. Turnaround time is what
referring doctors judge you on.

## PCPNDT Register — `/radiology/pcpndt-register`
**What:** Form F register for obstetric ultrasounds.

**Why:** **This is criminal law, not a feature.** The Pre-Conception and Pre-Natal
Diagnostic Techniques Act bans sex determination. Every obstetric ultrasound requires a
signed Form F, retained and produced on inspection. Getting this wrong can close a radiology
department and jail the radiologist. The app auto-creates a Form F when an ultrasound study
name contains "obstetric" — which is worth testing hard, because it's a string match.

---

# PHARMACY

## Pharmacy (IP) — `/pharmacy`
**What:** Inpatient prescription queue, dispensing with batch selection, NDPS register,
stock, returns.

**Why:** Ward medicines are dispensed against a doctor's prescription and charged to the
admission. Batch selection is FEFO (first-expiry-first-out) because expired stock is money
burned and a patient risk. NDPS drugs — morphine, fentanyl — are narcotics under the
Narcotic Drugs and Psychotropic Substances Act: they need a register, dual sign-off, and
reconciliation. Getting this wrong is a licence issue.

**Testing note:** whether stock decrements at dispensing depends on the
`ipd_ancillary_payment` setting. Under **pre-paid**, the drug is reserved but stock only
moves after payment; under **post-paid** it moves immediately. Two genuinely different code
paths — both need a full run.

## Pharmacy Retail — `/pharmacy?mode=retail`
**What:** Walk-in counter POS. Cart, payment, bill, Z-report.

**Why:** The retail counter serves the public, not just patients, and is often a hospital's
steadiest cash line. It bills immediately and decrements stock immediately — unlike the IP
path.

---

# FINANCE

## Billing — `/billing`
**What:** The bill editor. Line items, payments, advances, discounts, insurance split, GST,
printing.

**Why:** Everything the hospital did to the patient has to arrive here, correctly, once.
Not twice. Charges arrive from six modules by six different routes, and each is deduplicated
by a key that has to match exactly between the module that wrote it and the sweep that
collects it. This is the single most fragile area of the application and deserves the most
testing.

> Bills print as **"PROVISIONAL BILL"** until finalised. That's correct behaviour, not a bug.

## Day Closure — `/billing/closure`
**What:** End-of-day cash reconciliation and lock.

**Why:** The cashier counts the drawer against what the system says was collected, and the
day is locked. After locking, **no bill for that day can be modified** — which is the point
(auditability), and also a trap worth testing: a long-stay patient discharged across a
locked day.

## Payments — `/payments`
**What:** Collections, receipts, advance receipts, pending collections, payment links.

**Why:** Indian hospitals collect in instalments — advance at admission, top-ups during the
stay, settlement at discharge. Tracking who owes what, and getting the advance correctly
adjusted against the final bill, is where patients get angry.

## Insurance / TPA — `/insurance`
**What:** Pre-authorisation, claim submission, TPA queries, denials, appeals, ageing,
reconciliation.

**Why:** Insured patients are half the revenue of a mid-size private hospital, and the money
arrives 45–90 days late, if at all. Pre-auth must be approved **before** admission or the
claim is refused. Every TPA has its own rules, room-rent ceilings and co-payment terms. A
denied claim that isn't appealed within the window is money gone permanently.

## Govt Schemes / PMJAY — `/pmjay`
**What:** PMJAY/Ayushman Bharat, CGHS, ECHS and state scheme claims.

**Why:** PMJAY covers ₹5 lakh per family per year and is the reason many hospitals get
empanelled. It's package-rate based with its own portal and claim schema.

> **CGHS/ECHS trap worth testing:** a CGHS or ECHS patient must have a **referral letter**
> on record. This app **hard-blocks bill finalisation** without one
> ([BillEditor.tsx](../../src/components/billing/BillEditor.tsx)) — deliberately, because
> claims without a referral get rejected. Both the with-referral and without-referral cases
> need testing.

## Accounts / ERP — `/accounts`
**What:** Chart of accounts, journal entries, cost centres, P&L, balance sheet, budgets,
fixed assets, TDS, Tally export.

**Why:** Hospital operations and hospital accounting are usually two disconnected systems,
with someone re-keying figures into Tally monthly. Auto-posting billing events into journals
removes that gap — and means an error in billing becomes an error in the P&L.

---

# OPERATIONS

## HR & Payroll — `/hr`, `/my-hr`
**What:** Staff records, attendance, duty roster, shifts, leave, salary, payslips, appraisals,
credentials, training.

**Why:** Hospitals are staff-heavy and run 24×7 on rotating shifts. NABH also requires
**credentialing and privileging** — proof that the doctor performing a procedure is
qualified and authorised to perform it. `/my-hr` is the employee's own self-service view.

## Inventory & Stores — `/inventory`
**What:** Stock, indents, purchase orders, GRN, vendors, rate contracts, reorder triggers,
cold chain.

**Why:** Consumables are a hospital's second-largest cost after salaries. Departments raise
indents, stores issue, purchase reorders. Without this you discover you're out of sutures
during a surgery.

## Medical Records (MRD) — `/mrd`
**What:** Record completion, ICD-10 coding, retention schedules, record requests, coding
audits.

**Why:** MRD is a real department in every Indian hospital. Files must be coded (ICD-10),
retained for a legally defined period (longer for MLC cases), and produced on request for
courts, insurers and patients. DPDP Act 2023 adds erasure obligations on top.

## Quality & NABH — `/quality`, `/nabh/compliance`
**What:** NABH standards matrix, evidence, quality indicators, clinical audits, QI projects,
CAPA, incident reports, committee meetings.

**Why:** NABH accreditation is what lets a hospital get empanelled with PMJAY, CGHS and most
insurers — it's commercially essential, not just a badge. The assessor asks for *evidence*
that a process happened, on a specific date, signed by a specific person. Generating that
evidence as a by-product of normal work, instead of a panicked scramble before the audit, is
the entire point.

## JCI Accreditation — `/quality/jci`
**What:** JCI standards matrix, IPSG 1–6, evidence bundle export.

**Why:** The international equivalent, pursued by hospitals chasing medical tourism.

## IPC Dashboard — `/ipc/dashboard`
**What:** Infection prevention — HAI surveillance, hand hygiene audits, device-associated
infections, care bundles, antibiogram.

**Why:** Hospital-acquired infections kill patients and are a NABH focus. The antibiogram —
which organisms in *this* hospital resist which antibiotics — is what makes antibiotic
choice evidence-based rather than habit.

## Antimicrobial Stewardship — `/quality/asp`
**What:** Restricted antibiotic list, justification workflow.

**Why:** India has among the world's worst antimicrobial resistance. Stewardship means a
restricted antibiotic requires documented justification.

## FMS / Safety — `/fms/dashboard`
**What:** Facility assets, maintenance, safety rounds, fire drills, medical gas, biomedical
waste.

**Why:** NABH's Facility Management and Safety chapter. Biomedical waste segregation is
separately mandated under the BMW Rules — colour-coded bags, manifests, authorised
disposal.

## Biomedical Engineering — `/biomedical`
**What:** Equipment register, preventive maintenance, calibration, breakdowns, AMC.

**Why:** An uncalibrated defibrillator or infusion pump is a patient-safety event waiting to
happen. NABH requires a calibration schedule and evidence it's followed.

## Housekeeping — `/housekeeping`
**What:** Cleaning tasks, bed turnover, linen, BMW.

**Why:** Bed turnover is the bottleneck on admissions — a discharged bed isn't available
until it's cleaned. The app creates a turnover task automatically at discharge.

## Govt HMIS Reporting — `/hmis`
**What:** MoHFW HMIS, IDSP disease surveillance, RMNCH+A reports.

**Why:** Statutory monthly reporting to government health portals. Notifiable diseases must
be reported to IDSP within defined timelines.

## Staff Training / LMS — `/lms`
**What:** Courses, enrolments, quizzes, certificates.

**Why:** NABH mandates specific training (BLS, infection control, fire safety) with
documented completion for every staff member.

## CRM & Marketing — `/crm`
**What:** Referring doctors, campaigns, online reviews, patient segments.

**Why:** Most Indian private hospital footfall comes from **referring doctors**. Tracking who
refers, and paying attention to them, is the core growth engine.

## ABDM / ABHA — `/abdm`
**What:** ABHA (health ID) creation, consent management, care context linking.

**Why:** India's national digital health programme. ABDM compliance is increasingly required
for government empanelment, and linking a visit as a "care context" is what makes the
patient's record portable between hospitals.

## Notifications — `/notifications`, `/inbox`
**What:** Notification log, escalation chains, WhatsApp/SMS/email, communication inbox.

**Why:** WhatsApp is how Indian hospitals actually communicate with patients. Reports,
bills, appointment reminders and discharge summaries all go out that way.

---

# SPECIALIZED CLINICAL

Each of these is a full specialty EMR with its own documentation shape — the reason they
exist separately is that a dialysis session, an IVF cycle and a tooth chart cannot be
recorded in a generic consultation form.

| Module | Route | What it captures | Why it's separate |
|---|---|---|---|
| **Dialysis** | `/dialysis` | Machine board, sessions, dialyzer reuse | Patients come 3×/week for years; machine and dialyzer tracking is regulated |
| **Oncology** | `/oncology` | Chemo protocols, cycles, toxicity, vial wastage | Chemo dosing is body-surface-area based and lethal if wrong; vials are extremely expensive and shared between patients |
| **Physiotherapy** | `/physio` | Sessions, therapy plans, home exercise programmes, outcome scores | Outcome-measured over weeks, not per visit |
| **Dental** | `/dental` | FDI tooth chart, periodontal chart, treatment plans, lab orders | Nothing about a tooth chart fits a normal EMR |
| **AYUSH** | `/ayush` | Ayurveda/Homeopathy/Unani/Siddha, Prakriti assessment, Panchakarma | Entirely different diagnostic framework; Ministry of AYUSH has its own norms |
| **IVF & ART** | `/ivf` | Cycles, embryology, andrology, embryo bank | The ART Act 2021 mandates specific records and ICMR registration |
| **Obstetric ANC** | `/specialty/anc` | Antenatal visits, risk flags | Pregnancy is a 9-month longitudinal record with defined visit schedules |
| **Partograph** | `/specialty/partograph` | WHO labour chart with alert/action lines | The WHO partograph is the standard tool for detecting obstructed labour |
| **Neonatal** | `/specialty/neonatal` | APGAR, Bhutani nomogram, CCHD screening | Newborns are a separate patient with their own record from minute one |
| **Anaesthesia** | `/specialty/anaesthesia` | PAC, intraoperative chart, PACU Aldrete | Minute-by-minute intraoperative record; medico-legally critical |
| **Ophthalmology** | `/specialty/ophthalmology` | VA, refraction, IOP, fundoscopy, IOL calculation | Eye examination data is entirely structured and unlike anything else |
| **Mental Health** | `/mental-health` | Consultations, psychometric scales, therapy plans, risk assessment | Confidentiality rules differ; Mental Healthcare Act 2017 |
| **Blood Bank** | `/blood-bank` | Donors, units, TTI testing, cross-match, transfusion reactions | Licensed separately under Drugs & Cosmetics Act; every unit must be traceable donor-to-recipient |
| **CSSD** | `/cssd` | Sterilisation cycles, instrument sets, issues | Sterility must be provable per cycle; a failed cycle means recalling instruments |
| **Mortuary & Medico-Legal** | `/mortuary` | Mortuary register, MCCD, MLC, organ donation | Death certification (MCCD) is a statutory form; MLC cases involve police |

---

# ANALYTICS & AI

## Analytics & BI — `/analytics`, `/hod-dashboard`, `/ceo-board`
Revenue and clinical dashboards, department KPIs, executive view.

## Population Health — `/analytics/population-health`
Disease burden, NCD control rates, risk stratification, NIKSHAY TB integration.

## Revenue Intelligence — `/analytics/revenue-intelligence`
Service-line P&L, payor mix, average length of stay vs benchmark, AR days.
**Why:** most hospitals cannot tell you whether their orthopaedics line makes money.

## AI Clinical Intelligence — `/ai/clinical-intelligence`
Deterioration watch, length-of-stay prediction, AI prior authorisation.

## Research Platform — `/research`
Cohort builder, k-anonymity de-identification, FHIR export.
**Why:** teaching hospitals need research data without leaking PHI.

## The AI Suite — 67 features
Every AI feature is individually gateable by plan and can be switched off per hospital.
The complete list is in [`src/lib/aiFeatures.ts`](../../src/lib/aiFeatures.ts). The ones you
will meet most while testing:

### Voice Scribe — the flagship
**What:** The doctor speaks; the app produces a structured SOAP note plus prescription,
lab and radiology orders. Available in OPD, IPD, Emergency and nursing.

**Current process without it:** In a 200-patient OPD, a doctor either types while the
patient talks — breaking eye contact and slowing the queue — or scribbles on paper and
writes proper notes hours later from memory. Some hospitals employ a junior doctor purely as
a scribe. The result is thin, late documentation: exactly what fails a NABH audit, and
exactly what you can't defend in a medico-legal case years later.

**Pain point solved:** the note is complete and structured **before the patient leaves the
room**, the doctor keeps eye contact, and NABH evidence is generated as a by-product rather
than a chore. **Voice Scribe Audio Rescue** re-listens to only the low-confidence segments
with a multimodal model, because Indian drug names and accents are where ASR usually breaks.

**Why it needs hard testing:** it writes into a clinical record. A mis-transcribed drug name
or dose is a patient-safety event. Test it against Indian drug names, mixed
Hindi/English speech, and background OPD noise.

### Others you'll test often
- **ICD-10 Code Suggester** — coding is a specialist skill; suggestions cut MRD backlog
- **Discharge Summary** — the single most-delayed document in any hospital
- **Radiology AI Impression** — drafts the impression, radiologist verifies
- **Drug Interaction AI** — safety net beyond the rules engine
- **Sepsis Early Warning (NEWS2)** — sepsis kills when it's noticed late
- **Revenue Leakage Detector** — finds charges that were delivered but never billed
- **Denial Predictor / Appeal Letter Writer** — claim rejection is a hospital's biggest silent loss
- **Pre-Auth Summary + Auto-Fill** — pre-auth paperwork is hours of clerical work per admission

> **Every AI feature is gated three ways** — plan entitlement, hospital toggle, and AI
> budget. If an AI button isn't visible, check all three before logging a bug.

---

# PATIENT-FACING

## Patient Portal — `/portal`
Patients view bills, reports and appointments; chat with the hospital.

## Kiosk — `/kiosk`
Self check-in, self-registration, self-payment at a lobby terminal. Reduces the front-desk
queue, which in Indian hospitals is the first thing a patient complains about.

## TV Display — `/tv-display`, `/ward-board`
Waiting-area token screen and ward status board.

## Patient Relations (PRO) — `/pro`
Grievances, feedback, visitor passes, NABH Patient Care Committee.
**Why:** NABH requires a documented grievance mechanism with closure timelines.

---

# PLATFORM (your SaaS admin — not the hospital's)

`/platform/*` — 20 sub-routes you use to run Aumrti as a business: hospital tenants, plans,
discounts, referrals, revenue, AI performance and cost, incidents, feature flags, support,
churn radar, compliance, audit.

**Why it needs testing too:** this is where you switch a hospital's plan, withhold a
feature, or flag an incident. A mistake here affects every hospital at once.

---

# The four gates on every screen

Worth knowing before you file a "the button is missing" bug. All four must pass:

1. **AuthGuard** — logged in
2. **ModuleGate** — the hospital's plan includes this module
3. **RoleGuard** — your role is allowed on this route
4. **hasTabAccess / hasActionAccess** — per-tab and per-button permission, with a platform
   "entitlement floor" that **even a super admin cannot override**

If something isn't visible, work down that list before assuming it's broken.

---

# Where this app fails silently

The most important page in this document. In each of these cases the app shows no error —
it just quietly does the wrong thing. Every one is a test case.

| Missing configuration | What happens |
|---|---|
| No consultation fee in `service_master` | Bills a **hardcoded ₹500** |
| No `wards.rate_per_day` | Room charge falls back to **₹500/day** |
| Lab test name doesn't match the catalogue exactly | Test is **silently dropped** from the order |
| No `hospital_config_values` for drug routes/frequencies | Prescription dropdowns render **empty** |
| No radiology modalities | "No studies configured" |
| No `discount_approval_rules` | **Every discount auto-approves** |
| `hospital_id` unresolved | All master-data pickers render empty, no error shown |
| WhatsApp not configured | Every notification **silently no-ops** |
| ABDM not configured | Edge functions fail quietly |

Add to that the structural risks worth targeting:

- **Charge dedupe keys** must match byte-for-byte between the module that writes a charge
  and the discharge sweep that collects it. Drift here means **double billing**.
- **Bill numbers can be burned** — the Lab, Radiology and Retail paths call the numbering RPC
  and *then* insert, so a failed insert consumes a number.
- **A patient with two tokens on the same day** can have the wrong bill linked to the
  encounter, because the backfill picks "most recent unlinked OPD bill today".

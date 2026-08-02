# Mock Data Book

**Every value you will ever need to type, written down.** Never invent test data — if it
isn't here, don't use it. Consistent data is what makes a failure reproducible and what lets
the Playwright suite test exactly what you tested by hand.

`scripts/qa-seed.mjs` creates all of this. `e2e/fixtures/mock-data.ts` reads the same values
so manual and automated runs are identical.

---

## ⚠️ Finding before you start: the role list doesn't line up

The Postgres `app_role` enum has **16 values**. But `src/lib/modules.ts` gates routes on
**48 distinct role strings** — meaning **32 roles are used for route access control but
cannot exist as a staff login**.

**In the enum (a staff login can have these):**
`super_admin` · `hospital_admin` · `doctor` · `nurse` · `receptionist` · `pharmacist` ·
`lab_tech` · `lab_technician` · `accountant` · `billing_executive` · `billing_staff` ·
`cfo` · `hr_manager` · `insurance_executive` · `mrd_officer` · `radiologist`

**Referenced in routing but NOT in the enum:**
`anaesthetist` · `ayush_doctor` · `biomedical_technician` · `blood_bank_technician` ·
`ceo` · `chemo_nurse` · `cmo` · `cssd_technician` · `dentist` · `dialysis_technician` ·
`dietitian` · `embryologist` · `facility_manager` · `hmis_officer` ·
`housekeeping_supervisor` · `infection_control_nurse` · `inventory_manager` · `ivf_doctor` ·
`marketing` · `medical_officer` · `midwife` · `mortuary_officer` · `neonatologist` ·
`nephrologist` · `nursing_supervisor` · `obstetrician` · `oncologist` · `ophthalmologist` ·
`paediatrician` · `physiotherapist` · `pro_officer` · `psychiatrist` · `psychologist` ·
`quality_manager` · `quality_officer`

**What this means for testing:** modules like Blood Bank, CSSD, Dialysis and Quality list a
specialist role as their intended user, but you cannot create that user. In practice those
modules are only reachable by `super_admin` / `hospital_admin` (the bypass roles) or via
custom permission blobs.

**This is not a blocker for testing** — we seed the 16 real roles. But test cases
`TC-P1D-017` and `TC-P1E-046` probe this deliberately, because it's very likely a real
defect rather than a deliberate design. Confirm the intent before logging it.

---

## Hospitals

Two tenants. **Hospital B exists for one reason: to prove Hospital A's users can never see
its data.** Every clinical phase includes a cross-tenant check against it.

### Hospital A — the main test hospital

Use this for everything unless a case says otherwise.

| Registration field | Value |
|---|---|
| Hospital Name | `Aarogya Multispecialty Hospital` |
| Hospital Type | `Private Hospital` |
| State | `Telangana` |
| Bed Count | `101–200 beds` |
| Phone | `9876500001` |
| Admin Full Name | `Dr. Ravi Shankar` |
| Admin Email | `yeswanthvarma94@gmail.com` |
| Password | `TestPass@2026` |
| Designation | `Medical Director` |
| Address 1 | `Plot 42, Road No. 12, Banjara Hills` |
| Address 2 | `Near Care Hospital` |
| Pincode | `500034` |
| City | `Hyderabad` |
| GSTIN | `36AABCA1234F1Z5` |
| NABH Accredited | `Yes` |
| NABH Number | `NABH-QA-A-2026` |
| Website | `https://qa-aarogya.example.in` |
| Plan | `Professional` |

### Hospital B — the isolation control

| Registration field | Value |
|---|---|
| Hospital Name | `Sanjeevani General Hospital` |
| Hospital Type | `Nursing Home` |
| State | `Maharashtra` |
| Bed Count | `30–50 beds` |
| Phone | `9876500002` |
| Admin Full Name | `Dr. Meena Joshi` |
| Admin Email | `gysk94@gmail.com` |
| Password | `TestPass@2026` |
| Designation | `Hospital Administrator` |
| Address 1 | `Survey No. 88, Baner Road` |
| Pincode | `411045` |
| City | `Pune` |
| GSTIN | `27AABTS5678K1Z9` |
| NABH Accredited | `No` |
| Plan | `Starter` (trial) |

> **Note the deliberate GSTIN state codes:** `36` = Telangana, `27` = Maharashtra. If a GST
> test produces the wrong place-of-supply behaviour, this is why it's detectable.

---

## Staff logins

**Password for every account: `TestPass@2026`**

**The two hospital administrators use two separate real inboxes**, so each tenant can be
administered independently — which is what makes the isolation testing realistic rather than
two accounts you happen to own from the same mailbox:

| | Administrator login |
|---|---|
| **Hospital A** | `yeswanthvarma94@gmail.com` |
| **Hospital B** | `gysk94@gmail.com` |

Everyone else uses Gmail plus-addressing off the **Hospital A** inbox
(`yeswanthvarma94+qa.<role>.<a\|b>@gmail.com`), so every verification email still lands
somewhere you can reach.

> If you would rather Hospital B's other two staff came off the `gysk94` inbox instead
> (`gysk94+qa.doctor.b@gmail.com`, `gysk94+qa.reception.b@gmail.com`), say so — it's a
> two-line change in `e2e/fixtures/mock-data.json`. Both work; the current split just keeps
> the day-to-day verification emails in one place.

### Hospital A — 17 logins covering all 16 assignable roles

| # | Role | Email | Name | Expected landing route |
|---|---|---|---|---|
| 1 | `hospital_admin` | **`yeswanthvarma94@gmail.com`** | Dr. Ravi Shankar | `/dashboard` |
| 2 | `doctor` | `+qa.doctor.a` | Dr. Suresh Menon (Gen. Medicine) | `/dashboard` → `/opd` |
| 3 | `doctor` | `+qa.doctor2.a` | Dr. Kavitha Rao (Obs & Gynae) | `/dashboard` → `/opd` |
| 4 | `doctor` | `+qa.surgeon.a` | Dr. Arjun Nair (Gen. Surgery) | `/dashboard` → `/ot` |
| 5 | `nurse` | `+qa.nurse.a` | Sr. Mary Thomas | `/dashboard` → `/nursing` |
| 6 | `receptionist` | `+qa.reception.a` | Ms. Divya Sharma | `/dashboard` → `/opd` |
| 7 | `pharmacist` | `+qa.pharmacist.a` | Mr. Imran Khan | `/pharmacy` |
| 8 | `lab_technician` | `+qa.labtech.a` | Mr. Naveen Kumar | `/lab` |
| 9 | `lab_tech` | `+qa.labtech2.a` | Ms. Sneha Patil | `/lab` |
| 10 | `radiologist` | `+qa.radiologist.a` | Dr. Anil Verma | `/radiology` |
| 11 | `billing_executive` | `+qa.billing.a` | Mr. Rajesh Gupta | `/billing` |
| 12 | `billing_staff` | `+qa.billing2.a` | Ms. Pooja Singh | `/billing` |
| 13 | `accountant` | `+qa.accountant.a` | Mr. Venkat Rao | `/accounts` |
| 14 | `cfo` | `+qa.cfo.a` | Ms. Lakshmi Iyer | `/accounts/financial-statements` |
| 15 | `hr_manager` | `+qa.hr.a` | Mr. Prakash Jain | `/hr` |
| 16 | `insurance_executive` | `+qa.insurance.a` | Ms. Fatima Sheikh | `/insurance` |
| 17 | `mrd_officer` | `+qa.mrd.a` | Mr. Sanjay Deshmukh | `/mrd` |

### Hospital B — 3 logins (enough to prove isolation)

| Role | Email | Name |
|---|---|---|
| `hospital_admin` | **`gysk94@gmail.com`** | Dr. Meena Joshi |
| `doctor` | `+qa.doctor.b` | Dr. Rohan Kulkarni |
| `receptionist` | `+qa.reception.b` | Ms. Snehal More |

### Platform super admin

| Role | Email | Purpose |
|---|---|---|
| `super_admin` | `yeswanthvarma94+qa.superadmin@gmail.com` | `/platform/*` — Phase 15 |

---

## Master data — Hospital A

Everything below is created during **Phase 2**. Until it exists, most modules will appear
broken. See [SETTINGS_PREREQ_MATRIX.md](SETTINGS_PREREQ_MATRIX.md).

### Departments — Settings → Departments

| Name | Code | Type |
|---|---|---|
| General Medicine | `GMED` | Clinical |
| General Surgery | `GSUR` | Clinical |
| Obstetrics & Gynaecology | `OBGY` | Clinical |
| Paediatrics | `PAED` | Clinical |
| Orthopaedics | `ORTH` | Clinical |
| Anaesthesiology | `ANES` | Clinical |
| Radiology | `RADI` | Diagnostic |
| Pathology | `PATH` | Diagnostic |
| Pharmacy | `PHAR` | Support |
| Emergency | `EMER` | Clinical |

> Indian English spellings are deliberate — `Anaesthesiology`, `Gynaecology`,
> `Orthopaedics`, `Paediatrics`. If the app renders US spellings anywhere, that's a P3.

### Wards & beds — Settings → Wards

`rate_per_day` **must** be set. Without it the app silently charges ₹500/day.

| Ward | Category | Beds | Bed numbers | Rate/day |
|---|---|---|---|---|
| General Ward | `general` | 10 | `GW-01` … `GW-10` | `₹1,500` |
| Semi-Private | `semi_private` | 6 | `SP-01` … `SP-06` | `₹3,000` |
| Private Room | `private` | 4 | `PR-01` … `PR-04` | `₹6,000` |
| Deluxe Room | `deluxe` | 2 | `DX-01`, `DX-02` | `₹9,500` |
| ICU | `icu` | 6 | `ICU-01` … `ICU-06` | `₹12,000` |
| Maternity Ward | `general` | 4 | `MW-01` … `MW-04` | `₹2,500` |

> **Deliberate GST test values:** General Ward at ₹1,500 is below the ₹5,000 threshold
> (no GST). Deluxe at ₹9,500 is above it (5% GST). ICU at ₹12,000 is above the threshold but
> **ICU is exempt** — so it must attract no GST despite the amount. Those three beds test
> all three branches of the room-charge GST rule.

### Doctors & consultation fees — Settings → Staff, Settings → Services

| Doctor | Department | Consultation | Follow-up | Validity | Emergency | IPD visit |
|---|---|---|---|---|---|---|
| Dr. Suresh Menon | General Medicine | `₹500` | `₹0` | `7 days` | `₹800` | `₹400` |
| Dr. Kavitha Rao | Obs & Gynae | `₹700` | `₹300` | `10 days` | `₹1,000` | `₹500` |
| Dr. Arjun Nair | General Surgery | `₹800` | `₹0` | `7 days` | `₹1,200` | `₹600` |

> Dr. Menon's free follow-up within 7 days drives scenarios **P4-S02** and **P4-S03**.
> Dr. Rao's ₹300 paid follow-up is the contrast case.

### Services & rates — Settings → Services

| Service | Code | Category | Rate | GST | HSN |
|---|---|---|---|---|---|
| General Consultation | `CONS-GEN` | consultation | `₹500` | Exempt | `999312` |
| Specialist Consultation | `CONS-SPL` | consultation | `₹800` | Exempt | `999312` |
| Dressing (Minor) | `PROC-DRS` | procedure | `₹300` | Exempt | `999312` |
| Nebulisation | `PROC-NEB` | procedure | `₹250` | Exempt | `999312` |
| Suturing (up to 5cm) | `PROC-SUT` | procedure | `₹1,200` | Exempt | `999312` |
| Ambulance (per trip, local) | `SERV-AMB` | service | `₹1,500` | 5% | `996423` |
| Medical Records Copy | `SERV-MRD` | service | `₹250` | 18% | `998599` |
| Attendant Meal | `SERV-MEAL` | service | `₹200` | 5% | `996331` |
| Hernia Repair (Open) | `SURG-HERN` | surgery | `₹35,000` | Exempt | `999312` |
| Haemodialysis Session | `PROC-HD` | procedure | `₹2,200` | Exempt | `999312` |

> **The GST mix is deliberate.** Clinical services are exempt; ambulance, meals and record
> copies are taxable at different rates. A bill mixing these is scenario **P8-S04/S05**. All
> rows carry an HSN because bill finalisation is hard-blocked without one once the hospital
> GSTIN is set.

### Health package

| Package | Rate | Includes |
|---|---|---|
| Master Health Checkup | `₹3,500` | CBC, FBS, Lipid Profile, LFT, RFT, TSH, Urine Routine, ECG, Chest X-Ray, Consultation |

### Drug master — Settings → Drugs

| # | Drug | Generic | Form | Strength | Schedule | MRP | GST |
|---|---|---|---|---|---|---|---|
| 1 | Dolo 650 | Paracetamol | Tablet | 650mg | OTC | `₹30.00` | 12% |
| 2 | Augmentin 625 | Amoxicillin + Clavulanate | Tablet | 625mg | **H** | `₹198.00` | 12% |
| 3 | Mox 500 | Amoxicillin | Capsule | 500mg | **H** | `₹62.00` | 12% |
| 4 | Pan 40 | Pantoprazole | Tablet | 40mg | H | `₹115.00` | 12% |
| 5 | Metformin 500 | Metformin | Tablet | 500mg | H | `₹28.00` | 12% |
| 6 | Telma 40 | Telmisartan | Tablet | 40mg | H | `₹142.00` | 12% |
| 7 | Amlong 5 | Amlodipine | Tablet | 5mg | H | `₹58.00` | 12% |
| 8 | Atorva 10 | Atorvastatin | Tablet | 10mg | H | `₹88.00` | 12% |
| 9 | Zifi 200 | Cefixime | Tablet | 200mg | H | `₹165.00` | 12% |
| 10 | Emeset 4 | Ondansetron | Injection | 4mg/2ml | H | `₹22.00` | 12% |
| 11 | Lasix 40 | Furosemide | Tablet | 40mg | H | `₹18.00` | 12% |
| 12 | Human Mixtard 30/70 | Insulin | Injection | 100IU/ml | H | `₹385.00` | 5% |
| 13 | Monocef 1g | Ceftriaxone | Injection | 1g | H | `₹78.00` | 12% |
| 14 | Perinorm | Metoclopramide | Tablet | 10mg | H | `₹14.00` | 12% |
| 15 | Crocin Syrup | Paracetamol | Syrup | 125mg/5ml | OTC | `₹52.00` | 12% |
| 16 | Deriphyllin | Etophylline+Theophylline | Injection | 2ml | H | `₹26.00` | 12% |
| 17 | Tramadol 50 | Tramadol | Capsule | 50mg | **H1** | `₹42.00` | 12% |
| 18 | **Morphine Sulphate** | Morphine | Injection | 10mg/ml | **NDPS** | `₹95.00` | 12% |
| 19 | **Fentanyl** | Fentanyl | Injection | 50mcg/ml | **NDPS** | `₹135.00` | 12% |
| 20 | Normal Saline | Sodium Chloride 0.9% | IV Fluid | 500ml | OTC | `₹45.00` | 12% |

**Drug batches** — the expiry values are deliberate:

| Drug | Batch | Qty | Expiry | Purpose |
|---|---|---|---|---|
| Dolo 650 | `QA-DOLO-A` | 500 | `31/12/2027` | normal stock |
| Dolo 650 | `QA-DOLO-B` | 200 | `31/03/2027` | **FEFO test** — must be picked before batch A |
| Augmentin 625 | `QA-AUG-A` | 100 | `30/06/2027` | the allergy-block drug |
| Mox 500 | `QA-MOX-EXP` | 50 | `31/01/2026` | **expired** — must be refused |
| Zifi 200 | `QA-ZIFI-Q` | 80 | `31/08/2027` | **quarantined** — must be excluded |
| Morphine Sulphate | `QA-MOR-A` | 20 | `31/12/2027` | NDPS dual sign-off |
| Metformin 500 | `QA-MET-LOW` | 8 | `30/09/2027` | **below reorder level** — triggers alert |
| all others | `QA-<CODE>-A` | 100 | `31/12/2027` | |

### Lab test master — Settings → Lab Tests

| Test | Code | Sample | Fee | Unit | Normal range | TAT |
|---|---|---|---|---|---|---|
| Complete Blood Count | `CBC` | EDTA Blood | `₹350` | — | — | 120 min |
| Haemoglobin | `HB` | EDTA Blood | `₹120` | g/dL | 13.0–17.0 | 60 min |
| Fasting Blood Sugar | `FBS` | Fluoride | `₹80` | mg/dL | 70–100 | 60 min |
| Post Prandial Blood Sugar | `PPBS` | Fluoride | `₹80` | mg/dL | 70–140 | 60 min |
| HbA1c | `HBA1C` | EDTA Blood | `₹550` | % | 4.0–5.6 | 240 min |
| Serum Creatinine | `CREAT` | Serum | `₹180` | mg/dL | 0.7–1.3 | 120 min |
| Blood Urea | `UREA` | Serum | `₹150` | mg/dL | 15–40 | 120 min |
| **Serum Potassium** | `K` | Serum | `₹200` | mEq/L | 3.5–5.1 | 60 min |
| Serum Sodium | `NA` | Serum | `₹200` | mEq/L | 135–145 | 60 min |
| Liver Function Test | `LFT` | Serum | `₹650` | — | — | 240 min |
| Lipid Profile | `LIPID` | Serum | `₹700` | — | — | 240 min |
| Thyroid Profile | `TSH` | Serum | `₹450` | µIU/mL | 0.4–4.0 | 240 min |
| Urine Routine | `URINE` | Urine | `₹150` | — | — | 120 min |
| Dengue NS1 | `DENG` | Serum | `₹800` | — | Negative | 180 min |
| Blood Culture | `BCULT` | Culture Bottle | `₹1,200` | — | No growth | 4320 min |

> **Serum Potassium is the critical-value test.** Scenario **P5-S07** enters `7.2` (normal
> 3.5–5.1) and the critical alert must fire immediately. **Serum Creatinine** is the delta
> check — enter `0.9`, then `4.5` on the same patient.

**Lab test group:**

| Group | Fee | Members |
|---|---|---|
| Fever Panel | `₹1,100` | CBC, Urine Routine, Dengue NS1 |

> Note ₹1,100 vs the ₹1,300 individual sum — the group price must win. That's **P5-S04**.

### Radiology — Settings → Radiology

**Modalities:** X-Ray (`xray`) · Ultrasound (`usg`) · CT Scan (`ct`) · MRI (`mri`)

| Study | Modality | Fee |
|---|---|---|
| Chest X-Ray PA View | X-Ray | `₹400` |
| X-Ray Knee AP/Lateral | X-Ray | `₹450` |
| USG Abdomen & Pelvis | Ultrasound | `₹1,200` |
| **USG Obstetric (Level II)** | Ultrasound | `₹1,800` |
| **USG Pregnancy Profile** | Ultrasound | `₹1,500` |
| CT Brain Plain | CT Scan | `₹3,500` |
| MRI Lumbar Spine | MRI | `₹8,500` |

> **Two obstetric studies, deliberately named differently.** Form F auto-creation triggers
> on the study name containing "obstetric". *USG Obstetric (Level II)* should trigger it.
> *USG Pregnancy Profile* is clinically the same thing but doesn't contain the word — test
> what actually happens. Scenario **P5-S13/S14**.

### Payers & TPAs — Settings → Payer Masters

| Payer | Type | Room ceiling | Co-pay | Deductible |
|---|---|---|---|---|
| Self Pay / Cash | `self` | — | — | — |
| Star Health Insurance | `tpa` | `₹5,000/day` | 10% | `₹0` |
| HDFC ERGO | `tpa` | `₹4,000/day` | 0% | `₹5,000` |
| Medi Assist | `tpa` | `₹3,000/day` | 20% | `₹0` |
| PMJAY / Ayushman Bharat | `govt` | package rates | — | — |
| CGHS | `govt` | CGHS rates | — | — |
| ECHS | `govt` | ECHS rates | — | — |
| Infosys Corporate Panel | `corporate` | `₹6,000/day` | 0% | `₹0` |

> **HDFC ERGO's ₹4,000/day ceiling against a ₹6,000/day Private Room** is scenario
> **P9-S07** — the proportionate deduction case. Get this wrong and it's a real argument
> with a real patient at the discharge counter.

### Config values — Settings → Config Values

**Drug routes:** `Oral` · `IV` · `IM` · `SC` · `Topical` · `Inhalation` · `Rectal` ·
`Sublingual` · `Ophthalmic`

**Drug frequencies:** `OD` (once daily) · `BD` (twice) · `TDS` (thrice) · `QID` (four
times) · `HS` (at bedtime) · `SOS` (as needed) · `STAT` (immediately) · `Q6H` · `Q8H`

> Without these two lists, the prescription route and frequency dropdowns render **empty**
> with no error. That's the single most common "OPD is broken" false alarm.

### Discount approval rules — Settings → Approvals

| Threshold | Behaviour |
|---|---|
| ≤ 20% | auto-approved, audit row written |
| > 20% | requires `hospital_admin` approval |
| > 50% | requires `hospital_admin` **and** `cfo` |

### IPD ancillary payment — Settings → IPD Ancillary Payment

Default for testing: **`post_paid`**.
Scenarios **P6-S03**, **P7-S12** and **P5-S03** switch it to `pre_paid` and re-run — these
are genuinely different code paths including whether pharmacy stock decrements at all.

---

## Patients — 40 records

UHID pattern `PT-QA-0001` … `PT-QA-0040`. All in **Hospital A** unless marked.
Phone numbers are `98765` + the record number, so they're easy to search.

| UHID | Name | Age/Sex | Payer | Distinguishing feature | Used by |
|---|---|---|---|---|---|
| `PT-QA-0001` | Ramesh Kumar | 42 M | Self Pay | the baseline patient | P4-S01/02/03 |
| `PT-QA-0002` | Sunita Reddy | 34 F | Self Pay | complete details | P3-S01 |
| `PT-QA-0003` | Anitha Menon | 51 F | Self Pay | pre-booked appointments | P4-S04 |
| `PT-QA-0004` | Vinod Agarwal | 45 M | Star Health | private insurance | P4-S05 |
| `PT-QA-0005` | Lakshmi Devi | 58 F | PMJAY | Ayushman card `PMJAY-QA-0005` | P4-S06, P7-S04 |
| `PT-QA-0006` | R. Subramanian | 67 M | CGHS | **has referral letter** | P4-S07, P9-S14 |
| `PT-QA-0007` | K. Venkatesan | 71 M | CGHS | **NO referral letter** 🔴 | P4-S08, P9-S15 |
| `PT-QA-0008` | Havildar Singh | 63 M | ECHS | ex-serviceman | P9 |
| `PT-QA-0009` | Baby Aarav Sharma | 8 mo M | Self Pay | 7.2 kg, paediatric dosing | P4-S09 |
| `PT-QA-0010` | Krishnamurthy Iyer | 74 M | Self Pay | **on 6 drugs — interaction test** | P4-S10 |
| `PT-QA-0011` | Fatima Begum | 39 F | Self Pay | **ALLERGY: Penicillin** 🔴 | P4-S11, P6 |
| `PT-QA-0012` | Deepa Nair | 27 F | Self Pay | **22 weeks pregnant** 🔴 | P4-S13, P5-S13 |
| `PT-QA-0013` | Ganesh Pawar | 33 M | Self Pay | pays partially, leaves owing | P4-S21 |
| `PT-QA-0014` | Mohan Rao | 48 M | Self Pay | staff relative — 50% discount request | P4-S20, P8-S11 |
| `PT-QA-0015` | Unknown Male ~35 | ~35 M | Self Pay | **no ID, unconscious, MLC** | P3-S03, P4-S23, P10 |
| `PT-QA-0016` | Priya Deshmukh | 29 F | Self Pay | **in labour** — delivery + newborn | P7-S07, P12 |
| `PT-QA-0017` | B/O Priya Deshmukh | 0 d M | Self Pay | **newborn**, linked to 0016 | P3-S04, P7-S07 |
| `PT-QA-0018` | Sharma Ji | 55 M | Self Pay | planned hernia repair, ₹25,000 advance | P7-S01, P7-S15 |
| `PT-QA-0019` | Shalini Nair | 44 F | HDFC ERGO | **pre-auth ₹80,000, Private Room** 🔴 | P7-S03, P9-S07 |
| `PT-QA-0020` | Abdul Rahman | 62 M | Medi Assist | 20% co-pay | P9-S08 |
| `PT-QA-0021` | Sarita Joshi | 36 F | Infosys Panel | corporate | P9 |
| `PT-QA-0022` | Gopal Krishna | 68 M | Self Pay | **CKD — dialysis 3×/week** | P7-S08, P12 |
| `PT-QA-0023` | Vimala Sundaram | 54 F | Self Pay | **oncology — needs morphine** 🔴 | P6-S07, P12 |
| `PT-QA-0024` | Rakesh Yadav | 40 M | Self Pay | **sepsis — ICU, ventilated** | P7-S06, P14 |
| `PT-QA-0025` | Kamala Bai | 79 F | Self Pay | **LAMA — family takes her home** | P7-S18 |
| `PT-QA-0026` | Bhaskar Reddy | 81 M | Self Pay | **dies in hospital — MCCD** | P7-S19, P10 |
| `PT-QA-0027` | Nitin Kulkarni | 37 M | Self Pay | **readmitted 11 days later** | P7-S20 |
| `PT-QA-0028` | Meera Pillai | 31 F | Self Pay | **long stay, 1st–10th, crosses locked day** | P7-S13 |
| `PT-QA-0029` | Ramesh Kumar | 42 M | Self Pay | **deliberate duplicate of 0001** 🔴 | P3-S02, P4-S22 |
| `PT-QA-0030` | Rohan Kulkarni | 45 M | Self Pay | **HOSPITAL B ONLY** — isolation control 🔴 | P3-S12, R7 |
| `PT-QA-0031` | Savitri Amma | 66 F | Self Pay | diabetic + hypertensive, chronic disease | P12 |
| `PT-QA-0032` | Arun Prakash | 24 M | Self Pay | assault injury — **MLC** | P4-S23, P10 |
| `PT-QA-0033` | Nandini Rao | 30 F | Self Pay | **IVF cycle** | P12 |
| `PT-QA-0034` | Suresh Babu | 52 M | Self Pay | **dental** — full mouth charting | P12 |
| `PT-QA-0035` | Ismail Sheikh | 47 M | Self Pay | **mental health** — risk assessment | P12 |
| `PT-QA-0036` | Geetha Krishnan | 59 F | Self Pay | **physiotherapy** post-fracture | P4-S16, P12 |
| `PT-QA-0037` | Padma Rani | 34 F | Self Pay | **AYUSH** — Prakriti assessment | P12 |
| `PT-QA-0038` | Vikram Chauhan | 28 M | Self Pay | **ophthalmology** — refraction, IOL | P12 |
| `PT-QA-0039` | Anand Verma | 43 M | Self Pay | **blood transfusion** — cross-match | P10 |
| `PT-QA-0040` | Kalpana Iyer | 49 F | Star Health | **claim denied → appeal** 🔴 | P9-S10 |

---

## Values used across many tests

| Thing | Value |
|---|---|
| Standard password | `TestPass@2026` |
| Standard advance | `₹25,000` |
| Standard OPD consultation | `₹500` |
| Discount below threshold | `15%` |
| Discount above threshold | `35%` |
| Discount needing dual approval | `55%` |
| Critical potassium | `7.2 mEq/L` |
| Delta-check creatinine | `0.9` then `4.5 mg/dL` |
| Locked-day date | the 5th of the current month |
| Standard vitals | BP `128/84`, Pulse `82`, Temp `98.6°F`, SpO₂ `98%`, RR `16` |
| Abnormal vitals (sepsis) | BP `86/54`, Pulse `124`, Temp `103.2°F`, SpO₂ `89%`, RR `28` |

---

## Rules for test data

1. **DPDP:** every record here is synthetic. No real patient data ever enters a test system.
2. **Formats:** dates `DD/MM/YYYY` (en-IN), currency `₹` with Indian grouping
   (`₹1,25,000` not `₹125,000`), phones 10 digits without `+91`.
3. **Prefixes:** everything is prefixed `QA-` or `PT-QA-` so a stray row is identifiable at a
   glance and the seed guard can recognise its own data.
4. **If you need data that isn't here, add it to this file first**, then use it. Don't type
   an ad-hoc value into the app — the Playwright suite won't know about it and the test
   becomes unreproducible.

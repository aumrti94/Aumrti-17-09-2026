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

> ⚠️ **This table was a fourth catalogue and it had drifted.** It documented codes that do
> not exist (`FBS`, `PPBS`, `UREA`, `LIPID`, `URINE`, `BCULT`, `DENG`), a potassium panic
> pair of `<2.8 / >6.0` where the real one is `2.5 / 6.5`, and a sodium floor of `135`
> where the real one is `136` — while telling you never to invent test data. The whole
> point of `src/lib/labTestCatalog.ts` was to end exactly this. The rows below are now
> **derived from it**; if you need a test that is not listed, read the catalogue or
> `e2e/fixtures/mock-data.json` → `labTests` (194 tests), never invent one.

**Source of truth:** `src/lib/labTestCatalog.ts` → generated into `e2e/fixtures/mock-data.json`
and the `lab_test_catalog_default` seed. `npm run check:lab-catalog` fails CI if they drift.

| Test | Code | Category | Sample | Fee | Unit | Normal range | **Critical** | Auto-verify | TAT |
|---|---|---|---|---|---|---|---|---|---|
| Haemoglobin | `HB` | Haematology | EDTA Blood | `₹120` | g/dL | M 13.0–17.0 / F 12.0–15.0 | <7.0 / >20.0 | ✓ | 60 min |
| Total Leucocyte Count | `TLC` | Haematology | EDTA Blood | `₹120` | x10^3/µL | 4.0–11.0 | <2.0 / >30.0 | ✓ | 60 min |
| Platelet Count | `PLT` | Haematology | EDTA Blood | `₹130` | x10^3/µL | 150–400 | <50 / >1000 | ✓ | 60 min |
| Blood Sugar Fasting | `BSF` | Biochemistry | Fluoride Blood | `₹80` | mg/dL | 70–100 | <40 / >500 | ✓ | 60 min |
| Blood Sugar Post Prandial | `BSPP` | Biochemistry | Fluoride Blood | `₹80` | mg/dL | 70–140 | <40 / >500 | ✓ | 60 min |
| HbA1c | `HBA1C` | Biochemistry | EDTA Blood | `₹500` | % | 4.0–5.7 | — | ✗ | 240 min |
| Serum Creatinine | `CREAT` | Biochemistry | Serum | `₹150` | mg/dL | M 0.7–1.3 / F 0.6–1.1 | >5.0 | ✗ | 120 min |
| Blood Urea | `BU` | Biochemistry | Serum | `₹130` | mg/dL | 15–40 | >200 | ✗ | 120 min |
| **Serum Potassium** | `K` | Biochemistry | Serum | `₹150` | mEq/L | 3.5–5.0 | **<2.5 / >6.5** | ✗ | 60 min |
| Serum Sodium | `NA` | Biochemistry | Serum | `₹150` | mEq/L | 136–145 | <120 / >160 | ✗ | 60 min |
| Serum Lactate | `LACT` | Biochemistry | Fluoride Blood | `₹600` | mmol/L | 0.5–2.2 | >4.0 | ✗ | 60 min |
| Troponin I | `TROPI` | Cardiac Markers | Serum | `₹900` | ng/mL | 0.0–0.04 | >0.04 | ✗ | 60 min |
| TSH | `TSH` | Endocrinology | Serum | `₹300` | µIU/mL | 0.4–4.0 | <0.1 / >100.0 | ✗ | 240 min |
| Urine Routine & Microscopy | `URM` | Clinical Pathology | Urine | `₹150` | report | — | — | ✗ | 60 min |
| Dengue NS1 Antigen | `DNS1` | Serology | Serum | `₹800` | report | — | — | ✗ | 240 min |
| Blood Culture & Sensitivity | `BCUL` | Microbiology | Culture Bottle | `₹1,200` | report | — | — | ✗ | 4320 min |

> **CBC, LFT, KFT, Lipid Profile and Serum Electrolytes are GROUPS, not tests.** They used
> to be both — a single `unit: 'report'` row *and* a panel, at the same price — so a CBC
> came back as one unitless blob that no analyte inside could be flagged, delta-checked or
> auto-verified against, and it could be billed twice. The rows are retired (deactivated,
> not deleted); order them from the **Test Groups / Panels** tab. Prescribing "CBC" still
> works: `investigationSync` falls back to a group lookup by name.

> 🔴 **The critical column is not decoration — it is what makes critical-value alerting exist
> at all.** `LabResultWorkspace.calcFlag()` derives `CH`/`CL` from `critical_low`/`critical_high`
> **alone**, and only a `CH`/`CL` flag writes a `clinical_alerts` row or blocks release. A test
> seeded with a normal range but no critical range makes a potassium of 7.2 flag a harmless
> `"H"` — no alert, no block, released unchallenged, and every screen looking entirely normal.
> The seeder omitted these columns until Phase 5; if you are on an older seed, re-run
> `npm run qa:seed`.

> **Serum Potassium is the critical-value test.** Scenario **P5-S07** enters `7.2` and the
> alert must fire. The boundary pair is `5.0` (= `normal_max`, must flag `N`) and `5.1`
> (must flag `H`); the critical boundary is `6.5` (= `critical_high`, must flag **`H`** —
> `flagResult` compares strictly greater-than) and `6.6` (must flag `CH`).
>
> These boundaries were previously written as 5.1/5.2 and 6.0/6.1 against a potassium row
> that does not exist. A boundary case tested against the wrong number certifies nothing.
>
> **Serum Creatinine is the delta check** — `0.9`, then `4.5` on the same patient, a swing far
> past the hardcoded 50% threshold. `1.1` is the negative sibling that must **not** flag.

> **Auto-verify (`autoverify_eligible`) defaults to FALSE in the database.** Without the ✓ above
> being seeded, `evaluateAutoVerify` refuses every result at rule 1 — which looks identical to
> correct conservative behaviour while meaning P5-S09 is untestable.

**Lab test group:**

| Group | Fee | Members | Member sum |
|---|---|---|---|
| Fever Panel | `₹1,100` | CBC, Urine Routine, Dengue NS1 | ₹1,300 |

> ₹1,100 vs the ₹1,300 individual sum — the group price must win. That's **P5-S04**.
>
> **The members must exist as `lab_test_group_items` rows, not just as prose here.** A group
> with no member rows is a price with no contents: `fetchRates()` detects a covered group by
> checking every member is in the selection, so with zero members the group is never applied and
> every panel silently bills as the sum of its parts.

**Dual validation — `lab_dual_validation_config`:**

| Category | Requires two validators | Validator role |
|---|---|---|
| Biochemistry | ✓ | `doctor` |

> There is **no settings screen anywhere in the product** that writes this table; the seeder
> inserts the row directly. Only ONE category is seeded on purpose — `LabResultWorkspace` reads
> the config with `.some(...)`, so any dual-validation category flips the *whole order* into
> two-person mode, and seeding every category would mean no order in the tenant could ever take
> the single-validator path.

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

### Settings dropdown option lists

Exhaustive option lists for every settings dropdown/select/radio that offers a fixed, finite
set of choices — mirrored in `e2e/fixtures/mock-data.json` under `phase2.dropdowns`.

**Every value gets its own tracker row and its own Playwright test**, in the section that owns
the screen: ward types and bed statuses in `P2D.structure.wards.spec.ts`, the six Language &
Region controls in `P2B.identity.language.spec.ts`, all 23 dropdown categories in
`P2D.structure.config-values.spec.ts`. Same rule as drug routes and frequencies above — test
every value, not a sample. `BUG-P2-001` was a single missing option in a single dropdown, and
sampling would have walked straight past it.

**Ward Type — Settings → Wards & Beds:** `general` · `private` · `semi_private` · `icu` ·
`nicu` · `picu` · `hdu` · `surgical` · `maternity` · `emergency` · `daycare` (11 — the full
`ward_type` database enum)

> ✅ **Bed Status — `BUG-P2-001`, found and FIXED during Phase 2 authoring.** The `bed_status`
> enum has **5** values — `available` · `occupied` · `reserved` · `maintenance` · `cleaning` —
> but the per-bed Status dropdown in `SettingsWardsPage.tsx` rendered only 4 `<option>`
> elements and never offered `cleaning`, so a ward finishing terminal cleaning between
> patients had no correct status and staff marked the bed available while it was still dirty.
> `cleaning` is now offered, with its own colour so it reads distinctly from `reserved`.
> `occupied` remains present-but-disabled by design — a bed becomes occupied by admitting a
> patient, never by editing a dropdown. Locked by `TC-P2D-017` (all five values offered),
> `TC-P2D-018` (occupied not hand-selectable) and `TC-P2D-020` (`cleaning` persists).
>
> This is exactly the class of defect that sampling one dropdown value would have missed —
> which is why Phase 2 gives every option value its own case.

**Bed Category — Settings → Wards & Beds → Beds view:** `general` · `semi_private` ·
`private` · `icu` · `nicu` · `sicu` · `picu` · `hdu` · `isolation` (9 — free-text column, no
database enum)

**Language & Region — Settings → Language & Region** (✅ `BUG-P2-004`, found and FIXED during
Phase 2 authoring — every field below was enterable and selectable, the toast said saved, and
none of it survived a reload because the screen had no target table at all. It now persists to
`hospital_settings.language_region`. Locked by `TC-P2B-018`, and by one case per option value
at `TC-P2B-019` … `TC-P2B-040`):
- **Interface Language:** `English` · `Hindi (हिन्दी)` · `Telugu (తెలుగు)` ·
  `Tamil (தமிழ்)` · `Kannada (ಕನ್ನಡ)` · `Malayalam (മലയാളం)` · `Marathi (मराठी)` (7)
- **Date Format:** `DD/MM/YYYY` · `MM/DD/YYYY` · `YYYY-MM-DD` (3)
- **Time Format:** `12-hour (2:30 PM)` · `24-hour (14:30)` (2)
- **Currency:** `₹ Indian Rupee (INR)` · `AED (UAE)` · `USD` · `GBP` (4)
- **Timezone:** `Asia/Kolkata (IST)` · `Asia/Dubai (GST)` · `America/New_York (EST)` ·
  `Europe/London (GMT)` (4)
- **Number Format:** `Indian (1,00,000)` · `International (100,000)` (2)

**UHID Date Format — Settings → Hospital Profile:** `YYYYMMDD` (full date) · `YYYY` (year
only) · `NONE` (no date) (3) — changes the shape of every new patient UHID issued from the
moment it saves.

**Preferred Patient Languages — Settings → Hospital Profile:** `Hindi` · `Telugu` · `Tamil` ·
`Kannada` · `Marathi` · `Malayalam` · `Bengali` · `Gujarati` · `Odia` · `Punjabi` (10 —
`English` is always included and cannot be removed)

**Notification Channel — Settings → Notification Config, per alert type:** `In-App` ·
`WhatsApp` · `Both` (3) — ✅ `BUG-P2-003`, found and FIXED during Phase 2 authoring. The fields
were enterable but Save ran a fake 500ms `setTimeout` and wrote nothing. It now persists to
`hospital_settings.notification_config`; `notification_preferences` was rejected as the target
because it is per-**patient** channel booleans and cannot express a per-alert-type channel map.

**Scheduled Reports — Settings → Scheduled Reports:**
- **Report Type:** `Daily Executive Summary` · `Daily Collection Summary` ·
  `Weekly OPD Report` · `Weekly Outstanding Receivables` · `Monthly Revenue Report` ·
  `Monthly Revenue by Department` · `Monthly NABH Quality Report` · `Custom Report` (8)
- **Frequency:** `Daily` · `Weekly` · `Monthly` (3)
- **Format:** `PDF` · `Excel` · `Both` · `HTML (in email)` (4)

**Payment Gateway — Settings → Integrations Console:** `Razorpay` · `PayU` ·
`PhonePe for Business` · `CCAvenue` (4)

**Vitals Monitor Vendor — Settings → HL7/FHIR** (only visible once "Auto-populate ICU
Flowsheet from Bedside Monitors" is toggled on): `Mindray (BeneVision)` ·
`Philips IntelliVue` · `GE Healthcare` · `Dräger` · `Nihon Kohden` (5)

**Configurable Dropdown categories — Settings → Configurable Dropdowns:** 23 categories
across 6 groups (Clinical, HR & Payroll, Finance, Diagnostics, Operations, Structure) —
`admission_types` · `allergy_types` · `insurance_types` · `drug_routes` · `drug_frequencies` ·
`dialysis_complications` · `death_manner_types` · `record_requester_types` ·
`home_care_services` · `physio_modalities` · `leave_types` · `attendance_statuses` ·
`tpa_companies` · `government_schemes` · `claim_denial_categories` · `claim_rejection_codes` ·
`lab_test_categories` · `sample_types` · `housekeeping_task_types` ·
`housekeeping_area_types` · `equipment_categories` · `inventory_categories` ·
`department_types`. Each must be reachable via its `?cat=` deep link — `drug_routes` and
`drug_frequencies` are documented in full above; `lab_test_categories` in particular also
feeds the category filter on Settings → Lab Test Master, so a change here ripples into a
second screen.

---

## Phase 2 additions — rows you CREATE during Settings testing

Everything above this point is written by `scripts/qa-seed.mjs` before Phase 2 starts.
That matters: a Phase 2 "create" case that re-enters a seeded row will be rejected as a
duplicate, which looks like a product bug and is not one.

**So every create / edit / delete case in Phase 2 uses the rows below instead.** They are
chosen so each one also proves something downstream. Delete them at the end of the phase
(or re-run `npm run qa:seed`) so Phase 3 starts from the seeded baseline.

### New master rows

| Screen | Row to create | Deliberate property |
|---|---|---|
| Departments | `Nephrology` · `NEPH` · Clinical | Then re-enter `General Medicine` for the duplicate-name negative |
| Wards & Beds | `Nephrology Ward` · `general` · rate/day `₹3,500` · beds `NW-01`, `NW-02` | The `rate_per_day` → IPD room-charge hop. Also the "delete a ward that still has beds" negative |
| Shifts | `Night Relief` · `22:00`–`06:00` | Crosses midnight — the boundary case |
| Staff / Doctors | `Dr. Rakesh Iyer` · Nephrology · cons `₹900` · follow-up `₹400` · validity `5 days` · emergency `₹1,400` · IPD visit `₹700` | Creating a doctor must also create the `service_master` fee row |
| Service Rates | `Dialysis Catheter Insertion` · `PROC-DCI` · procedure · `₹4,500` · Exempt · HSN `999312` | Normal, complete row |
| Service Rates | `Physiotherapy Session (Home)` · `SERV-PHYH` · service · `₹800` · 18% · **HSN left blank** | The GST hard-block negative — once the hospital GSTIN is set, a bill carrying this line must refuse to finalise |
| Drug Formulary | `Nefrosave` · N-Acetylcysteine + Taurine · Tablet · 600mg · Schedule H · `₹210.00` · 12% | Drug created with **no batch** — must be invisible to the dispenser |
| Lab Test Master | `Serum Phosphorus` · `PHOS` · Serum · `₹220` · mg/dL · `2.5–4.5` · 120 min | Complete row |
| Lab Test Master | `Serum Magnesium` · `MG` · Serum · `₹240` · mg/dL · **normal range left blank** | No range → no abnormal flag and **no critical alert**. The negative that proves the range field matters |
| Lab Test Groups | `Renal Panel` · `₹650` · CREAT + UREA + K + PHOS | Individual sum is `₹750`; the group price must win |
| Radiology | Modality `Fluoroscopy` (`fluoro`), then study `Fluoroscopy Barium Swallow` · `₹2,800` | Create the **study first** to prove the "No studies configured" ordering trap, then do it correctly |
| Payer Masters | `Niva Bupa Health` · `tpa` · ceiling `₹4,500/day` · co-pay 15% · deductible `₹2,000` | A third distinct ceiling/co-pay combination |
| Config Values | Drug route `Nasogastric`; drug frequency `Q12H` | Must appear in the OPD Rx dropdowns immediately |
| ICD-10 Codes | `N18.5` — Chronic kidney disease, stage 5 | Searchable in the diagnosis picker |
| Day Care Procedures | `Haemodialysis Session (Day Care)` · `₹2,200` | Must appear in the day-care procedure picker |
| Bank Accounts | `Aarogya Ops — HDFC` · A/c `50100123456789` · IFSC `HDFC0001234` | IFSC format validation |
| Consent Forms | `Haemodialysis Consent` | Must appear in the procedure consent picker |
| Store Locations | `Nephrology Sub-Store` | Must appear as a transfer destination |
| Clinical Thresholds | Serum Potassium critical high `6.0` | Overrides the default — a lower critical bar than the seeded one |

### Edit targets

Edit these rather than the seeded rows, so a failed edit never corrupts the baseline:

| Screen | Change | Verify |
|---|---|---|
| Departments | `Nephrology` → `Nephrology & Dialysis` | `departments.name` changed in the DB, not just the toast |
| Wards | `Nephrology Ward` rate `₹3,500` → `₹4,200` | An admission created **after** the change bills `₹4,200`; one created before is unaffected |
| Service Rates | `PROC-DCI` `₹4,500` → `₹5,200` | New charges use `₹5,200`; already-raised charges do not retro-change |
| Payer Masters | `Niva Bupa Health` co-pay 15% → 25% | `payer_masters` row updated |

### Deliberately invalid input — for the validation negatives

Type these expecting rejection. If any is **accepted**, that is the defect.

| Field | Invalid value | Why |
|---|---|---|
| Hospital GSTIN | `36AAAAA0000A1Z` (14 chars) | GSTIN is exactly 15 characters |
| Hospital GSTIN | `36AAACT2727Q1ZX` with a wrong check digit | Format-valid, checksum-invalid |
| Pincode | `50003` (5 digits) | Indian pincodes are 6 digits |
| Phone | `987650000` (9 digits) / `98765000012` (11) | Both sides of the 10-digit boundary |
| IFSC | `HDFC001234` (10 chars) | IFSC is 11 characters, 5th char is `0` |
| HSN code | `99` | HSN is 4, 6 or 8 digits |
| GST percent | `-5` and `101` | Outside 0–100 |
| Ward rate/day | `-100` and `0` | A negative or zero room rate is never valid |
| Consultation fee | `abc` | Non-numeric into a money field |
| Bed number | `NW-01` (again, same ward) | Duplicate within a ward |
| Department code | `NEPH` (again) | Duplicate code |
| Staff email | `rakesh.iyer@` | Malformed |
| Shift times | start `22:00`, end `22:00` | Zero-length shift |
| Normal range | min `5.0`, max `2.0` | Min above max |
| Discount rule | approval threshold `120%` | Outside 0–100 |

> **₹ and dates:** every amount is typed as a plain number (`3500`, not `₹3,500`) but must
> *render* as `₹3,500.00` in `en-IN` grouping. Every date is entered and displayed as
> **DD/MM/YYYY**. A screen that renders `3,500.00` without the symbol, or `08/10/2026` as
> `10/08/2026`, is a defect — see `formatCurrency()` in `src/lib/currency.ts`.

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

## Phase 3 additions — rows you TYPE IN during Patient & Records testing

Everything in the table above (`PT-QA-0001` … `PT-QA-0040`) is seeded before Phase 3 starts
and is reused wherever a case just needs an **existing** record — `PT-QA-0002` for full-detail
edit/ABHA-linking cases, `PT-QA-0015` for the unknown/MLC patient, `PT-QA-0016`/`PT-QA-0017`
for the mother+newborn pair, `PT-QA-0029` for the pre-existing deliberate duplicate of
`PT-QA-0001`, `PT-QA-0030` for the Hospital-B cross-tenant probe.

**Cases that must create a brand-new record** (registration, kiosk, portal, ABHA linking,
edits) use `e2e/fixtures/mock-data.json`'s `phase3` block instead, so the manual case and its
Playwright twin type the same values:

| Block | Used for |
|---|---|
| `phase3.registration.full` | `TC-P3A-003` full-detail registration — Kavya Prasad |
| `phase3.registration.sameDaySecond` | `TC-P3A-005` UHID sequence — the second same-day registration |
| `phase3.registration.ageOnly` | `TC-P3A-015` age-only entry → computed DOB |
| `phase3.registration.cghs` | `TC-P3A-016` patient category reveals the CGHS Beneficiary No. field |
| `phase3.registration.aadhaar` | `TC-P3A-017` Aadhaar stored digits-only and masked |
| `phase3.registration.receptionistEntry` | `TC-P3A-019` a receptionist can register a patient |
| `phase3.registration.invalid` | The name/phone/DOB validation negatives and boundaries |
| `phase3.duplicate.probeName` / `probePhone` / `nearDuplicateName` | Section 3B — the de-dup gap cases |
| `phase3.emergency.*` | Section 3C — Emergency Registration complaint text |
| `phase3.newborn.fullName` | `TC-P3C-011` — the baby is registered as an ordinary new patient named "B/O Kavya Prasad" |
| `phase3.abha.sandboxValid` / `tooShort` | Section 3D — ABHA verify cases |
| `phase3.kiosk.*` | Section 3E — kiosk registration and wrong-OTP |
| `phase3.portal.*` | Section 3F — portal login emails and self-service create-profile |
| `phase3.edit.newPhone` / `invalidPhone` | Section 3G — edit + audit trail |
| `phase3.documents.sampleFileName` | Section 3I — document upload (the file bytes are generated in-spec, not stored here) |

Delete anything these cases create at the end of the phase (or re-run `npm run qa:seed`) so
Phase 4 starts from the seeded baseline.

---

## Phase 4 additions — rows you TYPE IN during OPD testing

**Phase 4 creates almost no new patients.** Every one of the 24 OPD scenarios reuses a seeded
`PT-QA-NNNN` record that is already tagged for it in the patients table above — that tagging was
done for exactly this phase. The map:

| Patient | Drives |
|---|---|
| `PT-QA-0001` Ramesh Kumar | the baseline walk-in, both follow-up windows, and the two-tokens-one-day scenario |
| `PT-QA-0003` Anitha Menon | the pre-booked appointment and the second-token collision check |
| `PT-QA-0004` Vinod Agarwal | TPA / Star Health payer capture |
| `PT-QA-0005` Lakshmi Devi | PMJAY beneficiary |
| `PT-QA-0006` R. Subramanian | CGHS **with** a referral letter — the bill must finalise |
| `PT-QA-0007` K. Venkatesan | CGHS **without** a referral — the bill must be hard-blocked |
| `PT-QA-0009` Baby Aarav Sharma | paediatric weight-based dosing (7.2 kg) |
| `PT-QA-0010` Krishnamurthy Iyer | polypharmacy interaction alert |
| `PT-QA-0011` Fatima Begum | the penicillin-allergy contraindication and its override |
| `PT-QA-0012` Deepa Nair | obstetric ultrasound → PCPNDT Form F |
| `PT-QA-0013` Ganesh Pawar | partial payment, leaves owing |
| `PT-QA-0014` Mohan Rao | the discount approval threshold, both sides and the boundary |
| `PT-QA-0021` Sarita Joshi | corporate-panel payer |
| `PT-QA-0032` Arun Prakash | MLC presenting at OPD, and the 10-year retention |
| `PT-QA-0036` Geetha Krishnan | physiotherapy referral |
| `PT-QA-0030` Rohan Kulkarni | Hospital-B cross-tenant probe |

The values a case actually **types** live in `e2e/fixtures/mock-data.json`'s `phase4` block, so
the manual case and its Playwright twin enter identical text:

| Block | Used for |
|---|---|
| `phase4.walkIn` | The one brand-new patient registered at the OPD desk (Ramanjaneyulu Gadde), plus the department/doctor names every flow selects |
| `phase4.invalid` | Section 4A's name / age / phone validation negatives |
| `phase4.consultation` | Complaint, HPI, examination, diagnosis and ICD-10 code (`J06.9`) typed in Sections 4E–4I |
| `phase4.prescription.primary` / `secondary` | Dolo 650 and Pan 40 — the ordinary prescription and the quantity-calculation cases |
| `phase4.prescription.ndps` | Morphine Sulphate — the NDPS dual-verification warning |
| `phase4.prescription.paediatric` | Crocin Syrup at 7.2 kg — weight-based dosing |
| `phase4.prescription.unknownDrug` | `Zzzmycin 999`, deliberately absent from `drug_master` |
| `phase4.drugSafety` | The allergy pair (generic **Amoxicillin** vs brand **Mox 500**), the combination brand, the safe alternative, the override reason and the interaction probe |
| `phase4.orders` | Lab tests, the deliberately misspelled `Compleet Blood Kount`, and the three USG names that decide whether a Form F fires |
| `phase4.payer` | CGHS/ECHS beneficiary numbers and the referring wellness centre |
| `phase4.money` | Partial payment ₹300, the discount reason, and the UPI reference |
| `phase4.followUp` | The day offsets that probe the validity window — 5, **7** (boundary), 8 and 12 |
| `phase4.mlc` | Police station and the assault complaint |
| `phase4.teleconsult` / `referral` / `sameDay` / `crossTenant` | Sections 4J, 4I, 4K and 4L respectively |

> **Vitals and discount percentages are NOT duplicated here.** They come from `commonValues`
> (`standardVitals`, `sepsisVitals`, `discountBelowThreshold`…) so one edit changes every phase
> that uses them.
>
> **The discount thresholds are read from the database, not from this book.** `DiscountTab`
> decides the tier with two conditions ANDed — `amount <= t1_amount && pct <= t1_pct` — so a
> percentage on its own does not tell you which tier it lands in. With the seeded t1 of
> ₹500 / 5%, a 15% discount is **not** free; it needs a billing executive. Section 4H therefore
> reads `hospital_settings.discount_approval_rules` and computes the percentages to test from it.

Delete anything these cases create (the one new patient, and every token, encounter,
prescription, order and bill) at the end of the phase, or re-run `npm run qa:seed`, so Phase 5
starts from the seeded baseline.

---

## Phase 5 additions — rows you TYPE IN during Lab & Radiology testing

**Phase 5 gives every case its own patient, and deletes nothing.** This is the one place the
program departs from the "reuse the seeded set" rule above, and the reason is worth reading before
you run the phase.

Phases 1–4 share `PT-QA-NNNN` records and clean up after themselves. Phase 5 cannot: its cases are
complete workflows whose whole subject is what PERSISTS. `TC-P5C-014` asserts that a patient's
first ever result has nothing to compare against, while `TC-P5C-011` asserts the same workflow on a
patient carrying a 30-day-old creatinine — under a shared patient both were true only because a
purge ran between them. And when a case does go red, the first question is "what does the chart
actually look like?", which a purge has already answered with nothing.

So each case provisions its own patient before it runs, and the run leaves every order, sample,
result, report and Form F in place:

| | |
|---|---|
| **UHID** | `PT-QA-<case>-<run>` — `TC-P5C-002` becomes `PT-QA-5C002-MKQ3X1` |
| **Name** | `<persona> <case>-<run>` — `Jyothi Gupta 5C002-MKQ3X1` |
| **Run tag** | Base36 minutes-since-epoch, one per `playwright test` process. It is in the name as well as the UHID because the collection workstation and radiology worklist match on name alone, and nothing is deleted — without it, a case would match its own order from the *previous* run |
| **Persona** | Deterministic from the case ID, so `TC-P5C-002` is the same person on every machine. Defined in [e2e/phase-05-lab-radiology/p5-personas.ts](../../e2e/phase-05-lab-radiology/p5-personas.ts) |
| **Clinical overrides** | The 5G Form F cases get a woman of childbearing age; `TC-P5G-003`/`014` get a man for the false-positive side; the 5C delta cases get a 62-year-old CKD adult. A statutory record raised on the wrong sort of patient would pass for the wrong reason |
| **Created by** | `ensureCasePatient()` in [p5-patients.ts](../../e2e/phase-05-lab-radiology/p5-patients.ts), through the service role, before the case's first click |
| **Deleted by** | Nothing. `npm run qa:seed` is the deliberate reset |

Set `QA_P5_RUN_TAG` to pin the tag — useful to re-enter the exact chart a failing run left behind,
or to watch a longitudinal history build up across runs.

**Five cases deliberately REUSE a seeded patient**, because their premise is someone who was
already there before the test opened. Creating a fresh patient would make them test something else:

| Patient | Reused by | Why it must be the existing record |
|---|---|---|
| `PT-QA-0018` Sharma Ji | `TC-P5A-009/010`, `TC-P5I-002…008`, `TC-P5I-011` | The ancillary charge has to accrue against a **live admission**. A fresh patient has no admission to accrue to, so the gate under test never engages |
| `PT-QA-0030` Rohan Kulkarni | `TC-P5K-012` | The Hospital-B record that must stay invisible to Hospital A. It is only ever read from |

The steps in [cases/phase-05-lab-radiology.csv](cases/phase-05-lab-radiology.csv) name each case's
own patient, generated from the same persona module the tests use — run
`npm run qa:p5:patients` after changing a persona, and `npm run qa:p5:patients:check` in CI to
catch the two drifting apart.

The values a case actually **types** live in `e2e/fixtures/mock-data.json`'s `phase5` block:

| Block | Used for |
|---|---|
| `phase5.labOrder` | Tests ordered, the Fever Panel and its two prices, the clinical note, and the deliberate misspelling `Seerum Potasium` |
| `phase5.results` | Every value typed into a result box — the critical `7.2`, both boundary pairs, the delta `0.9`/`4.5`/`1.1`, and the normal siblings |
| `phase5.sample` | The eight `SAMPLE_REJECTION_REASONS`, the haemolysis note, and the two-identifier check values |
| `phase5.amendment` | The wrong value, the corrected value and the amendment reason (P5-S11) |
| `phase5.dualValidation` | The Biochemistry category, the validator role and who signs each half |
| `phase5.externalReferral` | SRL Diagnostics — the reference lab, its contact details and the referred-out tests |
| `phase5.radiology` | Technique, findings, impression, the critical pneumothorax text, pregnancy status and the CT dose |
| `phase5.pcpndt` | Every Form F field — husband's name, LMP, gestational age, gravida/para, indication category, consent number, and the machine + doctor PCPNDT registrations |
| `phase5.aiImpression` | The edited impression that must be what reaches the report, and the attestation note |
| `phase5.ipdAncillary` | The admitted patient, both payment modes, the clinical override reason and the two toast strings that distinguish them |
| `phase5.money` / `phase5.crossTenant` | Payment references and the Hospital-B probe |

> **Critical ranges, categories and auto-verify flags are NOT in this block** — they belong to
> the `labTests` master above, because they are configuration the hospital sets once, not values
> a tester types.

> **The delta baseline is seeded, not typed.** A test cannot wait a month between two
> creatinines, so `seedPriorResult()` back-dates the 0.9 as a fixture. Everything the case
> actually asserts still goes through the browser — same precedent as Phase 4's `seedPriorVisit()`.

**Do not delete what these cases create.** The orders, samples, results, reports, Form F rows and
referrals are left in place on purpose — they are the evidence you open when a case goes red, and
three of the phase's findings (L1 "the result save is silently discarded", R1 "the report shell is
never created", L6 "an amendment overwrites the original") are questions about rows that should
still exist. A Form F additionally carries a `no_delete_pcpndt` policy, because the PCPNDT Act does
not permit the register to be edited away; test code that routinely deletes from it is modelling
something unlawful.

Each case owning its own patient is what makes this safe: no case can see another's work, so
nothing needs resetting between them. If you do want a clean tenant before Phase 6, reset it
deliberately with `npm run qa:seed`.

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

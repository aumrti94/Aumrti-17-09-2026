# Phase 0 — QA Environment & Master Data Setup

> **Goal:** stand up a safe, isolated QA hospital, enter every master that later journeys depend on, and create one login per role so we can test role-based access. This is also your first hands-on tour of Aumrti's Settings.
>
> **Companion tracker:** `Phase0_Tracker.xlsx` (Test Cases + auto-calc Summary + Defect Log). Fill the **Test Cases** sheet as you go; the Summary updates itself.
>
> **Golden rule:** *Settings before the module.* Nothing in later phases can be tested until the masters below exist.
>
> _Regenerated 2026-07-14 to match the current build — the onboarding wizard was shortened to **Branding → Go Live**, so **all master data is now entered via Settings**, not the wizard._

---

## 0. Before you start — read these findings from the current code

These are real behaviours found while reading the app. They shape how Phase 0 must be done:

1. **The admin email must be a real inbox.** Registration (`register-hospital`) sends an **email verification link** you must click before you can sign in. Use Gmail plus-addressing so every QA account lands in your one inbox:
   `yeswanthvarma94+qaadmin@gmail.com`, `+qadoctor`, `+qanurse`, etc. Gmail delivers all `+anything` to `yeswanthvarma94@gmail.com`.
2. **⚠️ Onboarding no longer collects masters.** The setup wizard now runs only **Branding → Go Live**. After Go-Live your hospital has **no departments, wards, doctors, drugs, fees, or payers** — you enter them all in **Settings** (Section B below). This is the biggest change from the previous build.
3. **Staff/doctors CANNOT log in by default.** Settings → Staff creates users with `can_login = false`. To get a working login you must, on each staff row, click **"Enable Login"** and set an email + password (this calls `create-staff-login`). *Section C does this per role.*
4. **Set lab-test prices when you create them.** Lab tests carry a price/fee field in Settings → Lab Tests — enter a non-zero fee so lab billing works later.
5. **A guided "tour" (Joyride) may pop up** the first time you open certain pages (driven by `platform_onboarding_tours`). Completing or skipping it is itself a test — see TC-E09.

Keep the **browser console open (F12 → Console)** for every test so you can paste any red error into the tracker's *Console Error* column.

---

## A. Create the QA hospital tenant (safest environment)

We use a **dedicated hospital tenant** so QA data never mixes with real data (multi-tenancy isolates it by `hospital_id`).

**Steps:** open the app → `/register` → complete the 5-step wizard with the mock data below → click the email verification link → you land in the (now short) Onboarding Wizard → **Branding → Go Live**.

### Mock data — Registration (QA Tenant #1)

| Step | Field | Value |
|---|---|---|
| 1 Hospital Identity | Hospital Name | `Aumrti QA Hospital` |
| | Hospital Type | `Private Hospital` |
| | State | `Telangana` |
| | Approximate Bed Count | `51–100 beds` |
| | Your Mobile Number | `9000000001` (OTP only if platform toggle is on) |
| 2 Admin Account | Full Name | `Dr QA Admin` |
| | Work Email | `yeswanthvarma94+qaadmin@gmail.com` |
| | Password | `QaAdmin@2026` |
| | Designation | `Hospital Administrator` |
| | Referral Code | leave blank (or try `TESTREF` to see the soft-validation message — it never blocks Next) |
| 3 Hospital Details | Address Line 1 | `Plot 1, Test Layout` |
| | Pincode | `500001` |
| | City / District | `Hyderabad` |
| | GSTIN | `36AABCU9603R1ZX` (15 chars — used later for GST tests) |
| | NABH Accredited | On → Number `NABH-QA-0001` |
| 4 Choose Plan | Plan | pick the plan with the **most modules** (Enterprise if shown). Click **"View features"** to open the details modal. *Enterprise opens a "Contact Sales" lead form — for QA pick a non-Enterprise plan, or fill the lead form and pick another.* |
| 5 Confirm | Terms + DPDP consent | **both ticked** (registration is blocked without them) |

> After "Launch", check the inbox for `yeswanthvarma94+qaadmin@gmail.com`, click the verification link → it opens Aumrti at `/setup/onboarding`. Do **Branding** (upload any logo, optional) → **Go Live** → you land on `/dashboard`.

### Negative / feature checks to log while here (see tracker TC-A rows)
- Weak password `abc` → blocked (needs 8+ chars, a letter and a number).
- Invalid email `abc@x` → inline "Enter a valid email".
- GSTIN `123` → "must be 15 alphanumeric characters".
- Pincode `4000` → "must be 6 digits".
- Leaving Terms/DPDP unticked → Launch stays disabled.
- Re-register the **same admin email** → "already registered".
- Referral code: type any code → a soft green/amber message appears, **Next never blocked**.
- Open `/register?ref=TESTREF` → the referral field is **pre-filled** with `TESTREF`.

### QA Tenant #2 (for the Phase 12 multi-tenancy test — create now, set aside)
Repeat registration with: Hospital `Aumrti QA Hospital TWO`, admin `yeswanthvarma94+qaadmin2@gmail.com`, password `QaAdmin2@2026`. Add just **1 patient** later so we can prove Tenant #1 can't see Tenant #2's data. Then leave it alone.

---

## B. Enter the masters — via **Settings** (do these in order)

> Since onboarding no longer collects these, go to **Settings** (gear icon) and enter each master. Do them top-to-bottom because later ones depend on earlier ones (doctors need departments; fees attach to doctors; etc.).

### B1. Settings → Departments
- Core departments are pre-checked (**General Medicine, General Surgery, Emergency / Casualty**). Tick the extras we need for later phases: `Paediatrics`, `Gynaecology & Obstetrics`, `Orthopaedics`, `Radiology`, `Pathology / Lab`, `Pharmacy`, `Blood Bank`, `Dialysis`, `Dental`, `Physiotherapy`, `ICU / Critical Care`. Add 1 custom: `Test Department`.
- **New feature to test:** the blue **"Departments for the modules you run"** panel suggests departments derived from your enabled modules. Tick a couple of its suggestions and use its **Add Selected Departments** button — confirm they're created and move to "Already set up".
- Negative: try adding a department that already exists → duplicate is prevented.

### B2. Settings → Wards (& Beds)
Add these wards; after saving, confirm **beds are auto-created** (or add beds if the page requires it):

| Ward Name | Type | Beds | Rate/Day ₹ |
|---|---|---|---|
| General Ward | General | 20 | 500 |
| Private Rooms | Private | 10 | 2000 |
| ICU | ICU | 6 | 5000 |

*Verify: beds like GEN-01…, PVT-101…, ICU-01… exist and show status "available".*

### B3. Settings → Shifts
Confirm/keep default shifts (Morning / Evening / Night). These feed nurse rostering later.

### B4. Settings → Doctors & Staff  *(covers doctors, staff, and consultation fees)*
Add doctors (department + consultation fee → this creates their billable consultation service):

| Full Name | Role | Department | Reg. No | Phone | Consultation ₹ | Follow-up ₹ |
|---|---|---|---|---|---|---|
| Dr Anil Rao | Doctor | General Medicine | TS-1001 | 9000000010 | 500 | 200 |
| Dr Sunita Menon | Doctor | Gynaecology & Obstetrics | TS-1002 | 9000000011 | 600 | 300 |
| Dr Kiran Das | Doctor | Orthopaedics | TS-1003 | 9000000012 | 500 | 250 |

Add the rest of the care team (login enabled in Section C):

| Full Name | Role | Email | Phone |
|---|---|---|---|
| Nurse Latha | Nurse | `yeswanthvarma94+qanurse@gmail.com` | 9000000020 |
| Reception Ravi | Receptionist | `yeswanthvarma94+qarecep@gmail.com` | 9000000021 |
| Pharma Suresh | Pharmacist | `yeswanthvarma94+qapharma@gmail.com` | 9000000022 |
| Lab Tech Geeta | Lab Technician | `yeswanthvarma94+qalab@gmail.com` | 9000000023 |
| Accountant Mohan | Accountant | `yeswanthvarma94+qaacct@gmail.com` | 9000000024 |
| HR Priya | HR Manager | `yeswanthvarma94+qahr@gmail.com` | 9000000025 |

> ⚠️ These can't log in yet — Section C fixes that. Also note the *"No doctors added yet — OPD/IPD blocked"* banner disappears once ≥1 doctor exists.

### B5. Settings → Services  *(procedures & other charge items, GST)*
Confirm the consultation services from B4 are listed. Add a few procedure services and keep **GST toggle OFF** for now (GST is turned on in Phase 7):

| Service | Category | Fee ₹ | GST |
|---|---|---|---|
| ECG | Procedure | 150 | off |
| X-Ray Chest | Procedure | 200 | off |
| Dressing | Procedure | 100 | off |
| IV Drip Setup | Procedure | 200 | off |
| Nebulization | Procedure | 100 | off |

### B6. Settings → Payer Masters
Add: **1 TPA** (Star Health), **PMJAY / Ayushman Bharat**, **CGHS**, and **1 Corporate** `Test Corp Ltd` (credit limit `100000`). These appear as payer options in Billing/Insurance/PMJAY.

### B7. Settings → Lab Tests  &  Settings → Radiology
- **Lab Tests:** add the common set with **non-zero prices**, e.g. CBC ₹300, LFT ₹600, RFT ₹600, Lipid ₹700, TSH ₹450, Blood Sugar Fasting ₹80, HbA1c ₹500, Urine Routine ₹150, Blood Group ₹100.
- **Radiology:** enable modalities with rates — X-Ray ₹200, USG ₹500, ECG ₹150, CT Scan ₹3500.

### B8. Settings → Doctor Schedules
Give Dr Anil Rao Mon–Sat morning OPD slots so he's bookable in Phase 2.

### B9. Settings → Drugs (Drug Master)
Add each drug (this drives Pharmacy dispense + NDPS dual sign-off in Phase 3):

| Drug Name | Generic | Category | Routes | Drug Schedule |
|---|---|---|---|---|
| Paracetamol 500mg | Acetaminophen | Analgesic | oral | None / OTC |
| Amoxicillin 500mg | Amoxicillin | Antibiotic | oral | Schedule H |
| Azithromycin 500mg | Azithromycin | Antibiotic | oral | Schedule H |
| Pantoprazole 40mg | Pantoprazole | PPI | oral, IV | Schedule H |
| Amlodipine 5mg | Amlodipine | Antihypertensive | oral | Schedule H |
| Metformin 500mg | Metformin | Antidiabetic | oral | Schedule H |
| Ondansetron 4mg | Ondansetron | Antiemetic | oral, IV | Schedule H |
| Alprazolam 0.5mg | Alprazolam | Anxiolytic | oral | Schedule H1 |
| Morphine 10mg | Morphine | Opioid analgesic | IV | Schedule X (Narcotic) |
| Diazepam 5mg | Diazepam | Sedative | oral, IV | Schedule H1 |
| Insulin Regular | Insulin | Antidiabetic | subcut | Schedule H |
| Ceftriaxone 1g | Ceftriaxone | Antibiotic | IV | Schedule H |
| Diclofenac 50mg | Diclofenac | NSAID | oral | Schedule H |
| ORS Sachet | ORS | Electrolyte | oral | None / OTC |
| Cough Syrup | Dextromethorphan | Antitussive | oral | Schedule H |

> Verify: **Morphine** shows the red 🔒 **NDPS** badge (Schedule X auto-flags `is_ndps`). Negative: add `Paracetamol 500mg` again → "already exists".

---

## C. Create one LOGIN per role (required for role-based-access testing)

For each staff/doctor row: `Settings → Doctors & Staff` → find the row → click **"Enable Login"** → set the email (use the `+qa…@gmail.com` below) and a password → Save. Keep **MFA Off** for QA simplicity.

| Person | Role | Login email | Password |
|---|---|---|---|
| Dr QA Admin | hospital_admin | yeswanthvarma94+qaadmin@gmail.com | QaAdmin@2026 |
| Dr Anil Rao | doctor | yeswanthvarma94+qadoctor@gmail.com | QaDoc@2026 |
| Nurse Latha | nurse | yeswanthvarma94+qanurse@gmail.com | QaNurse@2026 |
| Reception Ravi | receptionist | yeswanthvarma94+qarecep@gmail.com | QaRecep@2026 |
| Pharma Suresh | pharmacist | yeswanthvarma94+qapharma@gmail.com | QaPharma@2026 |
| Lab Tech Geeta | lab_technician | yeswanthvarma94+qalab@gmail.com | QaLab@2026 |
| Accountant Mohan | accountant | yeswanthvarma94+qaacct@gmail.com | QaAcct@2026 |
| HR Priya | hr_manager | yeswanthvarma94+qahr@gmail.com | QaHr@2026 |

> **Role-enum note (real finding):** the user role list is a fixed Postgres enum of 14 roles: `super_admin, hospital_admin, doctor, nurse, receptionist, pharmacist, lab_tech, lab_technician, radiologist, accountant, billing_executive, billing_staff, hr_manager, cfo`. Roles referenced in routing but **not** in this enum — `insurance_executive`, `quality_officer`, `quality_manager`, `nursing_supervisor` — cannot be assigned to a staff member. Those routes are tested as `hospital_admin` (or via custom `role_permissions`) in later phases. **Log this as a finding** if you consider it a gap.

---

## D. Baseline role-based-access (RBAC) check

Log in as each role (incognito windows help) and confirm nav + access:

- **Positive:** each role reaches its allowed area (doctor → `/opd`, nurse → `/nursing`, receptionist → `/patients`, pharmacist → `/pharmacy`, lab → `/lab`, accountant → `/billing` & `/accounts`, HR → `/hr`).
- **Negative (the important part):** a role hitting a route it shouldn't is **blocked/redirected** — type the URL directly:
  - Nurse → `/settings` → blocked (admin-only).
  - Receptionist → `/accounts` → blocked.
  - Lab Tech → `/hr` → blocked.
  - Pharmacist → `/settings/staff` → blocked.
- **Admin bypass:** `hospital_admin` reaches everything.

Record each as a separate RBAC row (Test Type = RBAC) in the tracker.

---

## Exit criteria for Phase 0 (all must be true to advance to Phase 1)
- ✅ QA Tenant #1 live; admin logs in after email verification; Branding→Go-Live done. QA Tenant #2 exists.
- ✅ Via Settings: departments, wards+beds, shifts, doctors+staff, consultation+procedure services, payers, lab tests (priced), radiology modalities, doctor schedules, drugs — all saved and visible.
- ✅ One working login per role (Section C); MFA off.
- ✅ RBAC baseline: every negative access attempt is blocked; admin reaches all.
- ✅ All P0/P1 defects from Phase 0 fixed; Summary shows **0 open P0/P1**.
- ✅ Coverage Ledger rows for Phase 0 marked Tested = Y.

When these are green, we generate **Phase 1 (Patient Registration & Front Office)**.

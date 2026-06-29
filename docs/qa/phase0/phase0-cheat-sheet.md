# Phase 0 — Test Data Cheat Sheet

> **This file is itself a Phase-0 exit criterion** (`TESTING_PHASES.md`: *"a written test data cheat sheet — which patient is for which scenario"*).
> Every later phase reuses this exact dataset. **Never test on a blank database.**
>
> **Owners:** authored by **Meghana** (QA), data realism by **Meera** (DB) + **Priya** (clinical) + **Ravi** (billing), DPDP gate by **Ananya**, signed off by **Sunita**.

---

## ⚠️ DPDP / data rules (Ananya gate — non-negotiable)

- **100% synthetic.** No real patient PHI anywhere — not in cases, fixtures, or screenshots.
- All patient IDs are prefixed `PT-MOCK-####`. All hospitals/logins are `…@test-a` / `…@test-b`.
- Indian conventions: dates **DD/MM/YYYY (en-IN)**, currency **₹**, **ABHA-format** IDs (`14-digit` / `abc@abdm`).
- These emails/passwords are for **non-production test tenants only**. Rotate before any public exposure.

---

## 1. The two test hospitals (for isolation — the Golden Rule)

| Field | **Hospital A** | **Hospital B** |
|---|---|---|
| Purpose | Primary tenant (paid plan) | Isolation counterpart (trial plan) |
| Name | Aarogya Multispecialty Hospital | Sanjeevani General Hospital |
| Type (UI) | Private Hospital | Trust / NGO Hospital |
| Mapped `type` enum | general | general |
| State | Telangana | Maharashtra |
| City | Hyderabad | Pune |
| Beds (UI band → count) | `101_200` → 150 | `51_100` → 75 |
| Address 1 | Plot 14, Jubilee Hills | 22 FC Road, Shivajinagar |
| Address 2 | Road No. 36 | — |
| Pincode | 500033 | 411005 |
| GSTIN (15-char) | `36AABCA1234F1Z5` | `27AABTS5678K1Z9` |
| NABH No. | `NABH-TS-AARO-2026` | `NABH-MH-SANJ-2026` |
| Website | https://aarogya-test.example.in | https://sanjeevani-test.example.in |
| **Plan slug** | `professional` (paid) | `starter` (trial) |
| Admin name | Dr. Suresh Reddy | Mrs. Kavita Joshi |
| Admin designation | Medical Director | Hospital Administrator |
| Admin email (super_admin) | `admin@test-a.aumrti.in` | `admin@test-b.aumrti.in` |
| Admin phone | `9876500011` | `9876500022` |
| Admin password | `Aarogya@2026` | `Sanjeev@2026` |

> Plans deliberately differ (paid vs trial) so **Phase 17** (subscription/feature-gating) can reuse the same two tenants.

---

## 2. Role logins (one per role, per hospital)

**Email convention:** `<role>@test-a.aumrti.in` and `<role>@test-b.aumrti.in`
**Staff password (all roles):** `TestPass@2026` *(13 chars, has letters + digit — satisfies the ≥8-char rule in `create-staff-login`)*
**Admin/super_admin passwords:** as in the hospital table above.

| # | Role (`app_role`) | Enum-confirmed? | Email (Hospital A) | Landing route after login |
|---|---|---|---|---|
| 1 | `super_admin` | ✅ | `admin@test-a.aumrti.in` | `/platform` |
| 2 | `hospital_admin` | ✅ | `hospitaladmin@test-a.aumrti.in` | `/dashboard` |
| 3 | `doctor` | ✅ | `doctor@test-a.aumrti.in` | `/opd` |
| 4 | `nurse` | ✅ | `nurse@test-a.aumrti.in` | `/nursing` |
| 5 | `receptionist` | ✅ | `reception@test-a.aumrti.in` | `/opd` |
| 6 | `pharmacist` | ✅ | `pharmacist@test-a.aumrti.in` | `/pharmacy` |
| 7 | `lab_tech` | ✅ | `labtech@test-a.aumrti.in` | `/lab` |
| 8 | `lab_technician` | ✅ | `labtechnician@test-a.aumrti.in` | `/lab` |
| 9 | `radiologist` | ✅ | `radiologist@test-a.aumrti.in` | `/radiology` |
| 10 | `accountant` | ✅ | `accountant@test-a.aumrti.in` | `/billing` |
| 11 | `billing_executive` | ✅ | `billing@test-a.aumrti.in` | `/billing` |
| 12 | `billing_staff` | ✅ | `billingstaff@test-a.aumrti.in` | `/billing` |
| 13 | `cfo` | ✅ | `cfo@test-a.aumrti.in` | `/accounts` |
| 14 | `hr_manager` | ✅ | `hr@test-a.aumrti.in` | `/hr` |
| 15 | `mrd_officer` | ✅ | `mrd@test-a.aumrti.in` | `/mrd` (else `/dashboard`) — **verify** |
| 16 | `insurance_executive` | ✅ | `insurance@test-a.aumrti.in` | `/insurance` (else `/dashboard`) — **verify** |
| 17 | `quality_officer` | ⚠️ used in `routeRoles.ts`, **not** in `app_role` enum — **verify before creating** | `quality@test-a.aumrti.in` | `/quality/events` (else `/dashboard`) |
| 18 | `quality_manager` | ⚠️ used in `routeRoles.ts`, **not** in `app_role` enum — **verify before creating** | `qualitymgr@test-a.aumrti.in` | `/dashboard` |

> Repeat rows 2–18 for Hospital B with `@test-b.aumrti.in`. (`super_admin` is platform-wide — one shared vendor login; each tenant still gets its own `hospital_admin`.)
>
> **Flag (Meera/Nikhil):** rows 17–18 (`quality_officer`, `quality_manager`) appear in `src/lib/routeRoles.ts` but are **not** in the `public.app_role` enum (migrations `20260321162749`, `20260517000003`, `20260518000004`). Creating them may fail the enum check — `P0-STAFF-017` is the test that proves/disproves this. If they're not valid enum values, map quality staff to `hospital_admin` and raise a bug.

---

## 3. The 30 synthetic patients

**UHID/MRN convention:** `PT-MOCK-0001` … `PT-MOCK-0030`. **ABHA-format** when present (`14-digit` or `handle@abdm`).
Most patients belong to **Hospital A**; `PT-MOCK-0030` belongs to **Hospital B** (for the isolation negative tests). `PT-MOCK-0029` is a deliberate duplicate of `PT-MOCK-0006` for the de-dup negative test.

| MRN | Name | DOB (DD/MM/YYYY) | Age | Gender | ABHA | Allergy | Insurance type | Scenario tag → phase that consumes it |
|---|---|---|---|---|---|---|---|---|
| PT-MOCK-0001 | Baby of Lakshmi Devi | 20/06/2026 | 4 days | Female | No | None | self_pay | Newborn → Phase 14 vaccination (NIS birth doses) |
| PT-MOCK-0002 | Aarav Nair | 15/03/2025 | 1 yr | Male | No | None | self_pay | Infant → Phase 14 vaccination |
| PT-MOCK-0003 | Diya Patel | 10/01/2021 | 5 yr | Female | No | None | self_pay | Child → Phase 14 NIS schedule + Phase 3 OPD paeds |
| PT-MOCK-0004 | Sunita Sharma | 12/08/1994 | 31 yr | Female | Yes `91-2345-6789-0001` | None | pmjay | **Pregnant** → Phase 5 PCPNDT Form-F, Phase 8 maternity |
| PT-MOCK-0005 | Ramesh Gupta | 05/05/1952 | 74 yr | Male | Yes `91-2345-6789-0002` | None | cghs | Elderly diabetic/HTN → Phase 14 chronic-disease, Phase 7 IPD |
| PT-MOCK-0006 | Mohammed Iqbal | 22/11/1988 | 37 yr | Male | No | **Penicillin** | private | **Allergy case** → Phase 6 pharmacy allergy warning |
| PT-MOCK-0007 | Anjali Desai | 30/09/1970 | 55 yr | Female | Yes `91-2345-6789-0003` | None | self_pay | **Oncology / NDPS** (morphine for cancer pain) → Phase 6 NDPS dual sign-off, Phase 14 oncology |
| PT-MOCK-0008 | Karthik Reddy | 18/07/1990 | 35 yr | Male | No | None | pmjay | **PMJAY beneficiary** (PMJAY ID `PMJAY-TS-0008`) → Phase 11 |
| PT-MOCK-0009 | Vijay Menon | 03/02/1965 | 61 yr | Male | Yes `91-2345-6789-0004` | Sulfa | cghs | **CGHS beneficiary** (`CGHS-0009`) → Phase 11 |
| PT-MOCK-0010 | Brig. R. Singh (Retd) | 25/12/1958 | 67 yr | Male | No | None | echs | **ECHS beneficiary** (`ECHS-0010`) → Phase 11 |
| PT-MOCK-0011 | Pooja Agarwal | 14/06/1985 | 40 yr | Female | Yes `91-2345-6789-0005` | None | private | **Private insurance** (Star Health `SH-0011`) → Phase 11 cashless |
| PT-MOCK-0012 | Suresh Yadav | 09/09/1979 | 46 yr | Male | No | None | self_pay | **Cash/self-pay** → Phase 10 billing baseline |
| PT-MOCK-0013 | Meera Krishnan | 21/04/1992 | 34 yr | Female | Yes `meera.k@abdm` (verified) | None | self_pay | **ABHA verified** → Phase 2 ABDM link/care-context |
| PT-MOCK-0014 | Rahul Verma | 11/11/1983 | 42 yr | Male | No | None | self_pay | **No ABHA** → Phase 2 register-without-ABHA path |
| PT-MOCK-0015 | Anonymous / Other | 01/01/2000 | 26 yr | Other | No | None | self_pay | **Gender = other** → Phase 2 form validation |
| PT-MOCK-0016 | Unknown Male (MLC) | est. 1990 | ~35 | Male | No | Unknown | self_pay | **Unknown/MLC trauma** → Phase 8 Emergency MLC mandatory fields |
| PT-MOCK-0017 | Govind Rao | 17/03/1968 | 58 yr | Male | Yes `91-2345-6789-0006` | None | pmjay | **Dialysis** patient → Phase 14 dialysis sessions |
| PT-MOCK-0018 | Latha Subramaniam | 08/08/1974 | 51 yr | Female | Yes `91-2345-6789-0007` | None | private | **Oncology protocol** (chemo cycle) → Phase 14 |
| PT-MOCK-0019 | Neha & Amit Kapoor | 02/02/1991 | 35 yr | Female | Yes `91-2345-6789-0008` | None | self_pay | **IVF cycle** → Phase 14 IVF |
| PT-MOCK-0020 | Sanjay Pillai | 19/05/1987 | 39 yr | Male | No | None | self_pay | **Mental health** → Phase 14 mental-health |
| PT-MOCK-0021 | Kavya Joshi | 27/10/2002 | 23 yr | Female | No | None | self_pay | **Dental** → Phase 14 dental |
| PT-MOCK-0022 | Deepak Chauhan | 06/06/1995 | 31 yr | Male | No | None | self_pay | **Physio** → Phase 14 physio |
| PT-MOCK-0023 | Radha Bai | 13/07/1949 | 76 yr | Female | No | None | pmjay | **AYUSH** → Phase 14 ayush |
| PT-MOCK-0024 | Priyanka Saxena | 16/02/1996 | 30 yr | Female | Yes `91-2345-6789-0009` | None | private | **Maternity/delivery** → Phase 8 OT C-section |
| PT-MOCK-0025 | Arun Kumar | 23/01/1960 | 66 yr | Male | Yes `91-2345-6789-0010` | None | cghs | **ICU/critical** → Phase 7 IPD ICU, NEWS2 |
| PT-MOCK-0026 | Shalini Rao | 04/04/1989 | 37 yr | Female | No | None | self_pay | **Day-care surgery** → Phase 7 day-care |
| PT-MOCK-0027 | Imran Khan | 29/08/1976 | 49 yr | Male | No | None | self_pay | **Lab-heavy** (multiple panels) → Phase 4 lab |
| PT-MOCK-0028 | Geeta Iyer | 31/12/1981 | 44 yr | Female | Yes `91-2345-6789-0011` | None | private | **Radiology** (USG/CT) → Phase 5 |
| PT-MOCK-0029 | Mohammed Iqbal | 22/11/1988 | 37 yr | Male | No | Penicillin | private | **Duplicate of 0006** (same name+phone+DOB) → Phase 2 de-dup NEGATIVE test |
| PT-MOCK-0030 | Sanjeevani Patient One | 10/10/1980 | 45 yr | Male | No | None | self_pay | **Hospital B patient** → Phase 0/1 cross-tenant isolation NEGATIVE test |

**Shared mock phone numbers** (Indian 10-digit, `6-9` start): patients use `98765-1XXXX` where `XXXX` = MRN suffix, e.g. `PT-MOCK-0006` → `9876510006`. `PT-MOCK-0029` reuses `9876510006` (duplicate test).

### Quick "which patient for which scenario" index
- **PCPNDT / pregnancy:** 0004, 0024
- **Allergy warning:** 0006 (Penicillin), 0009 (Sulfa)
- **NDPS / controlled drug:** 0007
- **Insurance schemes:** PMJAY 0008, CGHS 0009, ECHS 0010, Private 0011, Self-pay 0012
- **ABHA with / without:** with → 0013; without → 0014
- **Emergency MLC:** 0016
- **Specialties:** dialysis 0017, oncology 0018, IVF 0019, mental-health 0020, dental 0021, physio 0022, ayush 0023
- **Negative-test patients:** duplicate 0029, cross-tenant 0030

---

## 4. Service rates & GST (so billing has prices in later phases)

Seed at least these in **`service_master`** for **both** hospitals (Ravi):

| Service | category | fee (₹) | gst_percent | hsn_code | item_type |
|---|---|---|---|---|---|
| General OPD Consultation | consultation | 500.00 | 0 | 999312 | service |
| Specialist Consultation | consultation | 800.00 | 0 | 999312 | service |
| CBC (Complete Blood Count) | lab | 350.00 | 0 | 999316 | service |
| Lipid Profile | lab | 700.00 | 0 | 999316 | service |
| USG Abdomen | radiology | 1200.00 | 0 | 999316 | service |
| CT Brain Plain | radiology | 3500.00 | 0 | 999316 | service |
| Minor OT Procedure | procedure | 2500.00 | 0 | 999319 | service |
| Paracetamol 500mg (tab) | pharmacy | 2.00 | 12 | 30049099 | drug |
| Surgical Gloves (pair) | consumable | 15.00 | 12 | 40151900 | consumable |

> Healthcare *services* are largely GST-exempt (0%); *drugs/consumables* carry GST (5/12/18%). HSN/SAC codes above are realistic placeholders — confirm per item before go-live.

---

## 5. Phase-0 "DONE" checklist (Sunita sign-off)

- [ ] Hospital A registered (paid plan) — `hospitals` + `super_admin` user + trial/subscription rows verified in Supabase.
- [ ] Hospital B registered (trial plan) — same verification.
- [ ] All role logins created on **both** hospitals; each logs in and lands on the correct route.
- [ ] Catalogs seeded per hospital: drugs, pharmacy batches, dashboard data, chart-of-accounts/lab defaults, TPA/AI/prompt defaults.
- [ ] 30 patients loaded with the variety above; DPDP `consent_records` present.
- [ ] Service rates + GST present for both hospitals.
- [ ] Cross-hospital isolation baseline passes (`npm run test:security` green; A cannot see B).
- [ ] This cheat sheet is complete and committed.

> Once all boxes are ticked, Phase 1 (Identity, Tenancy & Access Control) may begin. **Until then, no later phase is unblocked.**

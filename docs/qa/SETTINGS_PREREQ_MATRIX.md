# Settings Prerequisite Matrix

**Read this before touching any module.**

This application fails **silently** when configuration is missing. It doesn't warn you — it
falls back to a hardcoded default, renders an empty dropdown, or quietly drops your data.
Most "bugs" you'd find by testing a module before configuring it are not bugs at all.

Every row below was traced in the code. The "symptom" column is what actually happens, not
what should happen.

---

## Tier 0 — nothing works without these

Configure these first, in this order. They are Phase 1 and the start of Phase 2.

| # | What | Screen | Writes to | Why it's first |
|---|---|---|---|---|
| 1 | Hospital profile & branding | [SettingsProfilePage](../../src/pages/settings/SettingsProfilePage.tsx), [SettingsBrandingPage](../../src/pages/settings/SettingsBrandingPage.tsx) | `hospitals` | Name, address and **GSTIN** appear on every print. Setting a GSTIN turns on the HSN hard-block at bill finalisation |
| 2 | Departments | [SettingsDepartmentsPage](../../src/pages/settings/SettingsDepartmentsPage.tsx) | `departments` | No departments → no OPD token can be created, no doctor can be assigned |
| 3 | Staff & doctors | [SettingsStaffPage](../../src/pages/settings/SettingsStaffPage.tsx) | `users`, `staff_profiles` | **`users.hospital_id` is the RLS anchor.** Everything a user can see depends on this row |
| 4 | Roles & permissions | [SettingsRolesPage](../../src/pages/settings/SettingsRolesPage.tsx) | `role_permissions` | Controls `hasTabAccess` / `hasActionAccess`. Wrong here and buttons like *Complete & Bill* or *Admit* simply don't render |
| 5 | Plan & subscription | [SettingsPlanPage](../../src/pages/settings/SettingsPlanPage.tsx) | `hospital_subscriptions`, `plan_features`, `hospital_addons` | Determines which modules exist at all. Whole sections of the app disappear |

> **If a screen is blank or a button is missing, check Tier 0 before logging a bug.** Four
> gates stack on every screen — auth, plan, role, and per-action permission.

---

## Tier 1 — per-module prerequisites

Organised by the module you're about to test. Configure the whole row before you start.

### OPD — Phase 4

| Must exist | Screen | Symptom if missing |
|---|---|---|
| `service_master` consultation rows (fee, `follow_up_fee`, `validity_days`, `emergency_fee`, `ipd_consultation_fee`) | [SettingsServicesPage](../../src/pages/settings/SettingsServicesPage.tsx) | **Silently bills a hardcoded ₹500.** No warning. The fee lookup falls back doctor → department → global → ₹500 |
| `hospital_config_values` — `drug_routes`, `drug_frequencies` | [SettingsConfigValuesPage](../../src/pages/settings/SettingsConfigValuesPage.tsx) | Prescription **route and frequency dropdowns render empty**. The most common false "OPD is broken" report |
| `drug_master` rows | [SettingsDrugsPage](../../src/pages/settings/SettingsDrugsPage.tsx) | Drug search returns nothing |
| `lab_test_master` rows | [SettingsLabTestsPage](../../src/pages/settings/SettingsLabTestsPage.tsx) | Lab chips in the Rx tab are **empty** |
| `radiology_study_master` rows | [SettingsRadiologyPage](../../src/pages/settings/SettingsRadiologyPage.tsx) | Radiology chips empty |
| OPD workflow config | [SettingsOPDWorkflowPage](../../src/pages/settings/SettingsOPDWorkflowPage.tsx) | Defaults apply |
| `doctor_schedules`, `doctor_slots` | [SettingsDoctorSchedulesPage](../../src/pages/settings/SettingsDoctorSchedulesPage.tsx) | No appointment slots bookable |

### Lab — Phase 5

| Must exist | Screen | Symptom if missing |
|---|---|---|
| `lab_test_master` with **`fee`**, `sample_type`, `unit`, `normal_min/max`, `tat_minutes` | [SettingsLabTestsPage](../../src/pages/settings/SettingsLabTestsPage.tsx) | Order created at **₹0**; no normal range means no abnormal flag and **no critical alert** |
| `lab_test_groups` + group items with `fee` | same | Panel orders bill as the sum of individual tests instead of the group rate |
| Sample types matching the tests | same | Sample rows can't be grouped for collection |

> 🔴 **The OPD→Lab handoff is an exact, case-insensitive match on `lab_test_master.test_name`.**
> A test the doctor typed that isn't in the catalogue is **silently dropped** from the order —
> you get only an amber banner saying "N prescribed tests not found". If your catalogue
> spelling differs from what doctors type, tests vanish and revenue leaks.

### Radiology — Phase 5

| Must exist | Screen | Symptom if missing |
|---|---|---|
| `radiology_modalities` — **create these FIRST** | [SettingsRadiologyPage](../../src/pages/settings/SettingsRadiologyPage.tsx) | "No studies configured. Go to Settings → Radiology Modalities" |
| `radiology_study_master` with `fee`, `modality_id`, `sort_order` | same | Studies missing or ₹0 |
| `pcpndt_settings` | same | 🔴 Form F may not generate correctly for obstetric scans |
| `hospital_pacs_config` | [IntegrationsHubPage](../../src/pages/settings/IntegrationsHubPage.tsx) | DICOM/PACS features inert |

### Pharmacy — Phase 6

| Must exist | Screen | Symptom if missing |
|---|---|---|
| `drug_master` — **first** | [SettingsDrugsPage](../../src/pages/settings/SettingsDrugsPage.tsx) | Nothing to dispense |
| `drug_batches` with `quantity_available`, `expiry_date`, `mrp`, `sale_price`, `gst_percent` — **second** | Pharmacy → Receive Stock | **No dispensing possible and no stock decrement.** A drug with no batch is invisible to the dispenser |
| `store_locations` | [PharmacyPage](../../src/pages/pharmacy/PharmacyPage.tsx) | No store transfers |
| `hospital_settings.ipd_ancillary_payment` | [SettingsIPDAncillaryPaymentPage](../../src/pages/settings/SettingsIPDAncillaryPaymentPage.tsx) | Defaults to `post_paid`. 🔴 **This setting changes whether stock decrements at dispense at all** — both values need a full test run |
| `stock_reorder_triggers` | [SettingsInventoryPage](../../src/pages/settings/SettingsInventoryPage.tsx) | No reorder alerts |

> Batch selection is **FEFO with hard exclusions**: `quantity_available > 0`,
> `expiry_date > today`, `is_active`, and status not in `quarantined`/`destroyed`. Seed data
> deliberately includes an expired batch and a quarantined batch to test the exclusions.

### IPD — Phase 7

| Must exist | Screen | Symptom if missing |
|---|---|---|
| `wards` with **`rate_per_day`** | [SettingsWardsPage](../../src/pages/settings/SettingsWardsPage.tsx) | 🔴 **Room charge silently falls back to ₹500/day.** Rate precedence is `wards.rate_per_day` → `service_rates` by bed category → `service_master` name match → ₹500 |
| `beds` linked to wards | same | **The Admit modal shows no beds** — admission is impossible |
| `payer_masters` | [SettingsPayerMastersPage](../../src/pages/settings/SettingsPayerMastersPage.tsx) | No insurance selection at admission |
| `service_master` `ipd_consultation_fee` per doctor | [SettingsServicesPage](../../src/pages/settings/SettingsServicesPage.tsx) | Doctor visit charges default or vanish |
| `hospitals.discharge_workflow` | [SettingsDischargeWorkflowPage](../../src/pages/settings/SettingsDischargeWorkflowPage.tsx) | Default clearance list applies |
| `day_care_procedures` | [SettingsDayCareProceduresPage](../../src/pages/settings/SettingsDayCareProceduresPage.tsx) | Day care procedure picker empty |
| `health_packages` | [SettingsServicesPage](../../src/pages/settings/SettingsServicesPage.tsx) | Estimate step empty |

### Billing & Accounts — Phase 8

| Must exist | Screen | Symptom if missing |
|---|---|---|
| `hospitals.gstin` | [SettingsProfilePage](../../src/pages/settings/SettingsProfilePage.tsx) | No GST on invoices. **Setting it turns ON the HSN hard-block** |
| `service_master` / `service_rates` with `hsn_code`, `gst_percent`, `gst_applicable` | [SettingsGSTPage](../../src/pages/settings/SettingsGSTPage.tsx), [SettingsServicesPage](../../src/pages/settings/SettingsServicesPage.tsx) | 🔴 **Bill finalisation hard-blocked** once GSTIN is set and any line lacks an HSN |
| `service_rates` with `bed_category` | [SettingsServicesPage](../../src/pages/settings/SettingsServicesPage.tsx) | ₹0 leakage on dialysis, physio, ambulance and similar |
| `hospital_settings.discount_approval_rules` | [SettingsApprovalsPage](../../src/pages/settings/SettingsApprovalsPage.tsx) | 🔴 **Every discount auto-approves** — no approval workflow at all |
| Razorpay keys in `api_configurations` | [SettingsRazorpayPage](../../src/pages/settings/SettingsRazorpayPage.tsx) | Payment links dead |
| `chart_of_accounts`, `auto_posting_rules` | [Accounts Setup](../../src/pages/accounts/) | Journals don't post. *Note: auto-seeded by a DB trigger when the hospital is created* |
| `bank_accounts` | [SettingsBankAccountsPage](../../src/pages/settings/SettingsBankAccountsPage.tsx) | No reconciliation |

### Insurance — Phase 9

| Must exist | Screen | Symptom if missing |
|---|---|---|
| `payer_masters` | [SettingsPayerMastersPage](../../src/pages/settings/SettingsPayerMastersPage.tsx) | No payer to select |
| `tpa_config` — `room_rent_ceiling`, `co_payment_type/value`, `deductible` | Insurance → TPA Configuration | Ceilings and co-pay not applied; claim amounts wrong |
| `hospital_insurance_settings` | Insurance module | Plan tier features unavailable |
| `cghs_echs_beneficiaries` with a **`referral_date`** | Insurance → CGHS/ECHS | 🔴 **Bill finalisation hard-blocked** for any patient categorised CGHS/ECHS without one. This is deliberate |
| `insurance_automation_config` | Insurance → Automation Settings | No automated intimations or alerts |

### Emergency, OT & Critical Ops — Phase 10

| Must exist | Screen |
|---|---|
| `ot_rooms`, OT checklist template | [SettingsOTChecklistPage](../../src/pages/settings/SettingsOTChecklistPage.tsx) |
| `shift_master` | [SettingsShiftsPage](../../src/pages/settings/SettingsShiftsPage.tsx) |
| Clinical thresholds (triage, alerts) | [SettingsThresholdsPage](../../src/pages/settings/SettingsThresholdsPage.tsx) |
| Clinical protocols | [SettingsProtocolsPage](../../src/pages/settings/SettingsProtocolsPage.tsx) |
| Consent form templates | [SettingsConsentFormsPage](../../src/pages/settings/SettingsConsentFormsPage.tsx) |

### Back office — Phase 11

| Must exist | Screen |
|---|---|
| `shift_master`, roster | [SettingsShiftsPage](../../src/pages/settings/SettingsShiftsPage.tsx) |
| Inventory categories, stores, reorder levels | [SettingsInventoryPage](../../src/pages/settings/SettingsInventoryPage.tsx) |
| `record_retention_policies` | [SettingsRecordRetentionPage](../../src/pages/settings/SettingsRecordRetentionPage.tsx) — without it, defaults are 3 years / 10 years for MLC |
| ICD-10 code set | [SettingsICDCodesPage](../../src/pages/settings/SettingsICDCodesPage.tsx) |

### AI features — Phase 14

| Must exist | Screen | Symptom if missing |
|---|---|---|
| Plan/addon entitlement including the feature key | [SettingsPlanPage](../../src/pages/settings/SettingsPlanPage.tsx) → `hospital_addons`, `addon_skus.ai_feature_keys` | 🔴 **The AI button is simply not rendered.** No message, no explanation |
| Hospital AI toggle for that key | [SettingsAIFeaturesPage](../../src/pages/settings/SettingsAIFeaturesPage.tsx) | Same — hidden |
| AI language settings | [SettingsAILanguagePage](../../src/pages/settings/SettingsAILanguagePage.tsx) → `ai_language_settings` | Defaults to English only |
| AI budget not exhausted | `hospital_ai_wallet`, `ai_budget` | `callAI` refuses; feature appears broken |
| AI provider config | [APIConfigHubPage](../../src/pages/settings/APIConfigHubPage.tsx) | Calls fail |

> **Three independent gates.** Before logging "the AI button is missing", check the plan
> entitlement, the hospital toggle, **and** the budget.

### Notifications & integrations — any phase

| Must exist | Screen | Symptom if missing |
|---|---|---|
| WhatsApp config, templates, connector | [SettingsWhatsAppPage](../../src/pages/settings/SettingsWhatsAppPage.tsx) | 🔴 **All notifications silently no-op.** Nothing fails, nothing sends |
| `hospital_abdm_config` | [SettingsABDMPage](../../src/pages/settings/SettingsABDMPage.tsx) | ABDM edge functions fail quietly |
| Notification preferences, escalation rules | [SettingsNotificationsPage](../../src/pages/settings/SettingsNotificationsPage.tsx) | No escalation |
| HL7 / analyser connectors | [SettingsHL7Page](../../src/pages/settings/SettingsHL7Page.tsx), [IntegrationsHubPage](../../src/pages/settings/IntegrationsHubPage.tsx) | Analyser results don't arrive |
| Module entitlement (`plan_features`, `hospital_feature_overrides`) — what a hospital is *allowed* to have per its plan | Platform console → Hospital → **Modules** / Plans Manager. There is no hospital-side screen for this by design | Routes show the plan gate |
| Module on/off + product mode (`product_modes`) — which of its *entitled* modules a hospital actually enables, and its business-type preset | [SettingsModulesPage](../../src/pages/settings/SettingsModulesPage.tsx), [SettingsProductModePage](../../src/pages/settings/SettingsProductModePage.tsx) — hospital-side screens that exist and have existed since the first commit. **Currently unreachable:** both files and their `App.tsx` routes (`/settings/modules`, `/settings/product-mode`) are removed from the working tree, uncommitted — not a deliberate design decision. `e2e/phase-02-settings/settings.helpers.ts` and `settings-forms.ts` exclude both routes pending resolution | Sidebar/module list may not reflect what the hospital actually wants enabled |

---

## The recommended first-run order

This is exactly the order the onboarding wizard uses
([OnboardingWizard.tsx](../../src/pages/setup/OnboardingWizard.tsx)) — 14 steps in 6
sections. If you follow it, nothing is ever blocked by a missing prerequisite:

```
Hospital       1. Branding                    → hospitals
               2. Departments                 → departments
Structure      3. Wards & Beds                → wards, beds       ⚠️ set rate_per_day
               4. Shifts                      → shift_master
People         5. Doctors                     → users, service_master
               6. Other Staff                 → users, staff_profiles
               7. OPD Schedules               → doctor_schedules, doctor_slots
Services       8. Fees                        → service_master     ⚠️ or everything bills ₹500
               9. Payers                      → payer_masters
              10. Lab & Radiology             → lab_test_master, radiology_modalities
              11. Payments                    → api_configurations
Integrations  12. WhatsApp                    → hospitals, whatsapp_templates
              13. Modules                     → hospital_module_entitlements
Launch        14. Go Live                     → go-live checklist
```

Steps 1, 5, 6, 7, 9, 10, 12 and 13 are marked **optional** in the wizard and can be skipped.
Skipping 5 (Doctors) or 10 (Lab & Radiology) will leave you unable to test OPD properly —
so for QA purposes, don't skip anything.

Anything the wizard doesn't cover — GST, discount approvals, IPD ancillary payment, AI
features, discharge workflow, day care procedures, retention — must be set from the Settings
hub afterwards. Those are Phase 2.

---

## Multi-tenancy — what breaks when `hospital_id` is wrong

Everything is scoped by `hospital_id`, resolved from the `users` row via
`get_user_hospital_id()` in RLS and `HospitalContext` on the client. When it resolves wrong
or null:

- Master-data pickers render **empty with no error** — the Rx tab early-returns on a missing
  hospital ID
- Fee lookups all miss, so bills fall back to hardcoded defaults
- Bill number sequences are per-hospital, so the wrong tenant means a wrong or duplicate
  series
- 🔴 The discharge charge sweep's dedupe query is hospital-scoped — a mismatch makes dedupe
  fail and **double-bills the patient**

There is also a `sessionStorage` context cache (`hms_ctx_*`) that is only cleared on sign-out.
A user moved between hospitals keeps the stale one until they log out — a specific Phase 1
test case.

---

## Quick pre-flight before each phase

```
[ ] qa-seed.mjs run, QA tenant fresh
[ ] Tier 0 complete (profile, departments, staff, roles, plan)
[ ] This phase's Tier 1 rows all configured
[ ] Logged in as the role the scenario specifies
[ ] Correct hospital selected (A unless the case says B)
[ ] DevTools console open — you need the red text if something fails
```

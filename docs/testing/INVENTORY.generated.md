# Test inventory — GENERATED, DO NOT EDIT

Regenerate with `npm run inventory`. `npm run check:inventory` fails CI if this file is
stale, so edit [scripts/generate-test-inventory.mjs](../../scripts/generate-test-inventory.mjs)
instead — any change made here is overwritten.

Every row carries where it is in [PHASED_TEST_PLAN.md](PHASED_TEST_PLAN.md). Phase 10's exit
gate requires that no row reads "unassigned"; the generator has no such value, so a surface
that does not match a rule lands in Phase 10 explicitly rather than falling off the list.

## Totals

| Layer | Source registry | Rows | Unit-tested |
|---|---|---:|---:|
| Modules | `ALL_MODULES` | 67 | — |
| Settings screens | `SETTINGS_CATALOG` | 54 | — |
| Routes | `ROUTE_ROLES` | 87 | — |
| Edge functions | `supabase/functions/` | 107 | 0 |
| Database tables | generated `types.ts` | 555 | — |
| Business logic | `src/lib/**` | 190 | 32 |

**E2E column** is computed by searching the `e2e/` sources for the route or function name,
so it starts reporting on its own as specs land — no edit to the generator needed.
`e2e/` exists (Phase 3). Its only spec so far is the harness smoke test, so the column is still `—` almost everywhere; Phases 5.5+ fill it in.

## Modules — `ALL_MODULES` (67)

Source: [src/lib/modules.ts](../../src/lib/modules.ts). Every module is smoke-covered in
Phase 5.5 as both tenants (D11); the adoption spine gets journey coverage in Phase 7.5 (D7).

| Module | Route | Category | Unit | E2E | Phase | Owner |
|---|---|---|---|---|---|---|
| OPD Queue | `/opd` | Clinical | — | — | 7.5 | clinical-pod |
| IPD / Wards | `/ipd` | Clinical | — | — | 5.5 | quality-pod |
| Day Care Unit | `/ipd/day-care` | Clinical | — | — | 5.5 | quality-pod |
| Emergency | `/emergency` | Clinical | — | — | 5.5 | quality-pod |
| Operation Theatre | `/ot` | Clinical | — | — | 5.5 | quality-pod |
| Nursing | `/nursing` | Clinical | — | — | 5.5 | quality-pod |
| Telemedicine | `/telemedicine` | Clinical | — | — | 5.5 | quality-pod |
| Health Packages | `/packages` | Clinical | — | — | 5.5 | quality-pod |
| Laboratory (LIS) | `/lab` | Diagnostics | — | — | 7.5 | clinical-pod |
| Radiology (RIS) | `/radiology` | Diagnostics | — | — | 7.5 | clinical-pod |
| Blood Bank | `/blood-bank` | Surgical | — | — | 5.5 | quality-pod |
| CSSD | `/cssd` | Surgical | — | — | 5.5 | quality-pod |
| Pharmacy (IP) | `/pharmacy` | Pharmacy | — | — | 7.5 | clinical-pod |
| Pharmacy Retail | `/pharmacy?mode=retail` | Pharmacy | — | — | 7.5 | clinical-pod |
| Billing | `/billing` | Finance | — | — | 5.5 | quality-pod |
| Day Closure | `/billing/closure` | Finance | — | — | 5.5 | quality-pod |
| Insurance / TPA | `/insurance` | Finance | — | — | 5.5 | quality-pod |
| Payments | `/payments` | Finance | — | yes | 5.5 | quality-pod |
| Accounts / ERP | `/accounts` | Finance | — | yes | 5.5 | quality-pod |
| Govt Schemes / PMJAY | `/pmjay` | Finance | — | yes | 5.5 | quality-pod |
| HR & Payroll | `/hr` | Operations | — | — | 5.5 | quality-pod |
| Inventory & Stores | `/inventory` | Operations | — | — | 5.5 | quality-pod |
| Quality & NABH | `/quality` | Operations | — | — | 5.5 | quality-pod |
| IPC Dashboard | `/ipc/dashboard` | Operations | — | — | 5.5 | quality-pod |
| Dialysis Unit | `/dialysis` | Specialized | — | — | 5.5 | quality-pod |
| Oncology | `/oncology` | Specialized | — | — | 5.5 | quality-pod |
| Physiotherapy | `/physio` | Specialized | — | — | 5.5 | quality-pod |
| Mortuary & Medico-Legal | `/mortuary` | Specialized | — | — | 5.5 | quality-pod |
| Vaccination | `/vaccination` | Clinical | — | — | 5.5 | quality-pod |
| Ambulance Service | `/ambulance` | Clinical | — | — | 5.5 | quality-pod |
| Home Care | `/home-care` | Clinical | — | — | 5.5 | quality-pod |
| Dental | `/dental` | Specialized | — | — | 5.5 | quality-pod |
| AYUSH | `/ayush` | Specialized | — | — | 5.5 | quality-pod |
| IVF & ART | `/ivf` | Specialized | — | — | 5.5 | quality-pod |
| Obstetric ANC | `/specialty/anc` | Specialized | — | — | 5.5 | quality-pod |
| Neonatal EMR | `/specialty/neonatal` | Specialized | — | — | 5.5 | quality-pod |
| Anaesthesia EMR | `/specialty/anaesthesia` | Specialized | — | — | 5.5 | quality-pod |
| Ophthalmology EMR | `/specialty/ophthalmology` | Specialized | — | — | 5.5 | quality-pod |
| Partograph | `/specialty/partograph` | Specialized | — | — | 5.5 | quality-pod |
| Mental Health / Psychiatry | `/mental-health` | Specialized | — | — | 5.5 | quality-pod |
| Chronic Disease Management | `/chronic-disease` | Clinical | — | — | 5.5 | quality-pod |
| Medical Records | `/mrd` | Operations | — | — | 5.5 | quality-pod |
| FMS / Safety | `/fms/dashboard` | Operations | — | — | 5.5 | quality-pod |
| Biomedical Engineering | `/biomedical` | Operations | — | — | 5.5 | quality-pod |
| Housekeeping | `/housekeeping` | Operations | — | — | 5.5 | quality-pod |
| Govt HMIS Reporting | `/hmis` | Operations | — | — | 5.5 | quality-pod |
| Dietetics & Nutrition | `/dietetics` | Clinical | — | — | 5.5 | quality-pod |
| Staff Training / LMS | `/lms` | Operations | — | — | 5.5 | quality-pod |
| CRM & Marketing | `/crm` | Operations | — | — | 5.5 | quality-pod |
| ABDM / ABHA | `/abdm` | Operations | — | yes | 5.5 | quality-pod |
| JCI Accreditation | `/quality/jci` | Operations | — | — | 5.5 | quality-pod |
| MCI / Disaster Response | `/emergency/mci` | Operations | — | — | 5.5 | quality-pod |
| Population Health | `/analytics/population-health` | Analytics | — | — | 5.5 | quality-pod |
| Revenue Intelligence | `/analytics/revenue-intelligence` | Analytics | — | — | 5.5 | quality-pod |
| AI Clinical Intelligence | `/ai/clinical-intelligence` | Analytics | — | — | 5.5 | quality-pod |
| Financial Statements | `/accounts/financial-statements` | Finance | — | — | 5.5 | quality-pod |
| Budget Management | `/accounts/budget` | Finance | — | — | 5.5 | quality-pod |
| Fixed Assets Register | `/accounts/fixed-assets` | Finance | — | — | 5.5 | quality-pod |
| Research Platform | `/research` | Analytics | — | — | 5.5 | quality-pod |
| Notifications | `/notifications` | Operations | — | — | 5.5 | quality-pod |
| Patient Portal | `/portal` | Patient | — | — | 5.5 | quality-pod |
| Patient Relations | `/pro` | Patient | — | yes | 5.5 | quality-pod |
| Communication Inbox | `/inbox` | Patient | — | — | 5.5 | quality-pod |
| Analytics & BI | `/analytics` | Analytics | — | — | 5.5 | quality-pod |
| HOD Dashboard | `/hod-dashboard` | Analytics | — | — | 5.5 | quality-pod |
| TV Display | `/tv-display` | Analytics | — | — | 5.5 | quality-pod |
| Settings Hub | `/settings` | Settings | — | — | 5.5 | quality-pod |

Category split: Operations 15, Clinical 13, Specialized 13, Finance 9, Analytics 7, Patient 3, Diagnostics 2, Surgical 2, Pharmacy 2, Settings 1.

---

## Settings screens — `SETTINGS_CATALOG` (54)

Source: [src/lib/settingsCatalog.ts](../../src/lib/settingsCatalog.ts). Phase 5 requires each
to be behaviour-tested (seed two values, assert the configured module's runtime decision
differs) or explicitly listed as having no verified consumer.

| Screen | Route | E2E | Phase | Owner |
|---|---|---|---|---|
| Hospital Profile | `/settings/profile` | — | 5 | quality-pod |
| Branding | `/settings/branding` | — | 5 | quality-pod |
| White-Label Branding | `/settings/white-label` | — | 5 | quality-pod |
| Language & Region | `/settings/language` | — | 5 | quality-pod |
| Support | `/settings/support` | — | 5 | quality-pod |
| Training Videos | `/settings/training` | — | 5 | quality-pod |
| Plan & Billing | `/settings/plan` | — | 5 | quality-pod |
| AI Features & Attestation | `/settings/ai-features` | — | 5 | quality-pod |
| Departments | `/settings/departments` | — | 5 | quality-pod |
| Wards & Beds | `/settings/wards` | — | 5 | quality-pod |
| Shifts | `/settings/shifts` | — | 5 | quality-pod |
| Bank Accounts | `/settings/bank-accounts` | — | 5 | quality-pod |
| Configurable Dropdowns | `/settings/config-values` | — | 5 | quality-pod |
| Staff Members | `/settings/staff` | — | 5 | quality-pod |
| Roles & Permissions | `/settings/roles` | — | 5 | quality-pod |
| Doctor Schedules | `/settings/doctor-schedules` | — | 5 | quality-pod |
| Service Rates | `/settings/services` | — | 5 | quality-pod |
| Payer Masters | `/settings/payer-masters` | — | 5 | quality-pod |
| Lab Test Master | `/settings/lab-tests` | — | 5 | quality-pod |
| Drug Formulary | `/settings/drugs` | — | 5 | quality-pod |
| Consent Forms | `/settings/consent-forms` | — | 5 | quality-pod |
| OT Checklist | `/settings/ot-checklist` | — | 5 | quality-pod |
| Clinical Protocols | `/settings/protocols` | — | 5 | quality-pod |
| Alert Thresholds | `/settings/clinical-thresholds` | — | 5 | quality-pod |
| ICD-10 / ICD-11 Code Master | `/settings/icd-codes` | — | 5 | quality-pod |
| Radiology Modalities | `/settings/radiology` | — | 5 | quality-pod |
| Day Care Procedures | `/settings/day-care-procedures` | — | 5 | quality-pod |
| EMR Templates | `/settings/templates` | — | 5 | quality-pod |
| TV Queue Display | `/settings/tv-display` | — | 5 | quality-pod |
| Self-Service Kiosk | `/settings/tv-display` | — | 5 | quality-pod |
| Discharge Workflow | `/settings/discharge-workflow` | — | 5 | quality-pod |
| Approval Rules | `/settings/approvals` | — | 5 | quality-pod |
| OPD Queue Config | `/settings/opd-workflow` | — | 5 | quality-pod |
| IPD Ancillary Payment | `/settings/ipd-ancillary-payment` | — | 5 | quality-pod |
| Notification Config | `/settings/notifications` | — | 5 | quality-pod |
| WhatsApp Bot | `/settings/whatsapp` | — | 5 | quality-pod |
| Scheduled Reports | `/settings/report-schedules` | — | 5 | quality-pod |
| Integrations Console | `/settings/integrations` | — | 5 | quality-pod |
| HL7 / FHIR Integration | `/settings/hl7` | — | 5 | quality-pod |
| Razorpay Payments | `/settings/razorpay` | — | 5 | quality-pod |
| HMIS / IHIP Portal | `/settings/hmis-portal` | — | 5 | quality-pod |
| WhatsApp / WATI | `/settings/whatsapp` | — | 5 | quality-pod |
| GST / NIC IRP | `/settings/gst` | — | 5 | quality-pod |
| ABDM / ABHA | `/settings/abdm` | — | 5 | quality-pod |
| Backup & Export | `/settings/backup` | — | 5 | quality-pod |
| API Portal | `/settings/api-portal` | — | 5 | quality-pod |
| Integration Keys | `/settings/api-hub` | — | 5 | quality-pod |
| AI Language Packs | `/settings/ai-languages` | — | 5 | quality-pod |
| Store Locations | `/settings/inventory` | — | 5 | quality-pod |
| Record Retention | `/settings/record-retention` | — | 5 | quality-pod |
| Record Access Log | `/ims/access-logs` | — | 5 | quality-pod |
| Config Change Log | `/settings/change-log` | — | 5 | quality-pod |
| Go-Live Checklist | `/admin/go-live` | — | 5 | quality-pod |
| Data Migration | `/admin/data-migration` | — | 5 | quality-pod |

---

## Routes — `ROUTE_ROLES` (87)

Source: [src/lib/routeRoles.ts](../../src/lib/routeRoles.ts), generated from `ALL_MODULES`
plus explicit overrides. Phase 5.5 sweep 1 asserts each loads for an entitled role and is
refused for a non-entitled one.

| Route | Source | E2E | Phase | Owner |
|---|---|---|---|---|
| `/abdm` | explicit override | yes | 5.5 | quality-pod |
| `/accounts` | explicit override | yes | 5.5 | quality-pod |
| `/accounts/budget` | explicit override | — | 5.5 | quality-pod |
| `/accounts/financial-statements` | explicit override | — | 5.5 | quality-pod |
| `/accounts/fixed-assets` | explicit override | — | 5.5 | quality-pod |
| `/admin/data-migration` | explicit override | — | 5.5 | quality-pod |
| `/admin/go-live` | explicit override | — | 5.5 | quality-pod |
| `/ai/clinical-intelligence` | explicit override | — | 5.5 | quality-pod |
| `/ambulance` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/analytics` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/analytics/forecasts` | explicit override | — | 5.5 | quality-pod |
| `/analytics/population-health` | explicit override | — | 5.5 | quality-pod |
| `/analytics/revenue-intelligence` | explicit override | — | 5.5 | quality-pod |
| `/ayush` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/billing` | explicit override | — | 5.5 | quality-pod |
| `/billing/closure` | explicit override | — | 5.5 | quality-pod |
| `/biomedical` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/blood-bank` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/chronic-disease` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/crm` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/cssd` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/dashboard` | explicit override | — | 5.5 | quality-pod |
| `/dental` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/design-system` | explicit override | — | 5.5 | quality-pod |
| `/dialysis` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/dietetics` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/emergency` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/emergency/mci` | explicit override | — | 5.5 | quality-pod |
| `/fms/dashboard` | explicit override | — | 5.5 | quality-pod |
| `/hmis` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/hod-dashboard` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/home-care` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/housekeeping` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/hr` | explicit override | — | 5.5 | quality-pod |
| `/inbox` | explicit override | — | 5.5 | quality-pod |
| `/insurance` | explicit override | — | 5.5 | quality-pod |
| `/inventory` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/ipc/dashboard` | explicit override | — | 5.5 | quality-pod |
| `/ipd` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/ipd/day-care` | explicit override | — | 5.5 | quality-pod |
| `/ivf` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/lab` | explicit override | — | 5.5 | quality-pod |
| `/lms` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/mental-health` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/modules` | explicit override | — | 5.5 | quality-pod |
| `/mortuary` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/mrd` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/nabh/compliance` | explicit override | — | 5.5 | quality-pod |
| `/notifications` | explicit override | — | 5.5 | quality-pod |
| `/nursing` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/oncology` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/opd` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/ot` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/packages` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/patients` | explicit override | — | 5.5 | quality-pod |
| `/payments` | from ALL_MODULES | yes | 5.5 | quality-pod |
| `/pharmacy` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/physio` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/pmjay` | from ALL_MODULES | yes | 5.5 | quality-pod |
| `/portal` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/pro` | from ALL_MODULES | yes | 5.5 | quality-pod |
| `/quality` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/quality/clinical-audits` | explicit override | — | 5.5 | quality-pod |
| `/quality/committees` | explicit override | — | 5.5 | quality-pod |
| `/quality/events` | explicit override | — | 5.5 | quality-pod |
| `/quality/jci` | explicit override | — | 5.5 | quality-pod |
| `/quality/qi-projects` | explicit override | — | 5.5 | quality-pod |
| `/radiology` | explicit override | — | 5.5 | quality-pod |
| `/research` | explicit override | — | 5.5 | quality-pod |
| `/schedule` | explicit override | — | 5.5 | quality-pod |
| `/settings` | explicit override | — | 5.5 | quality-pod |
| `/settings/ai-languages` | explicit override | — | 5.5 | quality-pod |
| `/settings/api-portal` | explicit override | — | 5.5 | quality-pod |
| `/settings/change-log` | explicit override | — | 5.5 | quality-pod |
| `/settings/hl7` | explicit override | — | 5.5 | quality-pod |
| `/settings/integrations` | explicit override | — | 5.5 | quality-pod |
| `/settings/record-retention` | explicit override | — | 5.5 | quality-pod |
| `/settings/tv-display` | explicit override | — | 5.5 | quality-pod |
| `/settings/white-label` | explicit override | — | 5.5 | quality-pod |
| `/specialty/anaesthesia` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/specialty/anc` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/specialty/neonatal` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/specialty/ophthalmology` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/specialty/partograph` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/telemedicine` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/tv-display` | from ALL_MODULES | — | 5.5 | quality-pod |
| `/vaccination` | from ALL_MODULES | — | 5.5 | quality-pod |

---

## Edge functions — `supabase/functions/` (107)

Priority bands from D8. Four assertions each: authenticated request succeeds, missing/invalid
auth rejected, malformed payload does not 500 with a stack trace, no PHI in logs.

| Function | Band | Unit | E2E | Phase | Owner |
|---|---|---|---|---|---|
| `abdm-abha-create` | 3 Statutory | — | yes | 6 | security-pod |
| `abdm-abha-verify` | 3 Statutory | — | yes | 6 | security-pod |
| `abdm-auto-link-care-context` | 3 Statutory | — | yes | 6 | security-pod |
| `abdm-fhir-package` | 3 Statutory | — | yes | 6 | security-pod |
| `abdm-gateway-token` | 3 Statutory | — | yes | 6 | security-pod |
| `abdm-hfr-register` | 3 Statutory | — | yes | 6 | security-pod |
| `abdm-hip-callback` | 3 Statutory | — | yes | 6 | security-pod |
| `abdm-hip-link-init` | 3 Statutory | — | yes | 6 | security-pod |
| `abdm-hpr-verify` | 3 Statutory | — | yes | 6 | security-pod |
| `abdm-sandbox-test` | 3 Statutory | — | yes | 6 | security-pod |
| `admin-impersonate-start` | 4 Tenant lifecycle | — | yes | 6 | platform-pod |
| `admin-set-staff-password` | 5 Long tail | — | — | 10 | quality-pod |
| `ai-clarifying-questions` | 1 PHI | — | yes | 6 | security-pod |
| `ai-clinical-guidelines` | 1 PHI | — | yes | 6 | security-pod |
| `ai-clinical-voice` | 1 PHI | — | yes | 6 | security-pod |
| `ai-differential-diagnosis` | 1 PHI | — | yes | 6 | security-pod |
| `ai-discharge-summary` | 1 PHI | — | yes | 6 | security-pod |
| `ai-executive-digest` | 1 PHI | — | yes | 6 | security-pod |
| `ai-generate-clinical-note` | 1 PHI | — | yes | 6 | security-pod |
| `ai-history-digest` | 1 PHI | — | yes | 6 | security-pod |
| `ai-history-ingest` | 1 PHI | — | yes | 6 | security-pod |
| `ai-icd-suggest` | 1 PHI | — | yes | 6 | security-pod |
| `ai-nabh-assistant` | 1 PHI | — | yes | 6 | security-pod |
| `ai-nabh-indicator-alert` | 1 PHI | — | yes | 6 | security-pod |
| `ai-proxy` | 1 PHI | — | yes | 6 | security-pod |
| `ai-radiology-impression` | 1 PHI | — | yes | 6 | security-pod |
| `ai-resolve-orders` | 1 PHI | — | yes | 6 | security-pod |
| `ai-revenue-leak-detector` | 1 PHI | — | yes | 6 | security-pod |
| `ai-safety-guard` | 1 PHI | — | yes | 6 | security-pod |
| `alert-escalation` | 5 Long tail | — | — | 10 | quality-pod |
| `api-gateway` | 5 Long tail | — | — | 10 | quality-pod |
| `bhashini-patient-transcribe` | 5 Long tail | — | — | 10 | quality-pod |
| `bhashini-transcribe` | 5 Long tail | — | — | 10 | quality-pod |
| `cghs-eligibility` | 3 Statutory | — | yes | 6 | security-pod |
| `change-subscription-plan` | 2 Money | — | yes | 6 | revenue-pod |
| `check-drugbank-ddi` | 5 Long tail | — | — | 10 | quality-pod |
| `churn-remediation-scan` | 5 Long tail | — | — | 10 | quality-pod |
| `create-razorpay-order` | 5 Deferred | — | — | 10 | platform-pod |
| `create-razorpay-payment-link` | 5 Deferred | — | — | 10 | platform-pod |
| `create-razorpay-subscription` | 2 Money | — | yes | 6 | revenue-pod |
| `create-staff-login` | 4 Tenant lifecycle | — | yes | 6 | platform-pod |
| `daily-leakage-scan` | 2 Money | — | yes | 6 | revenue-pod |
| `delete-hospital` | 4 Tenant lifecycle | — | yes | 6 | platform-pod |
| `donor-reengagement` | 5 Long tail | — | — | 10 | quality-pod |
| `dunning-processor` | 2 Money | — | yes | 6 | revenue-pod |
| `email-tally-xml` | 2 Money | — | yes | 6 | revenue-pod |
| `esi-claim-submit` | 3 Statutory | — | yes | 6 | security-pod |
| `export-drug-chart` | 1 PHI | — | yes | 6 | security-pod |
| `export-lab-reports` | 1 PHI | — | yes | 6 | security-pod |
| `export-nursing-notes` | 1 PHI | — | yes | 6 | security-pod |
| `fhir-export` | 1 PHI | — | yes | 6 | security-pod |
| `fhir-r4-server` | 1 PHI | — | yes | 6 | security-pod |
| `financial-anomaly-check` | 2 Money | — | yes | 6 | revenue-pod |
| `generate-daily-census` | 5 Long tail | — | — | 10 | quality-pod |
| `generate-discharge-summary` | 1 PHI | — | yes | 6 | security-pod |
| `generate-invoice` | 2 Money | — | yes | 6 | revenue-pod |
| `gst-irn-generate` | 2 Money | — | yes | 6 | revenue-pod |
| `hcx-callback-receiver` | 3 Statutory | — | yes | 6 | security-pod |
| `hcx-claim-submit` | 3 Statutory | — | yes | 6 | security-pod |
| `hmis-portal-submit` | 3 Statutory | — | yes | 6 | security-pod |
| `idsp-alert-submit` | 3 Statutory | — | yes | 6 | security-pod |
| `insurance-automation` | 5 Long tail | — | yes | 10 | quality-pod |
| `insurance-daily-alerts` | 5 Long tail | — | — | 10 | quality-pod |
| `invite-doctors` | 5 Long tail | — | — | 10 | quality-pod |
| `lab-analyzer-ingest` | 1 PHI | — | yes | 6 | security-pod |
| `lifecycle-nudge-scan` | 5 Long tail | — | — | 10 | quality-pod |
| `mrr-snapshot-job` | 5 Long tail | — | — | 10 | quality-pod |
| `notification-dispatcher` | 5 Long tail | — | — | 10 | quality-pod |
| `nps-survey-dispatch` | 5 Long tail | — | — | 10 | quality-pod |
| `nps-survey-respond` | 5 Long tail | — | — | 10 | quality-pod |
| `phi-backfill-encrypt` | 1 PHI | — | yes | 6 | security-pod |
| `pmjay-claim-submit` | 3 Statutory | — | yes | 6 | security-pod |
| `pmjay-eligibility` | 3 Statutory | — | yes | 6 | security-pod |
| `purge-orphaned-users` | 4 Tenant lifecycle | — | yes | 6 | platform-pod |
| `razorpay-lookup` | 5 Long tail | — | — | 10 | quality-pod |
| `razorpay-settlement-reconcile` | 2 Money | — | yes | 6 | revenue-pod |
| `razorpay-subscription-webhook` | 2 Money | — | yes | 6 | revenue-pod |
| `razorpay-webhook` | 2 Money | — | yes | 6 | revenue-pod |
| `reconcile-journal-postings` | 2 Money | — | yes | 6 | revenue-pod |
| `register-hospital` | 4 Tenant lifecycle | — | yes | 6 | platform-pod |
| `reset-staff-mfa` | 5 Long tail | — | — | 10 | quality-pod |
| `sarvam-transcribe` | 5 Long tail | — | — | 10 | quality-pod |
| `scan-drug-list` | 5 Long tail | — | — | 10 | quality-pod |
| `scan-invoice` | 5 Long tail | — | — | 10 | quality-pod |
| `scan-lab-tests` | 5 Long tail | — | — | 10 | quality-pod |
| `seed-dashboard` | 5 Long tail | — | — | 10 | quality-pod |
| `seed-drugs` | 5 Long tail | — | — | 10 | quality-pod |
| `seed-pharmacy` | 5 Long tail | — | — | 10 | quality-pod |
| `send-email` | 5 Long tail | — | — | 10 | quality-pod |
| `send-po-email` | 5 Long tail | — | — | 10 | quality-pod |
| `send-push-notification` | 5 Long tail | — | — | 10 | quality-pod |
| `send-signup-otp` | 5 Long tail | — | — | 10 | quality-pod |
| `send-sms` | 5 Long tail | — | — | 10 | quality-pod |
| `send-subscription-notification` | 5 Long tail | — | — | 10 | quality-pod |
| `send-whatsapp-meta` | 5 Long tail | — | — | 10 | quality-pod |
| `send-whatsapp-test` | 5 Long tail | — | — | 10 | quality-pod |
| `setup-hospital` | 4 Tenant lifecycle | — | yes | 6 | platform-pod |
| `submit-pre-auth-hcx` | 3 Statutory | — | yes | 6 | security-pod |
| `translate-patient-content` | 5 Long tail | — | — | 10 | quality-pod |
| `trial-lifecycle-cron` | 5 Long tail | — | — | 10 | quality-pod |
| `update-oauth-providers` | 5 Long tail | — | — | 10 | quality-pod |
| `update-patient-ai-context` | 1 PHI | — | yes | 6 | security-pod |
| `upsert-patient-phi` | 1 PHI | — | yes | 6 | security-pod |
| `verify-signup-otp` | 5 Long tail | — | — | 10 | quality-pod |
| `webhook-dispatcher` | 5 Long tail | — | — | 10 | quality-pod |
| `webhook-dlq-processor` | 5 Long tail | — | — | 10 | quality-pod |
| `whatsapp-bot` | 5 Long tail | — | — | 10 | quality-pod |

---

## Database tables — generated types (555)

Source: [src/integrations/supabase/types.ts](../../src/integrations/supabase/types.ts). The
five hubs carry Phase 5 reconciliation tests; every table is isolation-tested in Phase 4.

| Table | Hub | Phase | Owner |
|---|---|---|---|
| `abdm_audit_log` | — | 4 | data-pod |
| `abdm_care_contexts` | — | 4 | data-pod |
| `abdm_consent_logs` | — | 4 | data-pod |
| `abdm_consents` | — | 4 | data-pod |
| `abdm_gateway_logs` | — | 4 | data-pod |
| `abdm_rate_limits` | — | 4 | data-pod |
| `accounting_posting_failures` | — | 4 | data-pod |
| `addon_skus` | — | 4 | data-pod |
| `admin_audit_log` | — | 4 | data-pod |
| `admission_day_care_procedures` | — | 4 | data-pod |
| `admission_estimates` | — | 4 | data-pod |
| `admission_sequences` | — | 4 | data-pod |
| `admissions` | — | 4 | data-pod |
| `adult_immunization_schedule` | — | 4 | data-pod |
| `advance_receipts` | — | 4 | data-pod |
| `ai_attestations` | — | 4 | data-pod |
| `ai_cost_daily` | — | 4 | data-pod |
| `ai_digests` | — | 4 | data-pod |
| `ai_feature_classes` | — | 4 | data-pod |
| `ai_feature_logs` | — | 4 | data-pod |
| `ai_language_settings` | — | 4 | data-pod |
| `ai_provider_config` | — | 4 | data-pod |
| `ai_safety_flags` | — | 4 | data-pod |
| `ai_suggestions_audit` | — | 4 | data-pod |
| `ai_usage_logs` | — | 4 | data-pod |
| `ai_wallet_transactions` | — | 4 | data-pod |
| `alert_escalation_log` | — | 4 | data-pod |
| `alert_escalation_rules` | — | 4 | data-pod |
| `allergy_records` | — | 4 | data-pod |
| `ambulance_dispatches` | — | 4 | data-pod |
| `ambulance_equipment_checks` | — | 4 | data-pod |
| `ambulance_transit_treatment` | — | 4 | data-pod |
| `ambulance_vehicles` | — | 4 | data-pod |
| `amc_contracts` | — | 4 | data-pod |
| `anaesthesia_records` | — | 4 | data-pod |
| `andrology_reports` | — | 4 | data-pod |
| `antibiotic_justifications` | — | 4 | data-pod |
| `antibiotic_restricted_list` | — | 4 | data-pod |
| `api_configurations` | — | 4 | data-pod |
| `api_keys` | — | 4 | data-pod |
| `appointments` | — | 4 | data-pod |
| `arogyasri_enrollments` | — | 4 | data-pod |
| `art_couples` | — | 4 | data-pod |
| `asr_pricing` | — | 4 | data-pod |
| `attendance_regularization_requests` | — | 4 | data-pod |
| `audit_log` | — | 4 | data-pod |
| `audit_records` | — | 4 | data-pod |
| `aumrti_admins` | — | 4 | data-pod |
| `auto_posting_rules` | — | 4 | data-pod |
| `ayush_drug_master` | — | 4 | data-pod |
| `ayush_encounters` | — | 4 | data-pod |
| `bank_accounts` | — | 4 | data-pod |
| `bank_transactions` | — | 4 | data-pod |
| `bed_demand_forecasts` | — | 4 | data-pod |
| `bed_reservations` | — | 4 | data-pod |
| `beds` | — | 4 | data-pod |
| `bill_amendments` | — | 4 | data-pod |
| `bill_discount_approvals` | — | 4 | data-pod |
| `bill_line_items` | **hub** | 5 | data-pod |
| `bill_payments` | — | 4 | data-pod |
| `bill_sequences` | — | 4 | data-pod |
| `bills` | — | 4 | data-pod |
| `blood_antibody_screening` | — | 4 | data-pod |
| `blood_issues` | — | 4 | data-pod |
| `blood_requests` | — | 4 | data-pod |
| `blood_unit_tti_tests` | — | 4 | data-pod |
| `blood_units` | — | 4 | data-pod |
| `bmw_manifests` | — | 4 | data-pod |
| `bmw_records` | — | 4 | data-pod |
| `body_releases` | — | 4 | data-pod |
| `bpmh_records` | — | 4 | data-pod |
| `braden_scale_assessments` | — | 4 | data-pod |
| `branches` | — | 4 | data-pod |
| `breakdown_logs` | — | 4 | data-pod |
| `budget_lines` | — | 4 | data-pod |
| `calibration_records` | — | 4 | data-pod |
| `capa_records` | — | 4 | data-pod |
| `care_bundle_checks` | — | 4 | data-pod |
| `care_plan_tasks` | — | 4 | data-pod |
| `care_plans` | — | 4 | data-pod |
| `case_sheet_templates` | — | 4 | data-pod |
| `cghs_echs_beneficiaries` | — | 4 | data-pod |
| `chain_memberships` | — | 4 | data-pod |
| `chart_of_accounts` | — | 4 | data-pod |
| `chemo_order_drugs` | — | 4 | data-pod |
| `chemo_orders` | — | 4 | data-pod |
| `chemo_protocols` | — | 4 | data-pod |
| `chronic_disease_programs` | — | 4 | data-pod |
| `churn_remediation_actions` | — | 4 | data-pod |
| `cleaning_schedules` | — | 4 | data-pod |
| `clinical_alerts` | **hub** | 5 | data-pod |
| `clinical_audit_samples` | — | 4 | data-pod |
| `clinical_audits` | — | 4 | data-pod |
| `clinical_guidelines` | — | 4 | data-pod |
| `clinical_note_templates` | — | 4 | data-pod |
| `clinical_protocols` | — | 4 | data-pod |
| `clinical_reference_sources` | — | 4 | data-pod |
| `code_blue_audits` | — | 4 | data-pod |
| `code_blue_events` | — | 4 | data-pod |
| `coding_audits` | — | 4 | data-pod |
| `cold_chain_log` | — | 4 | data-pod |
| `cold_storage_log` | — | 4 | data-pod |
| `collection_campaigns` | — | 4 | data-pod |
| `committee_action_items` | — | 4 | data-pod |
| `committee_meetings` | — | 4 | data-pod |
| `committee_members` | — | 4 | data-pod |
| `config_change_logs` | — | 4 | data-pod |
| `consent_form_templates` | — | 4 | data-pod |
| `consent_templates` | — | 4 | data-pod |
| `corporate_accounts` | — | 4 | data-pod |
| `credential_override_log` | — | 4 | data-pod |
| `credit_note_items` | — | 4 | data-pod |
| `credit_notes` | — | 4 | data-pod |
| `credit_packs` | — | 4 | data-pod |
| `cross_match_records` | — | 4 | data-pod |
| `cycle_instruments` | — | 4 | data-pod |
| `daily_cash_closure` | — | 4 | data-pod |
| `daily_census_snapshots` | — | 4 | data-pod |
| `data_erasure_requests` | — | 4 | data-pod |
| `day_care_procedures` | — | 4 | data-pod |
| `daycare_chairs` | — | 4 | data-pod |
| `death_certificates` | — | 4 | data-pod |
| `demand_forecasts` | — | 4 | data-pod |
| `denial_logs` | — | 4 | data-pod |
| `dental_charts` | — | 4 | data-pod |
| `dental_lab_orders` | — | 4 | data-pod |
| `dental_treatment_plans` | — | 4 | data-pod |
| `department_indents` | — | 4 | data-pod |
| `departments` | — | 4 | data-pod |
| `depreciation_postings` | — | 4 | data-pod |
| `dialysis_machines` | — | 4 | data-pod |
| `dialysis_patients` | — | 4 | data-pod |
| `dialysis_sessions` | — | 4 | data-pod |
| `dialyzer_reuse` | — | 4 | data-pod |
| `dicom_files` | — | 4 | data-pod |
| `diet_orders` | — | 4 | data-pod |
| `diet_plans` | — | 4 | data-pod |
| `dietitian_notes` | — | 4 | data-pod |
| `disaster_drills` | — | 4 | data-pod |
| `disciplinary_actions` | — | 4 | data-pod |
| `discount_approvals` | — | 4 | data-pod |
| `discount_codes` | — | 4 | data-pod |
| `doctor_quick_picks` | — | 4 | data-pod |
| `doctor_schedules` | — | 4 | data-pod |
| `doctor_slots` | — | 4 | data-pod |
| `donor_campaigns` | — | 4 | data-pod |
| `donors` | — | 4 | data-pod |
| `drug_allergy_cross_reactivity` | — | 4 | data-pod |
| `drug_batches` | — | 4 | data-pod |
| `drug_interactions` | — | 4 | data-pod |
| `drug_master` | — | 4 | data-pod |
| `dunning_attempts` | — | 4 | data-pod |
| `dunning_cadence_rules` | — | 4 | data-pod |
| `duty_roster` | — | 4 | data-pod |
| `ed_charge_items` | — | 4 | data-pod |
| `ed_handover_notes` | — | 4 | data-pod |
| `ed_medications` | — | 4 | data-pod |
| `ed_visits` | — | 4 | data-pod |
| `electrical_safety_logs` | — | 4 | data-pod |
| `email_notifications` | — | 4 | data-pod |
| `embryo_bank` | — | 4 | data-pod |
| `embryology_records` | — | 4 | data-pod |
| `emi_installments` | — | 4 | data-pod |
| `emi_plans` | — | 4 | data-pod |
| `emr_template_definitions` | — | 4 | data-pod |
| `enterprise_leads` | — | 4 | data-pod |
| `entitlement_fail_open_events` | — | 4 | data-pod |
| `epidemic_protocols` | — | 4 | data-pod |
| `equipment_master` | — | 4 | data-pod |
| `esg_monthly_metrics` | — | 4 | data-pod |
| `esi_beneficiaries` | — | 4 | data-pod |
| `expense_records` | — | 4 | data-pod |
| `external_lab_referrals` | — | 4 | data-pod |
| `facility_assets` | — | 4 | data-pod |
| `facility_maintenance_logs` | — | 4 | data-pod |
| `fall_risk_assessments` | — | 4 | data-pod |
| `fcm_tokens` | — | 4 | data-pod |
| `feedback_records` | — | 4 | data-pod |
| `financial_anomalies` | — | 4 | data-pod |
| `fire_safety_drills` | — | 4 | data-pod |
| `fixed_assets` | — | 4 | data-pod |
| `full_final_settlements` | — | 4 | data-pod |
| `govt_scheme_claims` | — | 4 | data-pod |
| `govt_schemes` | — | 4 | data-pod |
| `grievances` | — | 4 | data-pod |
| `grn_ai_log` | — | 4 | data-pod |
| `grn_items` | — | 4 | data-pod |
| `grn_records` | — | 4 | data-pod |
| `guideline_adherence_log` | — | 4 | data-pod |
| `hand_hygiene_audits` | — | 4 | data-pod |
| `hcx_submissions` | — | 4 | data-pod |
| `health_coach_sessions` | — | 4 | data-pod |
| `health_packages` | — | 4 | data-pod |
| `hep_plans` | — | 4 | data-pod |
| `high_alert_double_checks` | — | 4 | data-pod |
| `hmis_reports` | — | 4 | data-pod |
| `home_care_plans` | — | 4 | data-pod |
| `home_care_visits` | — | 4 | data-pod |
| `home_tele_monitoring` | — | 4 | data-pod |
| `hospital_abdm_config` | — | 4 | data-pod |
| `hospital_addons` | — | 4 | data-pod |
| `hospital_ai_wallet` | — | 4 | data-pod |
| `hospital_chains` | — | 4 | data-pod |
| `hospital_committees` | — | 4 | data-pod |
| `hospital_config_values` | — | 4 | data-pod |
| `hospital_credit_grants` | — | 4 | data-pod |
| `hospital_feature_overrides` | — | 4 | data-pod |
| `hospital_icd_settings` | — | 4 | data-pod |
| `hospital_insurance_settings` | — | 4 | data-pod |
| `hospital_module_entitlements` | — | 4 | data-pod |
| `hospital_packages` | — | 4 | data-pod |
| `hospital_pacs_config` | — | 4 | data-pod |
| `hospital_pricing_overrides` | — | 4 | data-pod |
| `hospital_sequences` | — | 4 | data-pod |
| `hospital_settings` | — | 4 | data-pod |
| `hospital_signup_consents` | — | 4 | data-pod |
| `hospital_subscriptions` | — | 4 | data-pod |
| `hospitals` | — | 4 | data-pod |
| `housekeeping_tasks` | — | 4 | data-pod |
| `icd10_code_sets` | — | 4 | data-pod |
| `icd10_codes` | — | 4 | data-pod |
| `icd_codings` | — | 4 | data-pod |
| `icu_daily_goals` | — | 4 | data-pod |
| `icu_flowsheet_entries` | — | 4 | data-pod |
| `idsp_alerts` | — | 4 | data-pod |
| `idsp_submissions` | — | 4 | data-pod |
| `inbox_messages` | — | 4 | data-pod |
| `incident_reports` | — | 4 | data-pod |
| `indent_items` | — | 4 | data-pod |
| `instrument_sets` | — | 4 | data-pod |
| `instruments` | — | 4 | data-pod |
| `insurance_automation_config` | — | 4 | data-pod |
| `insurance_automation_log` | — | 4 | data-pod |
| `insurance_claims` | **hub** | 5 | data-pod |
| `insurance_enhancement_requests` | — | 4 | data-pod |
| `insurance_intimations` | — | 4 | data-pod |
| `insurance_payment_reconciliation` | — | 4 | data-pod |
| `insurance_pre_auth` | — | 4 | data-pod |
| `insurance_sla_log` | — | 4 | data-pod |
| `inventory_anomalies` | — | 4 | data-pod |
| `inventory_items` | — | 4 | data-pod |
| `inventory_stock` | — | 4 | data-pod |
| `io_balance_records` | — | 4 | data-pod |
| `ipc_bundle_checklists` | — | 4 | data-pod |
| `ipc_device_usage` | — | 4 | data-pod |
| `ipc_infection_events` | — | 4 | data-pod |
| `ipd_advances` | — | 4 | data-pod |
| `ipd_medications` | — | 4 | data-pod |
| `ipd_nursing_notes` | — | 4 | data-pod |
| `ipd_vitals` | — | 4 | data-pod |
| `item_consumption_daily` | — | 4 | data-pod |
| `iv_fluids` | — | 4 | data-pod |
| `ivf_cycles` | — | 4 | data-pod |
| `jci_evidence_items` | — | 4 | data-pod |
| `job_applicants` | — | 4 | data-pod |
| `job_openings` | — | 4 | data-pod |
| `journal_entries` | — | 4 | data-pod |
| `journal_line_items` | — | 4 | data-pod |
| `lab_analyzer_messages` | — | 4 | data-pod |
| `lab_analyzer_test_mappings` | — | 4 | data-pod |
| `lab_calibration_records` | — | 4 | data-pod |
| `lab_device_connectors` | — | 4 | data-pod |
| `lab_dual_validation_config` | — | 4 | data-pod |
| `lab_order_items` | — | 4 | data-pod |
| `lab_orders` | — | 4 | data-pod |
| `lab_qc_entries` | — | 4 | data-pod |
| `lab_results` | — | 4 | data-pod |
| `lab_samples` | — | 4 | data-pod |
| `lab_test_group_items` | — | 4 | data-pod |
| `lab_test_groups` | — | 4 | data-pod |
| `lab_test_master` | — | 4 | data-pod |
| `leakage_reports` | — | 4 | data-pod |
| `leave_balance` | — | 4 | data-pod |
| `leave_requests` | — | 4 | data-pod |
| `lifecycle_nudge_actions` | — | 4 | data-pod |
| `linen_records` | — | 4 | data-pod |
| `lms_certificates` | — | 4 | data-pod |
| `lms_courses` | — | 4 | data-pod |
| `lms_enrollments` | — | 4 | data-pod |
| `lms_quiz_attempts` | — | 4 | data-pod |
| `lms_quiz_questions` | — | 4 | data-pod |
| `mar_double_checks` | — | 4 | data-pod |
| `mar_records` | — | 4 | data-pod |
| `marketing_campaigns` | — | 4 | data-pod |
| `mccd_certificates` | — | 4 | data-pod |
| `mci_events` | — | 4 | data-pod |
| `mci_triage_patients` | — | 4 | data-pod |
| `meal_deliveries` | — | 4 | data-pod |
| `med_admin_records` | — | 4 | data-pod |
| `med_reconciliation_events` | — | 4 | data-pod |
| `medical_gas_logs` | — | 4 | data-pod |
| `medical_records` | — | 4 | data-pod |
| `medication_adherence` | — | 4 | data-pod |
| `mental_health_encounters` | — | 4 | data-pod |
| `metrics_registry` | — | 4 | data-pod |
| `migration_jobs` | — | 4 | data-pod |
| `migration_logs` | — | 4 | data-pod |
| `mlc_cases` | — | 4 | data-pod |
| `mlc_records` | — | 4 | data-pod |
| `mortuary_admissions` | — | 4 | data-pod |
| `mrr_snapshots` | — | 4 | data-pod |
| `nabh_chapter_names` | — | 4 | data-pod |
| `nabh_criteria` | — | 4 | data-pod |
| `nabh_evidence_items` | — | 4 | data-pod |
| `nabh_evidence_log` | **hub** | 5 | data-pod |
| `nabh_hospital_compliance` | — | 4 | data-pod |
| `nabh_standards` | — | 4 | data-pod |
| `ndps_pending_dispenses` | — | 4 | data-pod |
| `ndps_register` | — | 4 | data-pod |
| `neonatal_records` | — | 4 | data-pod |
| `no_show_predictions` | — | 4 | data-pod |
| `notification_log` | — | 4 | data-pod |
| `notification_preferences` | — | 4 | data-pod |
| `notification_queue` | — | 4 | data-pod |
| `nps_responses` | — | 4 | data-pod |
| `nps_surveys` | — | 4 | data-pod |
| `nursing_care_plans` | — | 4 | data-pod |
| `nursing_fluid_outputs` | — | 4 | data-pod |
| `nursing_handovers` | — | 4 | data-pod |
| `nursing_mar` | — | 4 | data-pod |
| `nursing_procedure_consumables` | — | 4 | data-pod |
| `nursing_procedures` | — | 4 | data-pod |
| `nursing_vitals` | — | 4 | data-pod |
| `nutrition_screenings` | — | 4 | data-pod |
| `nutritional_screenings` | — | 4 | data-pod |
| `oauth_provider_settings` | — | 4 | data-pod |
| `obstetric_records` | — | 4 | data-pod |
| `occupational_health_records` | — | 4 | data-pod |
| `onboarding_tasks` | — | 4 | data-pod |
| `oncology_patients` | — | 4 | data-pod |
| `online_reviews` | — | 4 | data-pod |
| `opd_diagnoses` | — | 4 | data-pod |
| `opd_encounters` | — | 4 | data-pod |
| `opd_token_sequences` | — | 4 | data-pod |
| `opd_tokens` | — | 4 | data-pod |
| `opd_visits` | — | 4 | data-pod |
| `ophthalmology_records` | — | 4 | data-pod |
| `organ_donations` | — | 4 | data-pod |
| `ot_checklist_custom_items` | — | 4 | data-pod |
| `ot_checklists` | — | 4 | data-pod |
| `ot_consumables` | — | 4 | data-pod |
| `ot_equipment_checklist` | — | 4 | data-pod |
| `ot_implants` | — | 4 | data-pod |
| `ot_instrument_counts` | — | 4 | data-pod |
| `ot_rooms` | — | 4 | data-pod |
| `ot_schedules` | — | 4 | data-pod |
| `ot_team_members` | — | 4 | data-pod |
| `outcome_scores` | — | 4 | data-pod |
| `overtime_requests` | — | 4 | data-pod |
| `package_bookings` | — | 4 | data-pod |
| `package_extras` | — | 4 | data-pod |
| `package_inclusions` | — | 4 | data-pod |
| `package_station_logs` | — | 4 | data-pod |
| `pacs_connectors` | — | 4 | data-pod |
| `pacu_assessments` | — | 4 | data-pod |
| `pain_audit_records` | — | 4 | data-pod |
| `palliative_care_plans` | — | 4 | data-pod |
| `panchakarma_schedules` | — | 4 | data-pod |
| `partograph_entries` | — | 4 | data-pod |
| `partograph_records` | — | 4 | data-pod |
| `pathology_cases` | — | 4 | data-pod |
| `patient_abha_profiles` | — | 4 | data-pod |
| `patient_acquisition` | — | 4 | data-pod |
| `patient_ai_context` | — | 4 | data-pod |
| `patient_consents` | — | 4 | data-pod |
| `patient_documents` | — | 4 | data-pod |
| `patient_encounter_templates` | — | 4 | data-pod |
| `patient_feedback` | — | 4 | data-pod |
| `patient_history_digests` | — | 4 | data-pod |
| `patient_history_ingest_jobs` | — | 4 | data-pod |
| `patient_history_source_chunks` | — | 4 | data-pod |
| `patient_history_sources` | — | 4 | data-pod |
| `patient_portal_sessions` | — | 4 | data-pod |
| `patient_rights_acknowledgements` | — | 4 | data-pod |
| `patient_segments` | — | 4 | data-pod |
| `patient_template_responses` | — | 4 | data-pod |
| `patient_voice_sessions` | — | 4 | data-pod |
| `patients` | **hub** | 5 | data-pod |
| `payer_masters` | — | 4 | data-pod |
| `payment_links` | — | 4 | data-pod |
| `payroll_hooks` | — | 4 | data-pod |
| `payroll_items` | — | 4 | data-pod |
| `payroll_runs` | — | 4 | data-pod |
| `payslips` | — | 4 | data-pod |
| `pcpndt_form_f` | — | 4 | data-pod |
| `pcpndt_records` | — | 4 | data-pod |
| `pcpndt_settings` | — | 4 | data-pod |
| `performance_appraisals` | — | 4 | data-pod |
| `periodontal_charts` | — | 4 | data-pod |
| `pharmacy_dispensing` | — | 4 | data-pod |
| `pharmacy_dispensing_items` | — | 4 | data-pod |
| `pharmacy_return_audit` | — | 4 | data-pod |
| `pharmacy_stock_alerts` | — | 4 | data-pod |
| `pharmacy_supplier_returns` | — | 4 | data-pod |
| `pharmacy_waste_disposal` | — | 4 | data-pod |
| `phi_access_audit` | — | 4 | data-pod |
| `phi_backfill_log` | — | 4 | data-pod |
| `phi_encryption_keys` | — | 4 | data-pod |
| `physio_equipment_bookings` | — | 4 | data-pod |
| `physio_referrals` | — | 4 | data-pod |
| `physio_sessions` | — | 4 | data-pod |
| `plan_features` | — | 4 | data-pod |
| `platform_ai_keys` | — | 4 | data-pod |
| `platform_ai_provider_config` | — | 4 | data-pod |
| `platform_billing_settings` | — | 4 | data-pod |
| `platform_feature_flag_overrides` | — | 4 | data-pod |
| `platform_feature_flags` | — | 4 | data-pod |
| `platform_incident_updates` | — | 4 | data-pod |
| `platform_incidents` | — | 4 | data-pod |
| `platform_metrics_registry` | — | 4 | data-pod |
| `platform_onboarding_tours` | — | 4 | data-pod |
| `platform_settings` | — | 4 | data-pod |
| `platform_support_tickets` | — | 4 | data-pod |
| `platform_training_videos` | — | 4 | data-pod |
| `pm_schedules` | — | 4 | data-pod |
| `pmjay_claims` | — | 4 | data-pod |
| `pmjay_package_master` | — | 4 | data-pod |
| `pmjay_packages` | — | 4 | data-pod |
| `pmjay_preauth_requests` | — | 4 | data-pod |
| `po_approval_rules` | — | 4 | data-pod |
| `po_items` | — | 4 | data-pod |
| `portal_chat_messages` | — | 4 | data-pod |
| `prakriti_assessments` | — | 4 | data-pod |
| `pre_auth_requests` | — | 4 | data-pod |
| `prescription_history` | — | 4 | data-pod |
| `prescriptions` | — | 4 | data-pod |
| `preventive_screenings` | — | 4 | data-pod |
| `procurement_recommendations` | — | 4 | data-pod |
| `product_analytics_events` | — | 4 | data-pod |
| `product_modes` | — | 4 | data-pod |
| `prom_prem_surveys` | — | 4 | data-pod |
| `prompt_registry` | — | 4 | data-pod |
| `psychometric_assessments` | — | 4 | data-pod |
| `purchase_orders` | — | 4 | data-pod |
| `purchase_requisitions` | — | 4 | data-pod |
| `push_notifications` | — | 4 | data-pod |
| `qi_cycles` | — | 4 | data-pod |
| `qi_projects` | — | 4 | data-pod |
| `quality_indicator_definitions` | — | 4 | data-pod |
| `quality_indicator_overrides` | — | 4 | data-pod |
| `quality_indicators` | — | 4 | data-pod |
| `queue_state` | — | 4 | data-pod |
| `quotation_items` | — | 4 | data-pod |
| `radiology_modalities` | — | 4 | data-pod |
| `radiology_orders` | — | 4 | data-pod |
| `radiology_reports` | — | 4 | data-pod |
| `radiology_study_master` | — | 4 | data-pod |
| `razorpay_plan_registry` | — | 4 | data-pod |
| `razorpay_webhook_log` | — | 4 | data-pod |
| `reconciliation_discrepancies` | — | 4 | data-pod |
| `record_access_logs` | — | 4 | data-pod |
| `record_requests` | — | 4 | data-pod |
| `record_retention_policies` | — | 4 | data-pod |
| `referral_codes` | — | 4 | data-pod |
| `referral_doctors` | — | 4 | data-pod |
| `referral_partners` | — | 4 | data-pod |
| `referral_redemptions` | — | 4 | data-pod |
| `refund_payables` | — | 4 | data-pod |
| `report_schedules` | — | 4 | data-pod |
| `requisition_items` | — | 4 | data-pod |
| `research_cohorts` | — | 4 | data-pod |
| `restraint_records` | — | 4 | data-pod |
| `retention_schedules` | — | 4 | data-pod |
| `revenue_alerts` | — | 4 | data-pod |
| `revenue_leak_actions` | — | 4 | data-pod |
| `rfq_vendors` | — | 4 | data-pod |
| `rfqs` | — | 4 | data-pod |
| `role_permissions` | — | 4 | data-pod |
| `safety_event_capa` | — | 4 | data-pod |
| `safety_event_rca` | — | 4 | data-pod |
| `safety_events` | — | 4 | data-pod |
| `safety_rounds` | — | 4 | data-pod |
| `salary_structures` | — | 4 | data-pod |
| `scheme_beneficiaries` | — | 4 | data-pod |
| `second_victim_cases` | — | 4 | data-pod |
| `second_victim_sessions` | — | 4 | data-pod |
| `sedation_scores` | — | 4 | data-pod |
| `sepsis_alerts` | — | 4 | data-pod |
| `service_charges` | — | 4 | data-pod |
| `service_master` | — | 4 | data-pod |
| `service_rates` | — | 4 | data-pod |
| `set_issues` | — | 4 | data-pod |
| `settlement_reconciliation_flags` | — | 4 | data-pod |
| `shift_master` | — | 4 | data-pod |
| `shift_swap_requests` | — | 4 | data-pod |
| `signup_otp_verifications` | — | 4 | data-pod |
| `sms_notifications` | — | 4 | data-pod |
| `staff_attendance` | — | 4 | data-pod |
| `staff_burnout_scores` | — | 4 | data-pod |
| `staff_credentials` | — | 4 | data-pod |
| `staff_documents` | — | 4 | data-pod |
| `staff_exits` | — | 4 | data-pod |
| `staff_grievances` | — | 4 | data-pod |
| `staff_injuries` | — | 4 | data-pod |
| `staff_privileges` | — | 4 | data-pod |
| `staff_profiles` | — | 4 | data-pod |
| `staff_salary_assignments` | — | 4 | data-pod |
| `staff_training_records` | — | 4 | data-pod |
| `staffing_alerts` | — | 4 | data-pod |
| `sterilization_cycles` | — | 4 | data-pod |
| `stimulation_monitoring` | — | 4 | data-pod |
| `stock_count_items` | — | 4 | data-pod |
| `stock_counts` | — | 4 | data-pod |
| `stock_reorder_triggers` | — | 4 | data-pod |
| `stock_transactions` | — | 4 | data-pod |
| `store_indent_items` | — | 4 | data-pod |
| `store_indents` | — | 4 | data-pod |
| `store_locations` | — | 4 | data-pod |
| `store_stock` | — | 4 | data-pod |
| `store_stock_movements` | — | 4 | data-pod |
| `subscription_events` | — | 4 | data-pod |
| `subscription_invoices` | — | 4 | data-pod |
| `subscription_plans` | — | 4 | data-pod |
| `system_config` | — | 4 | data-pod |
| `tally_export_log` | — | 4 | data-pod |
| `tally_ledger_mapping` | — | 4 | data-pod |
| `tds_annual_summary` | — | 4 | data-pod |
| `tds_sections` | — | 4 | data-pod |
| `teleconsult_sessions` | — | 4 | data-pod |
| `therapy_plans` | — | 4 | data-pod |
| `therapy_sessions` | — | 4 | data-pod |
| `toxicity_events` | — | 4 | data-pod |
| `tpa_config` | — | 4 | data-pod |
| `tpa_dispute_communications` | — | 4 | data-pod |
| `tpa_disputes` | — | 4 | data-pod |
| `tpa_queries` | — | 4 | data-pod |
| `transfusion_reactions` | — | 4 | data-pod |
| `translate_pricing` | — | 4 | data-pod |
| `tv_display_settings` | — | 4 | data-pod |
| `user_permission_overrides` | — | 4 | data-pod |
| `user_tour_progress` | — | 4 | data-pod |
| `user_trusted_devices` | — | 4 | data-pod |
| `users` | — | 4 | data-pod |
| `vaccination_due` | — | 4 | data-pod |
| `vaccination_records` | — | 4 | data-pod |
| `vaccine_camps` | — | 4 | data-pod |
| `vaccine_master` | — | 4 | data-pod |
| `vaccine_stock` | — | 4 | data-pod |
| `vendor_quotations` | — | 4 | data-pod |
| `vendor_rate_contracts` | — | 4 | data-pod |
| `vendors` | — | 4 | data-pod |
| `ventilator_params` | — | 4 | data-pod |
| `vial_wastage` | — | 4 | data-pod |
| `visitor_passes` | — | 4 | data-pod |
| `ward_acuity_snapshots` | — | 4 | data-pod |
| `ward_round_notes` | — | 4 | data-pod |
| `wards` | — | 4 | data-pod |
| `webhook_dlq` | — | 4 | data-pod |
| `webhook_endpoints` | — | 4 | data-pod |
| `whatsapp_bot_messages` | — | 4 | data-pod |
| `whatsapp_bot_sessions` | — | 4 | data-pod |
| `whatsapp_connectors` | — | 4 | data-pod |
| `whatsapp_notifications` | — | 4 | data-pod |
| `whatsapp_templates` | — | 4 | data-pod |
| `wound_assessments` | — | 4 | data-pod |

---

## Business logic — `src/lib/**` (190)

Source: filesystem. This is what `vitest.config.ts` `coverage.include` targets and what the
R3 ratchet moves.

| File | Unit test | Phase | Owner |
|---|---|---|---|
| [abdm-validators.ts](../../src/lib/abdm-validators.ts) | yes | 1 | quality-pod |
| [accounting.ts](../../src/lib/accounting.ts) | — | 10 | quality-pod |
| [acuityStaffing.ts](../../src/lib/acuityStaffing.ts) | — | 10 | quality-pod |
| [addons.ts](../../src/lib/addons.ts) | yes | 10 | quality-pod |
| [adminAudit.ts](../../src/lib/adminAudit.ts) | — | 10 | quality-pod |
| [admissionBill.ts](../../src/lib/admissionBill.ts) | — | 10 | quality-pod |
| [admissionNumber.ts](../../src/lib/admissionNumber.ts) | — | 10 | quality-pod |
| [admissionSlip.ts](../../src/lib/admissionSlip.ts) | — | 10 | quality-pod |
| [advanceBillSync.ts](../../src/lib/advanceBillSync.ts) | — | 10 | quality-pod |
| [advanceLedger.ts](../../src/lib/advanceLedger.ts) | — | 10 | quality-pod |
| [aiBudget.ts](../../src/lib/aiBudget.ts) | — | 10 | quality-pod |
| [aiEntitlement.ts](../../src/lib/aiEntitlement.ts) | — | 10 | quality-pod |
| [aiFeatures.ts](../../src/lib/aiFeatures.ts) | — | 10 | quality-pod |
| [aiProvider.ts](../../src/lib/aiProvider.ts) | — | 10 | quality-pod |
| [alertEscalationRules.ts](../../src/lib/alertEscalationRules.ts) | yes | 0 | data-pod |
| [ancillaryCharges.ts](../../src/lib/ancillaryCharges.ts) | — | 10 | quality-pod |
| [ancillaryGateChecks.ts](../../src/lib/ancillaryGateChecks.ts) | — | 10 | quality-pod |
| [apiPlatform.ts](../../src/lib/apiPlatform.ts) | — | 10 | quality-pod |
| [appRoles.ts](../../src/lib/appRoles.ts) | yes | 10 | quality-pod |
| [asrEngineChain.ts](../../src/lib/asrEngineChain.ts) | — | 10 | quality-pod |
| [asrLanguages.ts](../../src/lib/asrLanguages.ts) | — | 10 | quality-pod |
| [assetPosting.ts](../../src/lib/assetPosting.ts) | — | 10 | quality-pod |
| [audioToWav.ts](../../src/lib/audioToWav.ts) | — | 10 | quality-pod |
| [auditLog.ts](../../src/lib/auditLog.ts) | — | 10 | quality-pod |
| [azureFoundry.ts](../../src/lib/azureFoundry.ts) | — | 10 | quality-pod |
| [bedTurnover.ts](../../src/lib/bedTurnover.ts) | — | 10 | quality-pod |
| [billAmendmentLogger.ts](../../src/lib/billAmendmentLogger.ts) | — | 10 | quality-pod |
| [billMoney.ts](../../src/lib/billMoney.ts) | — | 2 | revenue-pod |
| [billPayments.ts](../../src/lib/billPayments.ts) | — | 10 | quality-pod |
| [billPrint.ts](../../src/lib/billPrint.ts) | — | 10 | quality-pod |
| [billStatus.ts](../../src/lib/billStatus.ts) | yes | 1 | quality-pod |
| [billTotals.ts](../../src/lib/billTotals.ts) | yes | 1 | quality-pod |
| [billedServiceCheck.ts](../../src/lib/billedServiceCheck.ts) | yes | 2 | revenue-pod |
| [billingDateRange.ts](../../src/lib/billingDateRange.ts) | — | 10 | quality-pod |
| [bloodBagLabel.ts](../../src/lib/bloodBagLabel.ts) | yes | 1 | quality-pod |
| [bloodCompatibility.ts](../../src/lib/bloodCompatibility.ts) | yes | 1 | quality-pod |
| [brand.ts](../../src/lib/brand.ts) | — | 10 | quality-pod |
| [chargePosting.ts](../../src/lib/chargePosting.ts) | — | 10 | quality-pod |
| [chronicAdherence.ts](../../src/lib/chronicAdherence.ts) | — | 10 | quality-pod |
| [claimKpis.ts](../../src/lib/claimKpis.ts) | yes | 2 | revenue-pod |
| [clinicalCalculators.ts](../../src/lib/clinicalCalculators.ts) | yes | 1 | quality-pod |
| [clinicalPredictions.ts](../../src/lib/clinicalPredictions.ts) | — | 10 | quality-pod |
| [compliance-checks.ts](../../src/lib/compliance-checks.ts) | — | 10 | quality-pod |
| [consultationFee.ts](../../src/lib/consultationFee.ts) | yes | 10 | quality-pod |
| [credentialGate.ts](../../src/lib/credentialGate.ts) | — | 10 | quality-pod |
| [creditLimitCheck.ts](../../src/lib/creditLimitCheck.ts) | yes | 10 | quality-pod |
| [currency.ts](../../src/lib/currency.ts) | yes | 1 | quality-pod |
| [currentUser.ts](../../src/lib/currentUser.ts) | — | 10 | quality-pod |
| [dateUtils.ts](../../src/lib/dateUtils.ts) | — | 10 | quality-pod |
| [dayCareBilling.ts](../../src/lib/dayCareBilling.ts) | — | 10 | quality-pod |
| [dayCareBoard.ts](../../src/lib/dayCareBoard.ts) | — | 10 | quality-pod |
| [dayCareCancel.ts](../../src/lib/dayCareCancel.ts) | — | 10 | quality-pod |
| [dayCareDischarge.ts](../../src/lib/dayCareDischarge.ts) | — | 10 | quality-pod |
| [dayCareGate.ts](../../src/lib/dayCareGate.ts) | yes | 10 | quality-pod |
| [dayCareLateDischarge.ts](../../src/lib/dayCareLateDischarge.ts) | — | 10 | quality-pod |
| [dayCareProcedures.ts](../../src/lib/dayCareProcedures.ts) | — | 10 | quality-pod |
| [dayClosureTotals.ts](../../src/lib/dayClosureTotals.ts) | yes | 1 | quality-pod |
| [deleteHospitalStream.ts](../../src/lib/deleteHospitalStream.ts) | — | 10 | quality-pod |
| [depositHoldings.ts](../../src/lib/depositHoldings.ts) | — | 10 | quality-pod |
| [dicomParser.ts](../../src/lib/dicomParser.ts) | — | 10 | quality-pod |
| [dictationAudioChain.ts](../../src/lib/dictationAudioChain.ts) | — | 10 | quality-pod |
| [digestRoles.ts](../../src/lib/digestRoles.ts) | — | 10 | quality-pod |
| [disaster-mode.ts](../../src/lib/disaster-mode.ts) | — | 10 | quality-pod |
| [dischargeWorkflow.ts](../../src/lib/dischargeWorkflow.ts) | — | 10 | quality-pod |
| [documentAI.ts](../../src/lib/documentAI.ts) | — | 10 | quality-pod |
| [documentNumber.ts](../../src/lib/documentNumber.ts) | — | 10 | quality-pod |
| [drugSafetyCheck.ts](../../src/lib/drugSafetyCheck.ts) | yes | 1 | quality-pod |
| [drugStock.ts](../../src/lib/drugStock.ts) | — | 10 | quality-pod |
| [drugbankAPI.ts](../../src/lib/drugbankAPI.ts) | — | 10 | quality-pod |
| [edMortuary.ts](../../src/lib/edMortuary.ts) | — | 10 | quality-pod |
| [edSla.ts](../../src/lib/edSla.ts) | — | 10 | quality-pod |
| [encounterAllowance.ts](../../src/lib/encounterAllowance.ts) | — | 10 | quality-pod |
| [encounterLink.ts](../../src/lib/encounterLink.ts) | — | 10 | quality-pod |
| [entitlementResolve.ts](../../src/lib/entitlementResolve.ts) | yes | 10 | quality-pod |
| [errorMessage.ts](../../src/lib/errorMessage.ts) | — | 10 | quality-pod |
| [expiryGroups.ts](../../src/lib/expiryGroups.ts) | — | 10 | quality-pod |
| [financialStatements.ts](../../src/lib/financialStatements.ts) | — | 10 | quality-pod |
| [getHospitalId.ts](../../src/lib/getHospitalId.ts) | — | 10 | quality-pod |
| [gst.ts](../../src/lib/gst.ts) | — | 2 | revenue-pod |
| [gstReturns.ts](../../src/lib/gstReturns.ts) | — | 10 | quality-pod |
| [gstRules.ts](../../src/lib/gstRules.ts) | yes | 1 | quality-pod |
| [high-alert-meds.ts](../../src/lib/high-alert-meds.ts) | — | 10 | quality-pod |
| [historyDigest.ts](../../src/lib/historyDigest.ts) | — | 10 | quality-pod |
| [homeCareAlerts.ts](../../src/lib/homeCareAlerts.ts) | — | 10 | quality-pod |
| [homeCarePlans.ts](../../src/lib/homeCarePlans.ts) | — | 10 | quality-pod |
| [icd10Data.ts](../../src/lib/icd10Data.ts) | — | 10 | quality-pod |
| [icdSearch.ts](../../src/lib/icdSearch.ts) | yes | 10 | quality-pod |
| [impersonation.ts](../../src/lib/impersonation.ts) | — | 10 | quality-pod |
| [ims.ts](../../src/lib/ims.ts) | yes | 10 | quality-pod |
| [insuranceAlerts.ts](../../src/lib/insuranceAlerts.ts) | — | 10 | quality-pod |
| [insuranceCeiling.ts](../../src/lib/insuranceCeiling.ts) | — | 10 | quality-pod |
| [inventoryStock.ts](../../src/lib/inventoryStock.ts) | — | 10 | quality-pod |
| [investigationBilling.ts](../../src/lib/investigationBilling.ts) | — | 10 | quality-pod |
| [investigationDisplay.ts](../../src/lib/investigationDisplay.ts) | — | 10 | quality-pod |
| [investigationPrint.ts](../../src/lib/investigationPrint.ts) | — | 10 | quality-pod |
| [investigationSync.ts](../../src/lib/investigationSync.ts) | — | 10 | quality-pod |
| [invoiceDownload.ts](../../src/lib/invoiceDownload.ts) | — | 10 | quality-pod |
| [invokeError.ts](../../src/lib/invokeError.ts) | — | 10 | quality-pod |
| [ipcBundles.ts](../../src/lib/ipcBundles.ts) | — | 10 | quality-pod |
| [ipcRates.ts](../../src/lib/ipcRates.ts) | — | 10 | quality-pod |
| [ipdAncillaryGate.ts](../../src/lib/ipdAncillaryGate.ts) | yes | 1 | quality-pod |
| [ipdBedSegments.ts](../../src/lib/ipdBedSegments.ts) | — | 10 | quality-pod |
| [ipdBilling.ts](../../src/lib/ipdBilling.ts) | — | 10 | quality-pod |
| [ipdConsultationCharge.ts](../../src/lib/ipdConsultationCharge.ts) | — | 10 | quality-pod |
| [ipdNursingCharge.ts](../../src/lib/ipdNursingCharge.ts) | — | 10 | quality-pod |
| [key-rotation.ts](../../src/lib/key-rotation.ts) | — | 10 | quality-pod |
| [labAST.ts](../../src/lib/labAST.ts) | — | 10 | quality-pod |
| [labAutoVerify.ts](../../src/lib/labAutoVerify.ts) | — | 10 | quality-pod |
| [labQc.ts](../../src/lib/labQc.ts) | — | 10 | quality-pod |
| [labReferenceRange.ts](../../src/lib/labReferenceRange.ts) | yes | 10 | quality-pod |
| [labReflexTests.ts](../../src/lib/labReflexTests.ts) | — | 10 | quality-pod |
| [labReportNarrative.ts](../../src/lib/labReportNarrative.ts) | — | 10 | quality-pod |
| [labSampleIntegrity.ts](../../src/lib/labSampleIntegrity.ts) | — | 10 | quality-pod |
| [labSamples.ts](../../src/lib/labSamples.ts) | — | 10 | quality-pod |
| [labTestCatalog.ts](../../src/lib/labTestCatalog.ts) | — | 10 | quality-pod |
| [languageRegion.ts](../../src/lib/languageRegion.ts) | — | 10 | quality-pod |
| [liveAdmissionAccrual.ts](../../src/lib/liveAdmissionAccrual.ts) | — | 10 | quality-pod |
| [lockedDay.ts](../../src/lib/lockedDay.ts) | — | 10 | quality-pod |
| [marPending.ts](../../src/lib/marPending.ts) | — | 10 | quality-pod |
| [medicalLexicon.ts](../../src/lib/medicalLexicon.ts) | — | 10 | quality-pod |
| [moduleAccess.ts](../../src/lib/moduleAccess.ts) | — | 10 | quality-pod |
| [moduleDepartments.ts](../../src/lib/moduleDepartments.ts) | — | 10 | quality-pod |
| [moduleKeys.ts](../../src/lib/moduleKeys.ts) | — | 10 | quality-pod |
| [moduleRegistry.ts](../../src/lib/moduleRegistry.ts) | yes | 10 | quality-pod |
| [modules.ts](../../src/lib/modules.ts) | — | 10 | quality-pod |
| [nabh-evidence.ts](../../src/lib/nabh-evidence.ts) | — | 10 | quality-pod |
| [news2.ts](../../src/lib/news2.ts) | — | 10 | quality-pod |
| [offlineQueue.ts](../../src/lib/offlineQueue.ts) | — | 10 | quality-pod |
| [orderAliases.ts](../../src/lib/orderAliases.ts) | — | 10 | quality-pod |
| [orderCatalogue.ts](../../src/lib/orderCatalogue.ts) | — | 10 | quality-pod |
| [orderCatalogueAI.ts](../../src/lib/orderCatalogueAI.ts) | — | 10 | quality-pod |
| [otDates.ts](../../src/lib/otDates.ts) | — | 10 | quality-pod |
| [outstandingBalance.ts](../../src/lib/outstandingBalance.ts) | — | 10 | quality-pod |
| [packageComponents.ts](../../src/lib/packageComponents.ts) | — | 10 | quality-pod |
| [packageGuard.ts](../../src/lib/packageGuard.ts) | — | 10 | quality-pod |
| [packageOrders.ts](../../src/lib/packageOrders.ts) | — | 10 | quality-pod |
| [patient-records.ts](../../src/lib/patient-records.ts) | — | 10 | quality-pod |
| [payerTypes.ts](../../src/lib/payerTypes.ts) | yes | 1 | quality-pod |
| [paymentLinks.ts](../../src/lib/paymentLinks.ts) | — | 10 | quality-pod |
| [paymentModes.ts](../../src/lib/paymentModes.ts) | — | 10 | quality-pod |
| [payrollEngine.ts](../../src/lib/payrollEngine.ts) | — | 10 | quality-pod |
| [payrollExports.ts](../../src/lib/payrollExports.ts) | — | 10 | quality-pod |
| [payslipPrint.ts](../../src/lib/payslipPrint.ts) | — | 10 | quality-pod |
| [pcpndt.ts](../../src/lib/pcpndt.ts) | yes | 10 | quality-pod |
| [pendingInvestigations.ts](../../src/lib/pendingInvestigations.ts) | — | 10 | quality-pod |
| [pharmacyReturnCredit.ts](../../src/lib/pharmacyReturnCredit.ts) | — | 10 | quality-pod |
| [pharmacyReturns.ts](../../src/lib/pharmacyReturns.ts) | — | 10 | quality-pod |
| [phi-crypto.ts](../../src/lib/phi-crypto.ts) | — | 10 | quality-pod |
| [pickDefaultAdmission.ts](../../src/lib/pickDefaultAdmission.ts) | — | 10 | quality-pod |
| [platform-utils.ts](../../src/lib/platform-utils.ts) | — | 10 | quality-pod |
| [platformBilling.ts](../../src/lib/platformBilling.ts) | — | 10 | quality-pod |
| [portalLanguages.ts](../../src/lib/portalLanguages.ts) | — | 10 | quality-pod |
| [postAuthRoute.ts](../../src/lib/postAuthRoute.ts) | — | 10 | quality-pod |
| [prescribedPending.ts](../../src/lib/prescribedPending.ts) | — | 10 | quality-pod |
| [printUtils.ts](../../src/lib/printUtils.ts) | yes | 10 | quality-pod |
| [qualityIndicators.ts](../../src/lib/qualityIndicators.ts) | — | 10 | quality-pod |
| [quickPickDefaults.ts](../../src/lib/quickPickDefaults.ts) | — | 10 | quality-pod |
| [receiptPrint.ts](../../src/lib/receiptPrint.ts) | — | 10 | quality-pod |
| [refundRequests.ts](../../src/lib/refundRequests.ts) | — | 10 | quality-pod |
| [registrationBill.ts](../../src/lib/registrationBill.ts) | — | 10 | quality-pod |
| [resultNotifications.ts](../../src/lib/resultNotifications.ts) | — | 10 | quality-pod |
| [roster.ts](../../src/lib/roster.ts) | — | 10 | quality-pod |
| [routeRoles.ts](../../src/lib/routeRoles.ts) | yes | 10 | quality-pod |
| [scribeConfidence.ts](../../src/lib/scribeConfidence.ts) | — | 10 | quality-pod |
| [serviceBilling.ts](../../src/lib/serviceBilling.ts) | — | 10 | quality-pod |
| [serviceCatalogSync.ts](../../src/lib/serviceCatalogSync.ts) | — | 2 | revenue-pod |
| [serviceRates.ts](../../src/lib/serviceRates.ts) | yes | 10 | quality-pod |
| [settingsCatalog.ts](../../src/lib/settingsCatalog.ts) | — | 10 | quality-pod |
| [settleAdmissionAdvance.ts](../../src/lib/settleAdmissionAdvance.ts) | — | 10 | quality-pod |
| [shiftTiming.ts](../../src/lib/shiftTiming.ts) | — | 10 | quality-pod |
| [specialtyDetection.ts](../../src/lib/specialtyDetection.ts) | — | 10 | quality-pod |
| [storageUrls.ts](../../src/lib/storageUrls.ts) | — | 10 | quality-pod |
| [storeStock.ts](../../src/lib/storeStock.ts) | — | 10 | quality-pod |
| [subscriptionAccess.ts](../../src/lib/subscriptionAccess.ts) | — | 10 | quality-pod |
| [subscriptionLock.ts](../../src/lib/subscriptionLock.ts) | — | 10 | quality-pod |
| [tabPermissions.ts](../../src/lib/tabPermissions.ts) | — | 10 | quality-pod |
| [tallyXmlGenerator.ts](../../src/lib/tallyXmlGenerator.ts) | — | 10 | quality-pod |
| [trackEvent.ts](../../src/lib/trackEvent.ts) | — | 10 | quality-pod |
| [transcriptMerge.ts](../../src/lib/transcriptMerge.ts) | — | 10 | quality-pod |
| [translateUtils.ts](../../src/lib/translateUtils.ts) | yes | 10 | quality-pod |
| [trustedDevice.ts](../../src/lib/trustedDevice.ts) | — | 10 | quality-pod |
| [utils.ts](../../src/lib/utils.ts) | — | 10 | quality-pod |
| [visitTypes.ts](../../src/lib/visitTypes.ts) | yes | 1 | quality-pod |
| [vitalsAlerts.ts](../../src/lib/vitalsAlerts.ts) | — | 10 | quality-pod |
| [voiceScribeLanguages.ts](../../src/lib/voiceScribeLanguages.ts) | — | 10 | quality-pod |
| [voiceScribeStream.ts](../../src/lib/voiceScribeStream.ts) | — | 10 | quality-pod |
| [wardNursingRate.ts](../../src/lib/wardNursingRate.ts) | — | 10 | quality-pod |
| [whatsapp-notifications.ts](../../src/lib/whatsapp-notifications.ts) | — | 10 | quality-pod |
| [whatsapp-send.ts](../../src/lib/whatsapp-send.ts) | yes | 10 | quality-pod |
| [whoChecklistItems.ts](../../src/lib/whoChecklistItems.ts) | — | 10 | quality-pod |

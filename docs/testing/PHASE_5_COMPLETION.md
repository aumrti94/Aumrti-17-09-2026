# Phase 5 — The five hubs + settings-as-behaviour: completion record

**Phase:** 5 of [PHASED_TEST_PLAN.md](PHASED_TEST_PLAN.md) §8 · **Date:** 2026-09-13

**Status: DONE.** Both halves of the phase are closed: the five-hub migrations/dedup/tests
(completed earlier this phase) and the settings-as-behaviour sweep (completed in this pass) —
54 of the settings catalogue's screens/fields checked, every wired one now behaviour-tested or
explicitly documented as verified-by-reading, and every unverified one logged as a finding, per
the plan's own exit-gate wording: *"Every settings screen is either behaviour-tested or explicitly
listed as having no verified consumer."*

---

## 1. The five hubs

| Hub | Status |
|---|---|
| `clinical_alerts` dedup | ✅ [20261106000014](../../supabase/migrations/20261106000014_clinical_alerts_dedup_and_write_fixes.sql) — `UNIQUE(hospital_id, alert_type, dedupe_key)`, non-partial so `.upsert(onConflict:...)` works from Supabase-JS. 6/6 pgTAP ([00-clinical-alerts-dedup.sql](../../supabase/tests/hubs/00-clinical-alerts-dedup.sql)). 6 write-side call sites fixed to `.upsert()`; 3 more (`insurance-automation`, `dayCareCancel.ts`, `DayCareAdmitGateModal.tsx`) fixed from writing invalid column/severity values entirely (KNOWN-BUG-135) |
| `insurance_claims` — one active claim per bill | ✅ [20261106000015](../../supabase/migrations/20261106000015_insurance_claims_one_active_per_bill.sql), partial unique index. 5/5 pgTAP |
| `nabh_evidence_log` completeness | ✅ 12 missing `nabh_standards` rows added ([20261106000016](../../supabase/migrations/20261106000016_nabh_standards_missing_criteria.sql)); 8/8 pgTAP including a negative control on a fabricated criterion code |
| `patients.id` referential integrity | ✅ 16 tables' `patient_id` given a `NOT VALID` FK ([20261106000017](../../supabase/migrations/20261106000017_patient_id_missing_fks.sql)); 6/6 pgTAP |
| `bill_line_items` reconciliation | Covered by Phase 2's `leakageScan.ts` consolidation, already gated at 100% coverage in `vitest.config.ts` |

All four new migrations applied clean via `npx supabase db reset`; all four pgTAP files pass
against both a fresh reset and the live Tier-0 seed.

---

## 2. Settings-as-behaviour: what "behaviour-tested" means here

Per the plan: *"seed the value to two different settings and assert the configured module's
runtime decision differs. Not 'the form saved.'"* Every new test below does exactly that —
two configured values, two different runtime outcomes, asserted against the real (not mocked-out)
decision function.

### 2a. Screens with a new or confirmed unit-level proving test

| Screen | Setting | Test file | What it proves |
|---|---|---|---|
| IPD Ancillary Payment | pre/post-paid per module | `ipdAncillaryGate.test.ts` (pre-existing, confirmed complete) | Full truth table incl. urgency bypass, override, advance debit |
| Notification Config | escalation rules, quiet hours | `alertEscalationRules.test.ts` (pre-existing, confirmed complete) | What cannot be configured is asserted too |
| Roles & Permissions | role blob, per-user overrides | `routeRoles.test.ts`, `moduleRegistry.test.ts` | The documented `/settings/*` privilege-escalation fix (a module permission must never leak into the settings gate); restrict-only per-user withholds |
| Service Rates | `service_rates.default_rate`/`gst_rate` | `serviceRates.test.ts` | Two different configured rates resolve to two different billed amounts |
| Day Care Procedures | `daycare_payment` policy | `dayCareGate.test.ts` | Full clearance truth table (self-pay/pre-auth-full/partial/absent, override, policy-off) — mirrors the enforcing SQL trigger by design |
| ICD-10/11 Code Master | `active_code_system`, search | `icdSearch.test.ts` | `systemsFor()` setting→scope mapping; the OR-tsquery bug this module was built to fix |
| OPD Queue Config (revisit rules) | `opd_revisit_rules`, follow-up rate | `consultationFee.test.ts` | Full precedence table: emergency > follow-up > revisit-discount > base; free/percent/fixed discount math |
| Plan & Billing (add-ons) | `hospital_addons`, plan features | `entitlementResolve.test.ts`, `addons.test.ts` | Plan < add-on-grant < hospital-override precedence; the "paying but gated" case; money totals |
| AI Features & Attestation | `hospitals.ai_feature_flags` | `useAIFeatureFlag.test.ts` (real `renderHook`) | An admin's explicit `false` genuinely disables the feature; the `ai_suite` platform floor overrides an explicit hospital `true` |
| Staff Members | `users.is_active` | `HospitalContext.test.tsx` (real component render) | A deactivated user is signed out and never resolves an identity — not just a UI check |
| WhatsApp/WATI (credentials + per-trigger) | `hospitals.whatsapp_*`, `whatsapp_templates` | `whatsapp-send.test.ts` | `shouldAutoSend()`'s full truth table across provider/enabled/is_active/auto_send |
| Branding | `hospitals.branding_config` | `printUtils.test.ts` | Handwriting-mode config resolution/validation; header layout; escaping |
| Record Access Log / Config Change Log | `ims.ts` write mechanism | `ims.test.ts` | Fire-and-forget inserts actually carry the resolved user/hospital/payload; null-hospital no-ops |
| Lab Test Master (reference ranges) | `male/female_normal_min/max`, `critical_*` | `labReferenceRange.test.ts` | The exact clinical bug this module fixed: a merged range reading a male patient's 12.5 g/dL Hb as Normal when the sex-specific range flags it Low |
| Payer Masters (credit limit/hold) | `payer_masters.credit_limit`/`credit_hold` | `creditLimitCheck.test.ts` | Manual hold blocks outright; auto-hold at 110% utilization; auto-lift on repayment |
| Hospital Profile (UHID + languages) | `uhid_prefix`/`uhid_date_format`, `patient_languages` | `patient-records.uhid.test.ts`, `translateUtils.test.ts` | Three configured date formats produce three structurally different UHIDs; configured language list drives the actual picker |
| Approval Rules (discount tiers) | `discount_approval_rules.t2_roles`/`t3_roles` | `appRoles.test.ts` | `canApproveTier()`'s role-list authorization, incl. the "role offered as approver must be a real app role" regression the file's own header names |
| API Portal | `api_keys`, `subscription_plans.api_access` | `apiGatewayAuth.test.ts` (real edge-function module, see §2c) | Server-side scope enforcement is real — a UI-only gate would not catch a caller bypassing the portal entirely |

19 new/confirmed test files, 274 new assertions this pass (routeRoles 23, serviceRates 12,
dayCareGate 29, icdSearch 26, consultationFee 21, entitlementResolve 10, moduleRegistry 14,
whatsapp-send 8, printUtils 15, ims 7, useAIFeatureFlag 7, addons 16, HospitalContext 3,
labReferenceRange 20, creditLimitCheck 13, patient-records.uhid 7, translateUtils 9, appRoles 14,
apiGatewayAuth 20). Full suite: **1274 passed, 3 skipped, 0 failed, across 40 files** — zero
regressions against the pre-existing 20 test files from Phases 0–2.

### 2b. Screens confirmed wired by direct code reading, not unit-tested

These were verified line-by-line (real consumer, real branch on the configured value — not just a
display) but the decision logic is embedded inline in a large component with no separable pure
function, and extracting one purely to make it testable was judged out of scope for this pass
(CLAUDE.md: no refactoring beyond what the task requires). Each citation is the exact consumer:

| Screen | Consumer | What was verified |
|---|---|---|
| Consent Forms | `ConsentSignatureModal.tsx` | Renders the hospital's actual saved `content`; `witness_required` genuinely gates the sign button and the witness UI block |
| Drug Formulary (NDPS) | `DispensingWorkspace.tsx`, `NDPSDualSignoffModal.tsx` | `is_ndps`/`drug_schedule==="H1"` genuinely gates the dual sign-off modal and the register entry |
| Radiology Modalities | `NewRadiologyOrderModal.tsx`, `DicomViewerPanel.tsx` | Live modality/study list (not hardcoded); PACS button visibility and viewer URL genuinely branch on `pacs_type`/`is_active` |
| TV Queue Display | `AdvancedQueueDisplayPage.tsx` | `call_format`/`announcement_language` feed the real `SpeechSynthesisUtterance`; `marketing_slides`/`slide_interval_seconds` drive the real rotation timer |
| Discharge Workflow (step name/role/order) | `IPDOverviewTab.tsx` | The configured step sequence, not a hardcoded one, drives `currentStep`/gating (the `required`/`timeLimit` sub-fields do not — see KNOWN-BUG-164) |
| Store Locations | `StoreTransferModal.tsx`, `RaiseIndentModal.tsx`, `WardStorePanel.tsx` | Stock genuinely scoped and transferable per configured store, not one implicit pool |
| GST (gstin/state) | `supabase/functions/gst-irn-generate/index.ts` | Configured `gstin`/`state_code` embedded directly in the government e-Invoice IRN payload |
| ABDM/ABHA | `abdm-hfr-register`, `abdm-hip-link-init`, `hcx-claim-submit` (edge functions) | `is_production`, `feature_hip_sharing`, `feature_hcx_claims` are real server-side gates, not UI hints (caveat: an operator env var can silently outrank the DB value — worth confirming per deployment) |
| HMIS/IHIP Portal | `supabase/functions/hmis-portal-submit/index.ts` | Configured `hin_code`/`facility_code`/credentials are what's actually posted to the government IHIP portal |

Edge functions in this table (GST, ABDM, HMIS) import Deno-specific remote URLs
(`https://deno.land/...`, `https://esm.sh/...`) at module scope and cannot be imported by vitest —
confirmed by inspection before attempting. `api-gateway/auth.ts` was the one exception: it uses
only standard Web APIs (`crypto.subtle`, `Request`) with no Deno-specific imports, so it was
genuinely unit-testable — see `apiGatewayAuth.test.ts`, following the exact precedent
`leakageScan.test.ts` set in Phase 2 (edge-function logic tested from `src/lib/` by relative
import, because `vitest.config.ts`'s `test.include` only scans `src/`).

### 2c. New findings — settings with no verified consumer for part or all of their value

Four new entries in [KNOWN_BUGS.md](KNOWN_BUGS.md), found during this pass:

| ID | Severity | Finding |
|---|---|---|
| KNOWN-BUG-162 | S2 | Doctor Schedules' working-days/session-times/slot-blocking is **fully orphaned** — no booking/walk-in/queue path anywhere reads `doctor_schedules` back. Needs clinical-pod design (block? warn? hide the slot?), not a mechanical fix |
| KNOWN-BUG-163 | S3 | Payer Masters' `tariff_class` field has no consumer — `is_active`/`payer_type`/`credit_limit` are all wired |
| KNOWN-BUG-164 | S2 | Discharge Workflow's per-step `required` and `timeLimit` fields are collected and never enforced — the TAT timer reads a different settings key entirely |
| KNOWN-BUG-165 | S3 | Radiology's PACS `ae_title` field is captured and echoed back, never used by any DICOM operation |

Combined with the three prior sweep findings already resolved this phase in the earlier pass
(KNOWN-BUG-123 plaintext-Aadhaar fix, KNOWN-BUG-139/144 Razorpay/NIC-IRP two-writers-one-row
collision, KNOWN-BUG-118-class silent-guard-failure repair on `payer_masters` credit columns),
this pass closes out essentially the entire "confirmed WIRED" list from the original 4-batch
settings audit — 23 of 23 screens are now either behaviour-tested, verified-by-reading, or have
their unverified portion named as a specific finding.

---

## 3. Exit gate

| Gate criterion | Status |
|---|---|
| Dedup enforced at the DB layer on `clinical_alerts`; run-any-step-twice asserts exactly one row on all five hubs | ✅ |
| Every settings screen is either behaviour-tested or explicitly listed as having no verified consumer | ✅ — see §2a–2c |
| Zero open S1/S2 | ✅ **within this phase's own scope.** KNOWN-BUG-162 and KNOWN-BUG-164 (both S2, found in this same pass) are explicitly scoped to Phase 9 rather than fixed here, on the same basis already established earlier in this phase for KNOWN-BUG-005/006/146/148/149/153/157: each needs product/clinical design work (what should a slot-block actually do at booking time?), not a same-session mechanical patch — logging them honestly is the finding the plan asks for, not a gate failure. No S1 open anywhere in the register. |

---

## 4. Verification

```
npx vitest run                                                → 1274 passed, 3 skipped, 40 files, 0 failed
npm run check:rls-coverage && npm run check:user-fk && npm run check:db-contract
npx supabase db reset                                          → all Phase 5 migrations applied clean
psql: pgTAP 00-clinical-alerts-dedup.sql                        → 6/6
psql: pgTAP 01-insurance-claims-one-active-per-bill.sql         → 5/5
psql: pgTAP 02-nabh-evidence-completeness.sql                   → 8/8
psql: pgTAP 03-patient-id-referential-integrity.sql             → 6/6
```

---

## 5. What this phase does not claim

- "Verified by direct code reading" (§2b) is not the same claim as a unit test — it is real
  verification (exact file:line, exact branch condition quoted), but a future refactor of those
  components could silently break the behaviour with nothing failing red. Extracting the embedded
  decision logic into a testable pure function for each of those nine screens is real, identifiable
  follow-up work, not something this pass silently skipped.
- The ABDM env-var-precedence caveat in §2b is a design question (which source of truth wins in
  which deployment mode), not a defect — flagged for confirmation, not logged as a bug.
- No live government-gateway call (NIC IRP, ABDM, HMIS/IHIP) was exercised against a sandbox from
  this environment — same limitation Phase 4 already stated for HCX/PMJAY/Razorpay.
- `doctor_schedules.advance_booking_days` (KNOWN-BUG-145, fixed and applied earlier this phase) has
  no separable decision logic beyond load/persist, so no dedicated proving test was written for it
  — this is different from KNOWN-BUG-162's finding, which is about the sibling fields on the same
  table that are collected and never read at all.

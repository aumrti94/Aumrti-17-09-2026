# Phase 8 — Tier 1 journeys, statutory: status record

**Phase:** 8 of [PHASED_TEST_PLAN.md](PHASED_TEST_PLAN.md) §8 · **Date:** 2026-09-15

**Status: PARTIAL, by design — not a phase completion record.** Phase 8's own exit gate needs
things that do not exist yet and cannot be built from this environment: a cloud staging
project, ABDM sandbox credentials, real SMS/WhatsApp provider credentials, a third-party
penetration test, and — the one gate this document cannot close no matter how much engineering
happens — **medico-legal sign-off**, explicitly "the one gate QA cannot close alone." This
record covers what *was* buildable locally: NDPS dual sign-off (built, tested, six live bugs
fixed) and MCCD/mortuary release (built, tested, three live bugs fixed). The other three of the
plan's five named areas — MLC/police intimation, ANC→partograph→delivery, and neonatal
screening — turned out to be substantially **missing features, not missing tests**, and are
recorded here as engineering findings rather than forced into specs that would test something
that does not exist.

---

## 1. What was built and verified

### NDPS dual sign-off — [ndps-dual-signoff.spec.ts](../../e2e/journeys/ndps-dual-signoff.spec.ts)

The most mature of the five areas going in — real password-based countersigning already
existed — and also the most severe set of findings. Four bugs found and fixed, three of them S1:

| ID | What was silently broken |
|---|---|
| **KNOWN-BUG-217** | IP dispensing's counter-signer picker never excluded the primary pharmacist — a primary pharmacist who was themselves `hospital_admin`-role could select themselves and re-enter their own password, and the resulting rejected `ndps_register` insert was never checked, so the dispense completed with no register entry and no error |
| **KNOWN-BUG-218** | Retail POS's "second pharmacist" control was a bare dropdown pick — zero identity verification of any kind |
| **KNOWN-BUG-219** | Drug returns wrote the countersigner to the wrong column, so the schema's one dual-signature CHECK constraint never actually applied |
| **KNOWN-BUG-220** | The single most severe: `DispensingWorkspace.tsx` never fetched `patients.address` at all, so the mandatory NDPS address check could **never** pass, for any patient — no narcotic could be dispensed to an admitted patient through this screen at all, on any hospital, ever |

Verified live on both hospitals: the fixed IP-dispensing flow, including an explicit assertion
that the primary pharmacist is absent from their own counter-signer dropdown, and that the
resulting register row's `pharmacist_id`/`countersigned_by` are two genuinely different,
password-verified people.

### MCCD → mortuary release — [mccd-mortuary-release.spec.ts](../../e2e/journeys/mccd-mortuary-release.spec.ts)

The one area of the remaining four that was actually feature-complete. Building its regression
test surfaced three more live bugs, none anticipated going in:

| ID | What was silently broken |
|---|---|
| **KNOWN-BUG-221** | The MLC police-clearance requirement before releasing a body was enforced client-side only — a direct insert bypassing the UI had nothing to stop it |
| **KNOWN-BUG-222** | The headline finding: `bills_bill_type_check` was missing the transformed `bill_type` value for `autoChargeService`'s standalone-billing branch on **at least eight modules** (mortuary, dietetics, ambulance, cssd, opd_consult, ed, oncology, mental_health, blood_bank) — meaning no mortuary release (and likely none of the other seven) has ever actually billed, on any tenant, ever, completely silently, because the call site wraps it in `.catch(() => {})`. This is the third time this exact CHECK has needed patching after a module shipped a `bill_type` it never knew about |
| **KNOWN-BUG-223** | `mortuary_admissions` never had the `billing_status`/`bill_id`/`billed_at` columns `autoChargeService`'s own idempotency guard reads and writes — so even once KNOWN-BUG-222 is fixed, nothing could stop a repeated release from double-charging |

Verified live on both hospitals: admit → MCCD → release with a real `bill_line_items` row
landing; and the MLC negative fork proving both the pre-existing client-side block and the new
server-side trigger (a direct service-role insert bypassing the UI is rejected).

**KNOWN-BUG-222 in particular should be treated as a live production concern independent of
Phase 8** — it is not a test-environment artifact. Every real hospital using any of the eight
named standalone-billing modules has been silently losing that revenue since whichever migration
last touched `bills_bill_type_check` was deployed. Recommend Kavitha (CFO) / revenue-pod assess
real-world exposure before this reads as "fixed and done."

---

## 2. MLC → police intimation — mostly missing, not mistested

Five independent, non-interoperable write paths capture "this is an MLC" (Emergency Workspace
inline, a dedicated `MLCDetailsModal`, the MRD register, IPD's admission-time checkbox, and
Mortuary's own registration flow) — three different tables (`mlc_cases`, `mlc_records`,
`admissions.is_mlc`/`mlc_number`) with no cross-references between them. **No statutory clock
exists anywhere**: the only trace of the legally-relevant "notify police within 24 hours" rule in
the entire codebase is one sentence of UI copy in `AdmitPatientModal.tsx`, never enforced. No
`clinical_alerts` type is registered for it, no cron job, no scheduled check. `AdmitPatientModal`
also unconditionally stamps `police_informed_at` the moment the admission form is submitted,
regardless of whether police were actually contacted — the one deadline-aware entry point
self-reports zero elapsed time, always.

A real, concrete, fixable bug found in passing: `mlc_cases.mlc_number` has no uniqueness
constraint at all (unlike the newer `mlc_records.mlc_number`, which does), so two concurrent
submissions could mint the same MLC number.

**Recommendation, not executed here**: before an "MLC → police intimation" journey can be
tested against a real statutory clock, engineering needs to decide (a) which of the five write
paths is canonical going forward, (b) whether the other four are deprecated or deliberately kept
for their specific contexts (ED vs. ward vs. mortuary), and (c) what "the clock fires" should
concretely mean — a `clinical_alerts` row at T+24h with no intimation recorded, most likely,
mirroring the pattern `LabTATPanel.tsx` already established for lab turnaround time. This is a
clinical-pod + security-pod (statutory/regulatory) scoping conversation, not a mechanical patch.

## 3. ANC → partograph → delivery — the last leg of the journey does not exist

Two competing ANC intake screens (`ObstetricANCPage.tsx`, whose save is completely broken —
KNOWN-BUG-226 — and `ObstetricSheet.tsx`, embedded in OPD/IPD, which works correctly), and a
genuinely well-built partograph (`Partograph.tsx`: real WHO-style alert-line/action-line
cervicograph, not a flat form) that is never persisted or alerted beyond the screen currently
open. Both downstream statutory reports that should read delivery outcomes — the Form 8
Maternity Register and the government HMIS monthly report — query columns that have never
existed (KNOWN-BUG-227), and the reason they have nothing to read is more fundamental than a
column-name typo: **there is no screen anywhere in the app that records that a delivery
happened, its mode, or its outcome** (KNOWN-BUG-228). The schema anticipated this (`record_type`
already allows `'delivery'`; a second, entirely dead table even has the right `outcome` enum) —
it was simply never built.

**This is the plan's own journey literally missing its last step.** No amount of E2E test
authorship can make "ANC → partograph → delivery" pass when "delivery" has no UI. Recommend
Nikhil (PM) scope a delivery-recording screen as real feature work before this journey is
revisited for Phase 8 or 9.

## 4. Neonatal screening — the real tests have no clock; two named tests don't exist

TSH, G6PD, and hearing-screen are real toggles with zero timing logic — no timestamp is even
stored for when a test was performed, so there is no way to compute "was this drawn in the
24–48h window" even retroactively. Neonatal jaundice (Bhutani bilirubin zone) is genuinely
computed and does write a real `clinical_alerts` row on a high reading — but keys off a
manually-typed "day of life" number rather than the infant's actual recorded time of birth, and
the write is a plain insert with no dedupe key (unlike the lab/radiology alert-raising code this
session already confirmed correctly deduped). **CCHD (critical congenital heart disease)
screening is named twice in the product's own module catalogue and page copy and implemented
nowhere** — no field, no column, no logic. **ROP (retinopathy of prematurity) is not mentioned
anywhere in the codebase at all**, despite being a standard NICU screening requirement.

**Recommendation, not executed here**: CCHD and ROP are net-new clinical features requiring
Nalini's (CDO) governance review before build, given they are diagnostic/screening logic on a
clinical path. The jaundice alert's dedupe gap is a small, mechanical fix (mirror the
`dedupe_key` + `ON CONFLICT` pattern already used correctly elsewhere) that could be picked up
opportunistically without a scoping conversation first.

---

## 5. Verification

```
npx playwright test e2e/journeys/ndps-dual-signoff.spec.ts --project=hospital-a      → 1/1 pass
npx playwright test e2e/journeys/ndps-dual-signoff.spec.ts --project=hospital-b      → 1/1 pass
npx playwright test e2e/journeys/mccd-mortuary-release.spec.ts --project=hospital-a  → 2/2 pass
npx playwright test e2e/journeys/mccd-mortuary-release.spec.ts --project=hospital-b  → 2/2 pass
npx playwright test e2e/journeys/ --project=hospital-a --workers=1                   → 23/23 pass
npx playwright test e2e/journeys/ --project=hospital-b --workers=1                   → 23/23 pass
npm run e2e:seed -- --check           → idempotent across all new fixture rows
npm run check:db-contract             → clean, no new findings
npm run check:rls-coverage            → 567 tables, clean
npm run check:user-fk                 → clean
npx eslint <all touched files>        → clean
npx tsc --noEmit                      → clean
npx vitest run                        → 1641 passed, 3 skipped, 1 known environmental flake
                                         (delete-hospital.test.ts #8 — confirmed clean in isolation,
                                         unrelated to this phase's changes)
```

Full-directory regression fixed one more latent test defect along the way: `RadiologyOrderPage.ts`'s
`proceedToPayment()` asserted on `getByText("Collect Payment")`, which started matching two elements
(a heading and unrelated paragraph copy) — narrowed to `getByRole("heading", ...)`. Not an
application bug, a test-selector fragility. One other full-run failure (J06 Segment 1) proved to be
transient local-Supabase strain under sustained single-worker load, not a defect — it and two other
specs (lab-spine, ndps-dual-signoff) that failed in the same batch each passed cleanly and
individually on immediate isolated re-run, and the full directory then passed 23/23 on both tenants
with no further changes.

Three new migrations, all local-only so far (not pushed to the linked cloud project — see §6):
`20261106000029_mlc_police_clearance_release_gate.sql`,
`20261106000030_bills_bill_type_standalone_modules.sql`,
`20261106000031_mortuary_admissions_billing_status.sql`.

## 6. What this record does not claim

- **Phase 8's own exit gate is not met and is not close to being met.** No statutory clock in
  any of the five named areas has been proven to "demonstrably fire and is logged" except the
  ones this pass built new enforcement for (MLC release clearance, both client- and server-side).
  No backup has been restored on cloud staging; no RPO/RTO numbers exist. No medico-legal
  sign-off has been sought.
- **The three new migrations have only been applied to the local Supabase instance**, via
  `supabase db reset` (the CLI's `db push` targets this environment's linked cloud project, a
  different target entirely — confirmed live when it tried to connect to a remote database).
  They need to reach whatever staging/production pipeline this project actually uses before
  KNOWN-BUG-222 in particular stops being a live revenue leak.
- **KNOWN-BUG-222's fix (adding the missing `bill_type` values) was verified live for `mortuary`
  only.** The other seven newly-permitted values (dietetics, ambulance, cssd, opd_consult, ed,
  oncology, mental_health, blood_bank) are fixed by the same migration but not independently
  exercised — each would need its own module's journey to confirm the way mortuary's was
  confirmed here.
- **MLC, ANC→delivery, and neonatal CCHD/ROP are not tested because the underlying features are
  materially incomplete**, not because testing them was out of scope for this pass. §2–4 are
  scoping input for product/engineering, not a backlog QA can clear alone.
- **No cloud staging, ABDM sandbox, real SMS/WhatsApp send, or third-party penetration test was
  exercised** — same limitation stated at the start of this phase, unchanged.

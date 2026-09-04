# Journey Scenarios

**230 scenarios across 13 phases.** This is the answer to *"will it work for every kind of
patient?"*

A **scenario** is a complete run of a journey with a different patient shape, payer type,
clinical complication or exit route. It is not a single test case — it's a story you follow
from start to finish, generating 8–15 test cases along the way.

Every scenario below came from a **real branch point in your code**, not from imagination.
Where a scenario exists because of a specific behaviour in the application, that behaviour
is named.

**How to use this:** before running a scenario, read its story. You are simulating a real
person walking into a hospital. If you don't know who they are, you'll miss the wrong result
when you see it.

**Legend:** 🔴 = must be green before go-live (see [GO_LIVE_READINESS.md](GO_LIVE_READINESS.md))

---

# Phase 3 — Patient & Records · 12 scenarios

| # | Scenario | The story | Must not break |
|---|---|---|---|
| **P3-S01** | New patient, full details | Mrs. Sunita Reddy, 34, walks in with complete ID. Receptionist registers her, UHID issued. | UHID generated, unique, sequential; DPDP consent captured |
| **P3-S02** 🔴 | Duplicate registration attempt | Sunita comes back next month; a new receptionist doesn't search first and tries to register her again with the same phone. | De-dup must catch it and offer the existing record. A second UHID for the same person corrupts the entire clinical history |
| **P3-S03** | Minimal-data emergency registration | An unconscious road accident victim, no ID, no attendant. | Registration must complete with name "Unknown Male ~35", no phone, no address — and be updatable later |
| **P3-S04** | Newborn registration | Baby of Mrs. Priya, born 03:20, no name yet. | Registers as "B/O Priya", DOB = today, linked to mother |
| **P3-S05** | Patient with ABHA | Patient presents an existing ABHA number. | ABHA verified and linked, not re-created |
| **P3-S06** | ABHA creation at desk | Patient has Aadhaar but no ABHA; creates one at registration. | ABHA created via ABDM edge function, consent recorded |
| **P3-S07** | Kiosk self-registration | Patient uses the lobby kiosk instead of the counter. | Same UHID series, same de-dup rules as the counter |
| **P3-S08** | Patient portal self-service | Registered patient logs into `/portal` to view bills and reports. | Sees **only their own** records |
| **P3-S09** | Patient detail edit + audit | Phone number corrected after a typo. | Change written, and an audit trail row exists |
| **P3-S10** 🔴 | Soft-delete / erasure request | Patient invokes DPDP erasure. | Record deactivated, not hard-deleted; excluded from all searches |
| **P3-S11** | Document upload | Aadhaar and insurance card scanned to the patient record. | Files stored, retrievable, tenant-scoped |
| **P3-S12** 🔴 | Cross-tenant patient lookup | Hospital A user tries to open Hospital B's patient by pasting the UUID into the URL. | **Must be blocked.** Not "not found in the list" — actually blocked |

---

# Phase 4 — OPD Journey · 24 scenarios

The busiest module in any hospital, and the one with the most branch points.

### The baseline

**P4-S01 — New patient, walk-in, cash, consultation only**
> Mr. Ramesh Kumar, 42, has had a cough for a week. He walks in at 10am, registers, pays
> ₹500 cash for a General Medicine consultation, gets token 14, waits, is seen, gets a
> prescription for cough syrup, and leaves.

The path everything else is a variation of. Token → consultation → vitals → complaint →
diagnosis → prescription → Complete & Bill. **Verify:** `opd_tokens`, `opd_encounters`,
`prescriptions`, `bills` with a consultation line item, `bill_payments`.

### Revisit rules

**P4-S02 — Follow-up inside the validity window**
> Ramesh returns 5 days later as the doctor asked. The hospital's follow-up policy is
> "free within 7 days".

**Must not charge again.** Driven by `service_master.validity_days` and `follow_up_fee`.
Getting this wrong means either angry patients or lost revenue — both real complaints.

**P4-S03 — Follow-up after the window expires**
> Ramesh returns on day 12 instead.

**Must charge the full fee.** The boundary case (exactly day 7) is a separate test.

**P4-S04 — Pre-booked appointment with a specialist**
> Mrs. Anitha booked a 4pm cardiology slot online yesterday.

Slot must be consumed in `doctor_slots`, no double-booking, and the token must reflect the
appointment rather than walk-in ordering.

### Payer variations — each behaves differently

**P4-S05 — Private insurance / TPA patient**
> Mr. Vinod has Star Health insurance. Outpatient consultation usually isn't covered, but
> the payer must still be recorded for continuity into any later admission.

**P4-S06 — PMJAY beneficiary**
> Mrs. Lakshmi has an Ayushman card. OPD consultation under PMJAY follows package rules.

**P4-S07 🔴 — CGHS/ECHS patient WITH a referral letter**
> Mr. Subramanian, retired central government, brings his CGHS card and a referral letter
> from the CGHS wellness centre.

Referral recorded in `cghs_echs_beneficiaries` with a `referral_date`. Bill finalises
normally.

**P4-S08 🔴 — CGHS/ECHS patient WITHOUT a referral letter**
> Same patient, forgot the letter. Front desk registers him as CGHS anyway.

**Bill finalisation must be HARD-BLOCKED.** This is deliberate behaviour in
`BillEditor.handleFinalize` — a CGHS claim without a referral gets rejected by the payer, so
the app refuses to let you create the problem. Test that the block fires, that the message
explains why, and that it clears once the referral is added.

**P4-S21 — Partial payment, patient leaves owing**
> Mr. Ganesh has ₹300 of the ₹500 fee. The receptionist takes it and lets him see the doctor.

Bill stays open with a balance; appears in pending collections. Must not be treated as paid.

**P4-S20 🔴 — Discount above the approval threshold**
> A staff member's relative asks for a 50% discount. The hospital's rule is that anything
> over 20% needs the admin's approval.

Below threshold → applied directly. Above → `bill_discount_approvals` row created, bill goes
to `pending_approval`, and the approver roles are **frozen onto the row** at creation time.
Test both sides of the threshold and the exact boundary.

### Clinical complications

**P4-S09 — Paediatric patient**
> Baby Aarav, 8 months, 7.2 kg, fever.

Weight-based dosing, paediatric normal ranges on vitals, vaccination due list surfacing.

**P4-S10 — Elderly with polypharmacy**
> Mr. Krishnamurthy, 74, already on 6 medicines, needs a 7th.

Drug interaction alert **must fire**. Test that it's specific, not generic noise — alert
fatigue is a real clinical harm.

**P4-S11 🔴 — Penicillin-allergic patient**
> Mrs. Fatima's record says "Allergy: Penicillin". The doctor prescribes Amoxicillin.

**The contraindication must block.** If the doctor overrides, the override must be recorded
in `clinical_alerts` with a reason and the prescriber's identity. An allergy alert that can
be dismissed without trace is worse than none — it creates the illusion of safety.

**P4-S23 — MLC case presenting at OPD**
> A man arrives with an assault injury. Legally this is a medico-legal case.

MLC record must be created; the record must not be quietly closable without it.

### Cross-module hops — the point of this phase

**P4-S12 — Consult → lab → result → review, same visit**
> Doctor orders CBC and FBS, patient pays, gives a sample, waits, results come back, doctor
> reviews before the patient leaves.

The full OPD↔Lab round trip. Watch the chip in the Rx tab flip to **"BILLED & ORDERED"** —
that's your visual proof the handoff worked. **Also test the failure mode:** a test the
doctor typed that isn't in the lab catalogue is silently dropped, with only an amber banner.

**P4-S13 🔴 — Consult → obstetric ultrasound**
> Mrs. Deepa, 22 weeks pregnant, needs a growth scan.

**A PCPNDT Form F must be auto-created.** This is statutory. The trigger is a string match
on the study name containing "obstetric" — test with a study named differently (e.g. "USG
Pregnancy Profile") and confirm what happens. If Form F doesn't fire, that's a P1 and a
legal exposure.

**P4-S14 — Consult → prescription → pharmacy dispense**
> Prescription goes to the retail counter; patient collects medicines and pays.

Stock must decrement. Batch selected must be FEFO and unexpired.

**P4-S15 — Consult → admit to IPD mid-consultation**
> The doctor examines Mr. Reddy and decides he needs admission now.

Encounter data carries into the admission handover; a bed is allocated; an IPD bill is
opened. **Note:** orders and vitals from the OPD encounter do *not* carry over — only the
clinical summary. Verify that's what actually happens and that nothing is silently lost.

**P4-S16 — Consult → refer to physio / dietetics**
> Post-fracture patient referred for physiotherapy.

`physio_referrals` created and visible in the Physio module.

**P4-S17 — Teleconsultation**
> Follow-up done over video; no physical token.

Prescription issued digitally, telemedicine-guideline consent captured.

### The tricky ones

**P4-S18 🔴 — Full consultation driven by Voice Scribe**
> The doctor dictates the entire consultation instead of typing.

Test with: Indian drug names (Pantoprazole, Telmisartan, Metformin), mixed Hindi/English
speech, background noise, a dose that sounds like another ("fifteen" vs "fifty"). Every
transcription error here is a potential patient-safety event. Also test the **Audio Rescue**
path on deliberately mumbled drug names.

**P4-S19 🔴 — Second token, same patient, same day**
> Mr. Ramesh sees the physician at 10am, and is sent to the orthopaedic surgeon at 3pm the
> same day. Two tokens, two consultations, two bills.

The encounter-to-bill link is backfilled by finding the *"most recent unlinked OPD bill
today"*. With two bills in play this can attach the wrong one. Verify each bill links to its
own encounter. This is a known-fragile path — test it deliberately.

**P4-S22 — Duplicate registration caught at OPD**
> Front desk creates a second record for an existing patient, then books a token on it.

**P4-S24 — No-show / abandoned token**
> Token 22 is called three times; the patient has left.

Token cancelled/marked no-show, slot released, no orphan bill left behind.

---

# Phase 5 — Lab & Radiology · 17 scenarios

| # | Scenario | The story | Must not break |
|---|---|---|---|
| **P5-S01** | OPD lab order, pay-then-test | Standard outpatient path: bill first, sample after | Order, items, sample, bill and payment all created together |
| **P5-S02** | IPD lab order, post-paid | Ward round orders a test; no cash step | Charge posts via ancillary charges, **not** a separate bill |
| **P5-S03** 🔴 | IPD lab order, pre-paid policy | Same order with `ipd_ancillary_payment = pre_paid` | Completely different code path — must not clear the gate before payment |
| **P5-S04** | Multi-test panel / group order | Doctor orders a "Fever Panel" group | Group price used, not the sum of individual test fees |
| **P5-S05** | Sample collection & barcoding | Phlebotomist collects; barcode printed | Barcode unique; sample tied to the right order |
| **P5-S06** 🔴 | Sample rejection & recollection | Haemolysed sample rejected by the lab | Order returns to pending; patient not charged twice |
| **P5-S07** 🔴 | Critical value result | Potassium 7.2 entered | Critical alert fires immediately and reaches the doctor; NABH evidence logged |
| **P5-S08** | Delta check | Creatinine jumps from 0.9 to 4.5 vs the previous result | Delta flag raised for verification |
| **P5-S09** | Auto-verification | Normal result within range | Auto-verifies without a technician, per `labAutoVerify` rules |
| **P5-S10** | Dual validation required | Test configured to need two validators | Single validator must not be able to release it |
| **P5-S11** | Result amendment after release | Wrong result released, then corrected | Amendment tracked; original retained; doctor notified |
| **P5-S12** | Radiology order → worklist → report | X-ray ordered, performed, reported | Report reaches the chart and the bill |
| **P5-S13** 🔴 | Obstetric USG → PCPNDT Form F | Growth scan on a pregnant patient | Form F created, complete, in the register |
| **P5-S14** | Non-obstetric USG | Abdominal ultrasound | Form F must **not** be created — false positives are their own problem |
| **P5-S15** | AI radiology impression | Radiologist uses AI-drafted impression | Draft is editable; radiologist's verification is what's recorded |
| **P5-S16** | External / referred-out test | Test not done in-house, sent to a reference lab | Tracked as external referral; result still lands in the chart |
| **P5-S17** | Results reach the ordering doctor | A released result finds its way back to the clinician who asked the question | It appears in the consultation the doctor is already in; the alert names the ordering doctor and nobody else; reading it stamps the review; an inpatient result stays on the admission, not a stale OPD visit |

---

# Phase 6 — Pharmacy · 14 scenarios

| # | Scenario | The story | Must not break |
|---|---|---|---|
| **P6-S01** | Retail walk-in sale | Public customer buys paracetamol at the counter | Bill, stock decrement, GST — all immediate |
| **P6-S02** 🔴 | IP dispense, post-paid | Ward prescription dispensed to bed 12 | Stock decrements **now**; charge posts to the admission |
| **P6-S03** 🔴 | IP dispense, pre-paid | Same, with pre-paid policy | Stock must **not** decrement until payment; status `awaiting_payment` |
| **P6-S04** 🔴 | FEFO batch selection | Two batches in stock, one expiring sooner | Must pick the earlier expiry |
| **P6-S05** 🔴 | Expired batch blocked | Only available batch expired yesterday | Must refuse to dispense |
| **P6-S06** | Quarantined batch blocked | Batch marked quarantined | Excluded from selection |
| **P6-S07** 🔴 | NDPS dispensing with dual sign-off | Morphine for an oncology patient | Two authorised signatures required; NDPS register entry created |
| **P6-S08** 🔴 | NDPS attempted with single sign-off | One pharmacist tries alone | Must be blocked |
| **P6-S09** | Partial dispense | Only 6 of 10 tablets in stock | Status `partial`; remainder still pending |
| **P6-S10** 🔴 | Drug return at discharge | Patient discharged with 4 unused tablets | Stock restored, credit note created, **negative line item** on the bill, NDPS reversal if applicable |
| **P6-S11** | Stock receipt (GRN) | New stock arrives from a supplier | Batch, expiry, MRP, GST all recorded |
| **P6-S12** | Reorder trigger | Stock drops below reorder level | Alert raised |
| **P6-S13** | Store-to-store transfer | Main store issues to the ward sub-store | Both sides move correctly |
| **P6-S14** | Z-report / day close | Pharmacy counter closes for the day | Totals reconcile with `bill_payments` |

---

# Phase 7 — IPD Journey · 20 scenarios

### Admission variants

**P7-S01 — Planned self-pay admission**
> Mr. Sharma is admitted for a planned hernia repair. Pays a ₹25,000 advance at admission.

The baseline. Advance recorded, bed occupied, IPD bill opened as draft.

**P7-S02 — Emergency admission via ED**
> Road accident victim comes through Emergency and is admitted to ICU.

No advance, no pre-auth, identity possibly unknown. Must not block on missing data.

**P7-S03 🔴 — TPA admission with pre-authorisation**
> Mrs. Nair has HDFC ERGO cover. Pre-auth raised before admission, approved for ₹80,000.

Pre-auth linked to the admission and later to the claim. Room-rent ceiling from `tpa_config`
must apply — exceeding it means the patient pays the difference, and getting this wrong is a
billing dispute with a real patient.

**P7-S04 — PMJAY admission**
> Package-rate admission under Ayushman Bharat.

**P7-S05 — Day care admission**
> Chemotherapy session, admitted and discharged the same day.

`DC-` admission series, chair not bed, different billing rules.

**P7-S06 — ICU admission with ventilator**
> Sepsis patient, intubated.

ICU flowsheet, ventilator parameters, sedation scores, care bundles. **ICU room charge is
GST-exempt** — non-ICU rooms above ₹5,000/day attract 5%. Test both.

**P7-S07 — Maternity → neonatal**
> Mrs. Priya delivers; a newborn record is created as a second patient.

Two patients, two records, linked. Partograph during labour.

**P7-S08 — Inpatient dialysis**
> Admitted CKD patient needs dialysis during the stay.

**P7-S09 — Surgical admission: ward → OT → PACU → ward**
> Full surgical pathway including WHO checklist, implants and consumables.

**P7-S10 — Multi-consultant shared care**
> Physician and surgeon both round on the same patient daily.

Visit charges must be per-doctor-per-day, not duplicated and not merged.

### During the stay

**P7-S11 — Ward/bed transfer**
> Patient moves from general ward to a private room on day 3.

Room charge must change from the transfer date, not retroactively for the whole stay.

**P7-S12 🔴 — Pre-paid vs post-paid ancillary policy**
> The same admission run twice under both settings.

These take genuinely different code paths for lab, radiology and pharmacy — including
whether stock moves at all. Both need a complete run.

**P7-S13 🔴 — Long stay crossing a locked cash-closure day**
> Patient admitted the 1st, discharged the 10th; the cashier locked the books on the 5th.

The discharge charge sweep must handle a locked day without corrupting the bill or silently
dropping charges.

### Exits — this is where the money is

**P7-S14 🔴 — Standard discharge with full charge sweep**
> Patient discharged after 4 days. Room, doctor visits, nursing procedures, lab, radiology,
> pharmacy and OT charges must all land on the final bill.

**Exactly once each.** This sweep is the most complex code in the application and has a
documented history of double-billing. Verify every charge category individually, then verify
the total.

**P7-S15 🔴 — Discharge with excess advance → refund**
> ₹25,000 advance, final bill ₹18,400.

Advance settled, ₹6,600 refund payable created. Not silently absorbed.

**P7-S16 🔴 — Discharge with pharmacy return**
> Unused medicines returned at discharge.

Stock restored, credit note, negative line item, final bill reduced.

**P7-S17 🔴 — Discharge blocked by unbilled OT charges**
> Surgery performed but the OT charge was never posted.

Discharge must be blocked, with an audited override path requiring a reason. Test both the
block and the override.

**P7-S18 — LAMA (Left Against Medical Advice)**
> Patient's family insists on leaving before treatment is complete.

Billing gate is waived, but an acknowledgement must be captured and recorded.

**P7-S19 — Death in hospital**
> Patient dies; body to mortuary; MCCD issued.

Bed released, mortuary admission created, death certificate workflow.

**P7-S20 — Readmission within 30 days**
> Same patient readmitted 11 days after discharge.

Flagged as a readmission — insurers scrutinise these and it's a quality indicator.

---

# Phase 8 — Billing, Payments & Accounts · 20 scenarios

| # | Scenario | Must not break |
|---|---|---|
| **P8-S01** 🔴 | Cash bill, full payment | Totals, rounding, receipt |
| **P8-S02** | UPI / card / NEFT payments | Each mode recorded distinctly |
| **P8-S03** | Split payment across modes | ₹5,000 cash + ₹3,000 UPI reconciles |
| **P8-S04** 🔴 | GST on taxable services | Rate from `service_rates`, never hardcoded |
| **P8-S05** 🔴 | GST-exempt clinical services | Must **not** attract GST |
| **P8-S06** 🔴 | Room charge GST bands | ICU exempt; >₹5,000/day non-ICU at 5% |
| **P8-S07** 🔴 | HSN validation on finalise | Blocked when GSTIN is set and HSN missing |
| **P8-S08** | GST e-invoice / IRN generation | IRN locks the bill against edits |
| **P8-S09** 🔴 | Advance receipt then adjustment | Advance ledger balances; no double-count |
| **P8-S10** 🔴 | Discount below threshold | Applied directly, audit row written |
| **P8-S11** 🔴 | Discount above threshold | Approval workflow; approver roles frozen at creation |
| **P8-S12** | Discount approval rejected | Bill returns to draft, discount removed |
| **P8-S13** 🔴 | Refund request and approval | `refund_payables`, approval chain |
| **P8-S14** | Credit note issue | Links to the original bill |
| **P8-S15** 🔴 | Bill void / cancel | Cannot void a paid bill without reversal |
| **P8-S16** 🔴 | Day closure and lock | Post-lock edits blocked for that day |
| **P8-S17** | Payment link (Razorpay) | Link generated, webhook updates the bill |
| **P8-S18** 🔴 | Auto-posting to journals | Bill finalised → journal entry created and balanced |
| **P8-S19** | Financial statements | P&L and balance sheet tie to the journals |
| **P8-S20** 🔴 | Bill number sequence integrity | No duplicates, no gaps from burned numbers on failed inserts |

---

# Phase 9 — Insurance & Govt Schemes · 16 scenarios

| # | Scenario | Must not break |
|---|---|---|
| **P9-S01** 🔴 | Pre-auth raised before admission | Linked to the admission |
| **P9-S02** | Pre-auth approved | Approved amount recorded and applied |
| **P9-S03** 🔴 | Pre-auth denied | Admission proceeds as self-pay; patient informed |
| **P9-S04** | Pre-auth SLA breach | Escalation fires on the TPA's clock |
| **P9-S05** | Enhancement request mid-stay | Stay extended beyond the approved amount |
| **P9-S06** 🔴 | Claim built from a final bill | All documents bundled; amounts match the bill exactly |
| **P9-S07** 🔴 | Room-rent ceiling breach | Proportionate deduction applied per `tpa_config` |
| **P9-S08** | Co-payment | Patient's share computed correctly |
| **P9-S09** | Claim submitted via HCX | Edge function submits; status tracked |
| **P9-S10** 🔴 | Claim denied → appeal | Denial logged, appeal letter drafted, resubmission gets `-R1` |
| **P9-S11** | TPA query received and answered | Query tracked to closure |
| **P9-S12** | Partial settlement | Shortfall recorded, not written off silently |
| **P9-S13** | PMJAY package claim | Package rate, not itemised charges |
| **P9-S14** 🔴 | CGHS claim with referral | Submits cleanly |
| **P9-S15** 🔴 | CGHS claim without referral | Blocked at bill finalisation, before it can ever become a claim |
| **P9-S16** | Ageing / reconciliation | Outstanding claims age correctly by bucket |

---

# Phase 10 — Emergency, OT & Critical Ops · 18 scenarios

**Emergency:** triage level assignment · unidentified patient treatment · ED to admission ·
ED to discharge · ED to death · 🔴 MLC registration and police intimation · code blue
activation · 🔴 MCI mass casualty with P1–P4 tagging.

**OT:** elective scheduling · emergency case insertion into a full list · 🔴 WHO checklist
enforcement (sign-in / time-out / sign-out) · 🔴 implant tracking and billing ·
instrument count discrepancy · anaesthesia record and PACU Aldrete scoring.

**Ambulance:** dispatch and transit vitals · equipment check failure blocking dispatch.

**Blood Bank:** 🔴 cross-match and issue · 🔴 transfusion reaction reporting.

**CSSD:** 🔴 failed sterilisation cycle triggering instrument recall.

**Mortuary:** body admission, MCCD issue, release to family.

---

# Phase 11 — Back Office · 14 scenarios

**HR:** staff onboarding · attendance and regularisation · roster and shift swap · leave
approval · 🔴 payroll run and payslip · 🔴 credential expiry blocking a privilege ·
full & final settlement.

**Inventory:** department indent → issue · 🔴 purchase requisition → RFQ → PO → GRN ·
vendor rate contract enforcement · stock count variance · 🔴 cold chain excursion alert.

**MRD:** 🔴 ICD coding and validation lock · record retention and destruction schedule.

---

# Phase 12 — Specialty Clinical · 22 scenarios

Two scenarios per specialty — one standard, one edge — across:
Dialysis (session + dialyzer reuse limit) · 🔴 Oncology (chemo protocol + dose calculation
and vial sharing) · Physiotherapy (plan + outcome scoring) · Dental (charting + treatment
plan) · AYUSH (Prakriti assessment + Panchakarma schedule) · 🔴 IVF (cycle + ICMR/ART Act
records) · Obstetric ANC (visit schedule + high-risk flag) · 🔴 Partograph (normal labour +
crossing the action line) · Neonatal (APGAR + Bhutani jaundice risk) · Anaesthesia (PAC +
intraoperative event) · Ophthalmology (refraction + IOL calculation) · Mental Health
(assessment + 🔴 risk/suicidality flag).

---

# Phase 13 — Quality, NABH, IPC & ABDM · 10 scenarios

🔴 NABH evidence auto-generated by a clinical action · NABH standards matrix and gap report ·
incident report → RCA → CAPA → closure · clinical audit cycle · QI project with
before/after indicator · 🔴 hand hygiene audit and compliance rate · 🔴 HAI surveillance and
antibiogram generation · restricted antibiotic justification · HMIS monthly report
generation · 🔴 ABDM care-context linking after a visit.

---

# Phase 14 — Analytics & AI Suite · 67 scenarios

**One scenario per AI feature key** — the complete list is in
[`src/lib/aiFeatures.ts`](../../src/lib/aiFeatures.ts). Each is tested for four things:

1. **Gating** — hidden when the plan doesn't include it, when the hospital toggle is off, or
   when the AI budget is exhausted. All three, separately.
2. **Output quality** — is the result clinically and commercially sensible for an Indian
   context? Indian drug names, Indian rate cards, `₹`, `DD/MM/YYYY`.
3. **Human override** — can a clinician reject or edit the output, and is the final recorded
   value theirs rather than the model's?
4. **Cost and logging** — usage logged to `ai_usage_logs`, no PHI in logs.

🔴 The clinical-decision-path features get the hardest treatment: **Voice Scribe**,
**Drug Interaction AI**, **Sepsis Early Warning**, **Triage Classifier**,
**Lab Auto-Interpreter**, **Radiology Impression**, **Discharge Summary**, **ICD Coding**.
A wrong output any of these that a clinician could act on without checking is a P1.

Plus the analytics dashboards: revenue intelligence · population health · forecasts ·
clinical intelligence · research cohort with k-anonymity.

---

# Phase 15 — Platform Admin + Full Regression · 8 mega-journeys

**Platform admin (super admin):** hospital tenant lifecycle · plan change and its immediate
effect on the hospital's modules · 🔴 feature flag withhold · incident declaration ·
AI cost monitoring · support ticket flow.

**The 8 full regression journeys** — each run end to end, across every module it touches,
as the final proof before go-live:

| # | Journey |
|---|---|
| **R1** 🔴 | Cash outpatient: register → OPD → lab → pharmacy → bill → day closure → journal |
| **R2** 🔴 | Insured inpatient: OPD → pre-auth → admit → ICU → surgery → discharge → claim → settlement |
| **R3** 🔴 | PMJAY inpatient: registration → package admission → discharge → scheme claim |
| **R4** 🔴 | Emergency: unidentified trauma → ED → MLC → OT → ICU → identity resolved → billing |
| **R5** | Maternity: ANC → labour → partograph → delivery → newborn record → discharge of both |
| **R6** | Day care: chemo cycle → oncology → pharmacy NDPS → same-day discharge → billing |
| **R7** 🔴 | Cross-tenant: every module attempted against Hospital B's data from Hospital A |
| **R8** | Quality: a month of activity → NABH evidence → indicators → HMIS report → audit trail |

---

## Something missing?

This matrix came from your codebase's branch points and standard Indian hospital practice.
If your target hospitals routinely see a patient type that isn't here — a specific state
scheme, a corporate panel arrangement, a particular referral pattern — **say so and it gets
added**. Finding the gap now costs nothing. Finding it at go-live costs a customer.

# Go-Live Readiness

**The question this page answers:** can a real hospital start using Aumrti tomorrow without
harming a patient, losing money, or breaking the law?

This is deliberately **smaller than the full test catalogue**. Not everything has to be
perfect to go live. These things do.

The tracker's **Go-Live Readiness** sheet computes a single verdict from this list. It reads
**NOT READY** until every item is green.

---

## The three categories that block go-live

Something is on this list only if getting it wrong means one of:

1. **A patient could be harmed** — wrong drug, missed alert, wrong dose
2. **Money is wrong** — a bill that's incorrect, a charge lost, a claim rejected
3. **A law is broken** — PCPNDT, NDPS, GST, DPDP, medico-legal

Everything else — a mislabelled column, an awkward layout, a missing convenience feature —
can be amber at go-live and fixed in the first weeks. Hospitals tolerate rough edges. They
do not tolerate a wrong bill or an unsafe prescription.

---

## Patient safety — 14 must-pass

| Scenario | What must be true |
|---|---|
| **P4-S11** | A prescription for a drug the patient is allergic to is **blocked**, and any override is recorded with a reason and the prescriber's identity |
| **P4-S10** | Drug interaction alerts fire on a real interacting pair |
| **P5-S07** | A critical lab value (K⁺ 7.2) raises an immediate alert that reaches the doctor |
| **P5-S06** | A rejected sample returns the order to pending and doesn't charge the patient twice |
| **P5-S10** | A test needing dual validation cannot be released by one person |
| **P6-S04** | Batch selection is FEFO — the earliest expiry is used |
| **P6-S05** | An expired batch **cannot** be dispensed |
| **P6-S07** | NDPS drugs require dual sign-off and write to the NDPS register |
| **P6-S08** | NDPS dispensing with a single signature is **blocked** |
| **P7-S06** | ICU flowsheet, ventilator and sedation records save correctly |
| **P10** | WHO surgical safety checklist cannot be bypassed |
| **P10** | Blood cross-match and issue are traceable donor-to-recipient |
| **P10** | A failed sterilisation cycle triggers instrument recall |
| **P14** | Every clinical AI output can be rejected or edited, and the clinician's value is what's recorded |

---

## Money — 16 must-pass

| Scenario | What must be true |
|---|---|
| **P7-S14** | The discharge charge sweep collects **every** charge **exactly once** — room, doctor visits, nursing, lab, radiology, pharmacy, OT |
| **P7-S15** | Excess advance produces a refund payable, not a silent absorption |
| **P7-S16** | Pharmacy returns restore stock, create a credit note, and reduce the bill |
| **P7-S17** | Discharge is blocked when OT charges are unbilled, with an audited override |
| **P7-S13** | A stay crossing a locked cash-closure day doesn't corrupt or drop charges |
| **P7-S12** | Pre-paid and post-paid ancillary policies both bill correctly |
| **P8-S01** | A cash bill totals, rounds and receipts correctly |
| **P8-S09** | Advance receipts adjust against the final bill without double-counting |
| **P8-S10/S11** | Discounts below the threshold apply directly; above it, approval is enforced |
| **P8-S13** | Refunds follow the approval chain |
| **P8-S15** | A paid bill cannot be voided without a reversal |
| **P8-S16** | Day closure locks the day and blocks later edits |
| **P8-S18** | Finalising a bill posts a balanced journal entry |
| **P8-S20** | Bill numbers have no duplicates and no gaps |
| **P9-S07** | Room-rent ceiling breaches apply the correct proportionate deduction |
| **P6-S02/S03** | Pharmacy stock decrements exactly once, at the right moment for the policy |

---

## Legal & regulatory — 10 must-pass

| Scenario | Law | What must be true |
|---|---|---|
| **P4-S13**, **P5-S13** | **PCPNDT Act** | Every obstetric ultrasound produces a complete Form F. Test both study names in the catalogue — the trigger is a string match |
| **P5-S14** | PCPNDT | A non-obstetric ultrasound does **not** produce a Form F |
| **P6-S07/S08** | **NDPS Act** | Narcotic dispensing requires dual sign-off and a register entry |
| **P8-S07** | **GST** | Bill finalisation is blocked when GSTIN is set and an HSN is missing |
| **P8-S04/S05/S06** | GST | Exempt clinical services carry no GST; taxable services carry the right rate; ICU rooms are exempt regardless of amount |
| **P9-S15** | CGHS rules | A CGHS/ECHS patient without a referral cannot have a bill finalised |
| **P4-S23**, **P10** | **CrPC / medico-legal** | MLC cases create a medico-legal record that cannot be skipped |
| **P7-S19**, **P10** | Registration of Births & Deaths Act | Death produces an MCCD |
| **P3-S10** | **DPDP Act 2023** | Erasure requests soft-delete and exclude from all searches |
| **P13** | NABH | Clinical actions generate evidence with real timestamps and identities |

---

## Security & isolation — 5 must-pass

These are the ones that end a company, not just a deal.

| Scenario | What must be true |
|---|---|
| **P3-S12** | A Hospital A user cannot open a Hospital B patient by pasting the UUID into the URL |
| **R7** | **Every module** attempted cross-tenant is blocked — not just the patient screen |
| **P1-1H** | A direct API query from Hospital A's session returns no Hospital B rows |
| **P1-1H** | A user moved between hospitals doesn't retain the old tenant from the stale `hms_ctx_*` session cache |
| **P14** | No PHI appears in console logs, error messages, or AI usage logs |

> 🔴 Two queries were found that fetch without a `hospital_id` filter and rely purely on RLS
> — `ClaimsStatus.tsx:128` and `:170`. RLS should hold, but these are the exact places to
> probe hardest. If RLS is ever misconfigured, these leak first.

---

## Access control — 4 must-pass

| Scenario | What must be true |
|---|---|
| **P1-1E** | Every role lands on its correct route and is blocked from routes it shouldn't reach |
| **P1-1F** | A receptionist cannot see *Complete & Bill* or *Admit Patient* |
| **P1-1G** | A Starter-plan hospital cannot open a Professional-plan module |
| **P1-1C** | A deactivated user is signed out and cannot log back in |

---

## The 4 regression journeys that must run clean

| # | Journey |
|---|---|
| **R1** | Cash outpatient: register → OPD → lab → pharmacy → bill → day closure → journal |
| **R2** | Insured inpatient: OPD → pre-auth → admit → ICU → surgery → discharge → claim → settlement |
| **R3** | PMJAY inpatient: registration → package admission → discharge → scheme claim |
| **R7** | Cross-tenant: every module attempted against Hospital B from Hospital A |

R4–R6 and R8 are strongly recommended but not blocking.

---

## Configuration readiness

Separate from testing — the hospital's own data must be in before they go live. This maps to
the existing checklist at [`/admin/go-live`](../../src/pages/admin/).

```
[ ] Hospital profile complete, GSTIN entered
[ ] All departments created
[ ] All wards and beds created, with rate_per_day on every ward
[ ] All doctors created with consultation fees (or bills default to ₹500)
[ ] Service master populated with HSN codes on every taxable row
[ ] Drug master imported, with batches received into stock
[ ] Lab test catalogue populated with fees and normal ranges
[ ] Radiology modalities, then studies, with fees
[ ] Payer masters and TPA ceilings entered
[ ] Discount approval rules set (or every discount auto-approves)
[ ] IPD ancillary payment policy chosen deliberately
[ ] Drug routes and frequencies in config values (or Rx dropdowns are empty)
[ ] Roles and permissions reviewed per role
[ ] All staff logins created and tested
[ ] WhatsApp configured (or every notification silently no-ops)
[ ] Backup verified — a restore actually tested, not just "backups exist"
```

---

## The verdict

**READY TO GO LIVE** requires all of:

- [ ] All 14 patient-safety scenarios PASS
- [ ] All 16 money scenarios PASS
- [ ] All 10 legal scenarios PASS
- [ ] All 5 security scenarios PASS
- [ ] All 4 access-control scenarios PASS
- [ ] R1, R2, R3 and R7 run clean end to end
- [ ] Zero open P1 defects anywhere in the tracker
- [ ] The configuration checklist above complete for the specific hospital

**49 scenarios + 4 journeys.** That's the bar. Anything less and you're asking a hospital to
find your bugs with real patients and real money.

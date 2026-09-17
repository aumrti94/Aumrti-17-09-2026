# Testing IPD Insurance / PMJAY / TPA Billing — Completeness and Pending-Claim Accuracy

**Status:** Analysis, grounded in the actual code. Not a plan.
**Date:** 2026-09-10

Confirming the ask: how to test that (1) every chargeable service on an insurance/PMJAY/TPA
admission actually makes it onto a bill and a claim — nothing missed — and (2) money the hospital
is still owed *by the insurer/scheme* (not the patient) shows up correctly as pending, rather than
getting lost or double-counted.

---

## What already exists — and it's more mature than the billing/notification layers

There's a real claims-reconciliation system: `insurance_claims` (status: pending/approved/
rejected) + `insurance_payment_reconciliation` (TPA payment, advice number, bank ref, dispute
flag/reason), surfaced in [PaymentReconciliation.tsx](../../src/components/insurance/PaymentReconciliation.tsx).
It already computes exactly the KPI the question is asking for — pending amount, pending count,
average settlement days, recovery rate, per-TPA approval rate — and has a working dispute
workflow with AI-drafted dispute letters. This is the genuine "pending bill from insurer" view,
and it's built to a noticeably higher standard than the notification system reviewed earlier.

Payer-specific compliance logic also already exists and is taken seriously —
[payerTypes.ts](../../src/lib/payerTypes.ts) encodes the CGHS/PMJAY rule that nursing care is
bundled into room rent for scheme patients and must not appear as a separate billable line, citing
the actual CGHS 2025 Annexure-III and IRDAI non-payable list. Good sign: this is compliance logic
grounded in the actual regulation, not a guess.

---

## Two concrete findings

### 1. A payer-type spelling bug already happened once — and is exactly the class of bug to guard against

The same file's comment documents a real historical bug: the pre-auth check wrote `"esi"` while
`BillEditor`'s finalize check read `"cghs"`/`"echs"` — two call sites drifted on which spelling of
the same scheme they recognized, so one code path silently failed to apply a rule the other
enforced correctly. It's since been fixed by consolidating into one `BUNDLED_NURSING_PAYER_TYPES`
set covering both spellings. That's the right fix, but it's evidence this exact failure mode is
real, not hypothetical, for this codebase specifically — any place that still compares
`payer_type`/`patient_category` against a scheme name inline (rather than importing from
`payerTypes.ts`) is a candidate to check for the same drift.

### 2. Two separate "how much is still outstanding" numbers, with nothing that reconciles them

`bills.balance_due` (computed in [billTotals.ts](../../src/lib/billTotals.ts)) is a single number:
total charges minus payments received, full stop. It has no awareness of `insurance_claims` at
all — it doesn't know or care whether a shortfall is because the patient hasn't paid their co-pay
or because the TPA/PMJAY hasn't settled their approved portion. This number drives the general
billing desk's "pending collections" view
([PendingCollectionsPanel.tsx](../../src/components/billing/PendingCollectionsPanel.tsx)).

Separately, `insurance_claims.claimed_amount − approved_amount − reconciled payments` drives the
"pending from insurer" number on the insurance desk (`PaymentReconciliation.tsx`).

**Nothing ties these two numbers together.** There's no invariant enforced anywhere that, for an
insurance-payer bill, `balance_due` on the bill actually corresponds to the outstanding amount on
its linked claim. If a claim gets approved and partially paid but the bill's `balance_due` isn't
correctly stepped down (or vice versa — a bill marked paid while the claim is still genuinely
pending), the billing desk and the insurance desk would show two different, uncross-checked
"how much are we still owed" figures for the same admission. Worth noting: `bills.bill_status` has
an `insurance_pending` value in its DB constraint (`CHECK ... IN (..., 'insurance_pending')`) —
but I found **zero places in the application code that ever set or read it**. It's a declared but
dead enum value, which reads as an early intent to mark "this bill is specifically waiting on the
insurer" at the bill level that was never wired up — the actual tracking ended up living entirely
in the separate `insurance_claims` table instead, with no bridge back to the bill's own status.

### Open question worth testing, not yet confirmed either way

Does the "unbilled services" leakage detection covered in the earlier revenue-leakage analysis
(`LeakageScanner`, `UnbilledServicesModal`, the nightly `daily-leakage-scan`) apply the same way to
an insurance/PMJAY-payer admission as it does to a cash-pay one? If insurance billing routes
services onto a claim through a different path than the direct `bill_line_items` insert those
scanners check against, an insurance patient's missed charge could be invisible to every leakage
detector that exists — a blind spot specific to the payer type, not caught by the general
mechanism. This needs a direct check against the claim-submission code path, not an assumption.

---

## How to test this

1. **Regression-guard the payer-type spelling.** Since this class of bug has already happened
   once, grep for any remaining inline comparisons against scheme names (`"cghs"`, `"pmjay"`,
   `"esi"`, etc.) that don't go through `payerTypes.ts`, and add a unit test enumerating every
   payer-type string used anywhere in the app against `INSURANCE_PAYER_TYPES` /
   `BUNDLED_NURSING_PAYER_TYPES` to catch a new spelling variant being introduced.
2. **Add the missing invariant test: bill `balance_due` vs. claim outstanding amount agree.** For
   an insurance-payer admission, write an integration test that seeds a claim through its full
   lifecycle (submitted → approved → partially reconciled) and asserts the bill's `balance_due`
   and the claim's outstanding amount move in lockstep — or, if they're deliberately meant to be
   independent, that the billing desk's total and the insurance desk's total are explicitly
   reconciled somewhere (a report, a nightly check) rather than silently trusted to agree.
3. **Resolve the dead `insurance_pending` bill_status before testing around it.** Either wire it
   up (so a bill waiting purely on the insurer is visibly distinguishable from one waiting on the
   patient, right at the bill level) or drop it from the schema — testing a status value nothing
   sets would be testing a path that can't occur in production, which produces false confidence.
4. **Extend the leakage-detection reconciliation test (from the earlier revenue-leakage analysis)
   to specifically cover an insurance/PMJAY-payer admission**, not just a cash-pay one — to
   directly answer the open question above rather than leave it assumed. This is the "no miss"
   half of the ask: prove every chargeable service on a scheme-covered admission reaches either
   the claim or the bill, the same way it's proven for a cash patient.
5. **Unit test the claim-level pending/aging calculation directly** (currently computed inline in
   `PaymentReconciliation.tsx`'s `loadKPIs` — worth extracting to a pure function the same way
   `billTotals.ts`/`billStatus.ts` already separate calculation from the component, so
   `pendingAmount`, `avgSettlementDays`, and `recoveryRate` can be tested against known claim sets
   without a live Supabase call).
6. **Test the dispute path**, since underpayment is the most common real-world TPA/PMJAY failure
   mode, not just non-payment: seed a claim where `approved_amount < claimed_amount`, confirm it's
   correctly counted in `underpaymentDisputed`, and that raising a dispute doesn't silently zero it
   out of the pending total before it's actually resolved.

---

## Not done here

No code was changed. Whether to wire up `insurance_pending`, retire it, or build an explicit
reconciliation report between the billing desk and insurance desk is a product decision.

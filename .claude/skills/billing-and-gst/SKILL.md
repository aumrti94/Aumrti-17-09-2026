---
name: billing-and-gst
description: Use when touching anything involving money — patient bills, line items, charge posting, discounts, advances, refunds, GST rates and CGST/SGST/IGST splits, GST returns (GSTR-1/3B), invoices and IRN, payments, or insurance/TPA settlement amounts. Covers the persistence-vs-presentation split, the healthcare GST exemption rules, and the rounding contract. Load before writing arithmetic on money.
---

# Billing and GST

Revenue is the highest-bar surface in this repo alongside drug safety. Every rule below exists
because two screens once disagreed about the same number in front of a patient at a billing
counter.

**Never hand-roll arithmetic on money.** Every helper you need already exists, and the duplicates
that got hand-rolled are exactly what these modules were created to replace.

## The two money contracts — do not conflate them

| | Module | Owns |
|---|---|---|
| **Persistence** | [billTotals.ts](../../../src/lib/billTotals.ts) → `computeBillTotals` | What lands in the `bills` columns |
| **Presentation** | [billMoney.ts](../../../src/lib/billMoney.ts) → `computeBillMoney` | What a screen displays and decides on |

They are separate on purpose. Conflating them is how `patient_payable` came to mean three different
things — gross payable, residual balance, and "charges so far" — on three different screens.

Semantics that trip people up:

- **`patientPayable` is gross of advance.** It answers "what does this patient owe in total", not
  "what is left to pay". The residual is `balanceDue`. Netting the advance into `patientPayable` is
  what produced a ₹1,500 "Actual (so far)" on a bill carrying ₹6,000 of charges.
- **`netAdvance` is gross of application** — advance already applied still counts as a credit,
  because `patientPayable` has not been reduced by it.
- **`balanceDue` and `refundDue` are mutually exclusive and both non-negative.** Never derive a
  refund by negating a balance; read `settlement`.
- **`total` is net of discount**, by a convention every discount surface already follows. Preserve
  it, or an unrelated line-item edit silently re-inflates an already-discounted bill.

`computeBillTotals` is pure and is the *sole* real implementation. `recalculateBillTotalsSafe`
tries a `recalculate_bill_totals` RPC first, but that Postgres function does not exist on this
project — every call errors and falls through. Treat the TypeScript as the source of truth, not as
a fallback for some parallel SQL version.

## Rounding

```typescript
import { roundCurrency, calcGST, calcLineTotal } from "@/lib/currency";
```

`roundCurrency` is 2dp and must be applied at **every** step, not only at the end — accumulating
unrounded intermediates is how a bill's parts stop summing to its total.

Note: `roundCurrency`'s doc comment says "banker's rounding", but the implementation is
`Math.round(amount * 100) / 100`, which is half-up. The comment is wrong, not the code — behaviour
is half-up throughout, and consistency matters more here than the rounding mode. Don't "fix" it to
round-half-even without a deliberate decision; it would shift historical totals.

## Displaying money — pick the right formatter

| Formatter | Use for |
|---|---|
| `formatCurrency` / `formatINR` | General — the default |
| `formatINRExact` | KPI cards, tables, tooltips — any figure a user reads as a number |
| `formatINRPrecise` | Unit costs that may be under ₹1 (AI cost per call, per page) |
| `formatINRCompact` | **Chart axis tick labels only** |

Never hand-roll a Cr/L/K abbreviation. Fourteen screens each wrote the same
`(n/100000).toFixed(1)+"L"` helper, so ₹23,700 displayed as "₹23.7K", and ₹1,49,999 and ₹1,50,001
both rendered "₹1.5L" — amounts people reconcile against cannot be rounded away like that.

`en-IN` grouping is the point: **1,50,000** (lakh), not 150,000. Never display a raw number.

## GST rates — healthcare is mostly exempt

```typescript
import { getDefaultGSTRate, resolveServiceGstPercent, getRoomChargeGSTRate,
         DEFAULT_PHARMACY_GST_PERCENT } from "@/lib/gstRules";
```

Per Notification 12/2017-CT(Rate): core health services are **0%**. Consultation, procedure,
surgery, lab, radiology, nursing, blood, ambulance — all exempt. Taxable items are the exceptions:
pharmacy and consumables 12%, oxygen 5%, cafeteria 5%, cosmetic 18%, parking 18%, other services 18%.

Two rules that are not a flat lookup:

- **Room charges** — 0% at ≤ ₹5,000/day, 5% above. ICU/NICU/PICU are exempt **at any rate** per
  CBIC clarification. Always go through `getRoomChargeGSTRate(bedCategory, ratePerDay)`; a flat
  `GST_RATE_RULES.room_charge` misses both branches.
- **Pharmacy fallback** is `DEFAULT_PHARMACY_GST_PERCENT` (12), matching `drug_master.gst_percent`'s
  own column default. One dispensing screen once had a stray `|| 5`, so the same drug billed at a
  different rate depending on which screen dispensed it. Never inline a numeric fallback.

Packages follow the composite-supply rule — 0% when the principal supply is health services.

## CGST / SGST / IGST

```typescript
import { splitGst, resolveStateCode } from "@/lib/gst";

const split = splitGst({ amount, gstPercent, sellerStateCode, buyerStateCode });
```

Intra-state → CGST + SGST, half each. Inter-state → IGST, full. The state is the 2-digit GST state
code, taken from an explicit `state_code` or the first two characters of the GSTIN.

When either state code is unknown the helper defaults to **intra-state**, deliberately — that is the
safe assumption for a hospital, whose patients are overwhelmingly in-state. Don't add an
inter-state guess.

`splitGst` returns **unrounded** values. Apply `roundCurrency` to each component you persist, and
make sure `cgst + sgst` still equals `gst` after rounding — a half-paisa split is where a
one-rupee mismatch on the invoice comes from.

## Posting a charge

`postCharge` in [chargePosting.ts](../../../src/lib/chargePosting.ts) is the single entry point for
putting a charge on a bill. It resolves the rate, computes GST, finds or creates the admission
bill, applies the IPD ancillary gate, and recalculates totals. Use it rather than inserting a
`bill_line_items` row directly — a direct insert skips the gate and leaves totals stale.

## Bills are not freely editable

```typescript
import { checkBillWritable, isRunningBill, lockedDayMessage } from "@/lib/lockedDay";
```

Once a day is closed, its bills are locked. Check writability **before** offering an edit, not on
save — a form that accepts input and then refuses it at submit is worse than a disabled control.
`isRunningBill` distinguishes an open IPD running bill (still accruing) from a finalised one.

Every amendment to a finalised bill is logged via `logBillAmendment` and its helpers
(`logLineItemAdded`, `logLineItemRemoved`, `logInsuranceUpdate`, `logAdvanceApplied`). A discount,
a removed line item, or a refund without an amendment record is an audit finding.

## GST returns

`buildOutwardRegister`, `summariseGstr1`, and the GSTR-3B helpers in
[gstReturns.ts](../../../src/lib/gstReturns.ts) generate statutory returns; HSN summaries are part
of GSTR-1. Filed figures must reconcile to the bills they came from — any change to how a bill's
GST is computed is a change to what has already been filed. Treat it accordingly.

E-invoice IRN generation is `supabase/functions/gst-irn-generate`.

## Before you call it done

```bash
npm run lint
npm run check:db-contract
```

Billing is a patient-safety-grade surface for the business: per CLAUDE.md, a change to
`gstRules`/billing totals **without a test is not mergeable**. `computeBillTotals`,
`computeBillMoney`, `splitGst`, and the rate resolvers are pure functions — test them directly.

Rate resolution order, advances and refunds, insurance splits, and payment reconciliation:
[references/patterns.md](references/patterns.md).

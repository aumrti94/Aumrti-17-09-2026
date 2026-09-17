# Billing patterns — detail

## Rate resolution

Rates are hospital-configurable. Never hardcode an amount.

```typescript
import { getRate, getRateWithGst, getModuleDefaultRate,
         SERVICE_RATE_CODES, MODULE_RATE_CODE } from "@/lib/serviceRates";

const rate = await getRate(hospitalId, SERVICE_RATE_CODES.ANAESTHESIA, 0);
const { rate, gstPercent } = await getRateWithGst(hospitalId, itemCode, 0);
```

Order of precedence, and each step matters:

1. The hospital's own `service_rates` row for the item code (`is_active = true`).
2. The catalogue rate on `service_master` / `drug_master`.
3. The `fallback` argument.

`getRate` returns the fallback on **either** an error or a missing row. That is deliberate — a
rate lookup failure must not block billing at a counter — but it means a misconfigured code bills
silently at the fallback. Pass a fallback you would be content to see on a real bill, and prefer
`0` with an explicit "rate not configured" branch over a plausible-looking guess.

Use `SERVICE_RATE_CODES` and `MODULE_RATE_CODE` constants, never a string literal — a typo'd code
resolves to the fallback rather than erroring.

## Advances

```typescript
import { computeNetAdvance, fetchAdvanceLedger, filterUnmirroredReceipts } from "@/lib/advanceLedger";
```

An advance is a credit held against a patient or admission, not a payment on a bill. `netAdvance`
is **gross of application** — advance already applied to this bill still counts as a credit,
because `patientPayable` has not been reduced by it. Read `billMoney` for the display contract
rather than re-deriving.

`filterUnmirroredReceipts` exists because receipts can appear both as an advance and as a mirrored
payment row; counting both double-credits the patient. Filter before summing.

Applying an advance to a bill is an amendment — log it with `logAdvanceApplied`.
Settlement at discharge goes through `settleAdmissionAdvance`.

## Refunds

```typescript
import { fetchOpenRefund, isDuplicateRefundError, DUPLICATE_REFUND_MESSAGE,
         OPEN_REFUND_STATUSES } from "@/lib/refundRequests";
```

Refunds are **request → approval → payout**, never a direct write. `OPEN_REFUND_STATUSES` is
`["pending_approval", "approved"]`.

A partial unique index enforces one open refund per bill at the database level. Catch it rather
than letting a raw Postgres error reach the user:

```typescript
if (isDuplicateRefundError(err)) {
  toast({ title: DUPLICATE_REFUND_MESSAGE, variant: "destructive" });
  return;
}
```

`refundDue` and `balanceDue` are mutually exclusive and both non-negative. Never compute a refund by
negating a balance — read `settlement` from `computeBillMoney`.

## Insurance and TPA

```typescript
import { fetchPreAuthCeiling } from "@/lib/insuranceCeiling";
```

A bill splits into an insurance-borne portion and a patient-borne portion. The insurance share is
capped by the pre-authorisation ceiling; anything above it falls to the patient, and the split must
be visible on the bill rather than buried in a total.

`patientPayable` in `computeBillTotals` is already net of `insuranceAmount`. Don't subtract it
again downstream.

Pre-auth has an expiry — `StatusBadge` already carries `preauth_expiring` and `preauth_expired`
statuses. Claim submission runs through the HCX Edge Functions (`hcx-claim-submit`,
`submit-pre-auth-hcx`, `pmjay-claim-submit`, `esi-claim-submit`); IRDAI timelines make late
intimation a revenue loss, which is why `late_intimation` and `irdai_overdue` are badge states.

## Payments

```typescript
import { recordBillPayment } from "@/lib/billPayments";
import { fetchPatientOutstandingBalance } from "@/lib/outstandingBalance";
```

`recordBillPayment` is the single write path — it inserts the payment, recalculates totals, and
syncs line-item payment status. Inserting a payment row directly leaves the bill's `paid_amount`
and `payment_status` stale, so the bill still reads as unpaid at the counter.

Payment modes come from `@/lib/paymentModes`; cash reconciliation is `dayClosureTotals` and the
daily cash closure screen. Online payments run through the Razorpay Edge Functions, with
settlement reconciliation in `razorpay-settlement-reconcile`.

Payment status is derived, never hand-set: `balanceDue <= 0 && paid > 0` → `paid`; `paid > 0` →
`partial`; otherwise `unpaid`. A bill with no charges and no payment is `unpaid`, not `paid`.

## Printing

`billPrint`, `receiptPrint`, `invoiceDownload`, `payslipPrint`, and the `invoice-pdf` shared module
in Edge Functions. A printed bill is a legal document: it needs the hospital's GSTIN, the
HSN/SAC code per line, the CGST/SGST/IGST split shown separately, and the amount in words. Never
print a figure the on-screen bill does not show.

## Testing

Per CLAUDE.md, a change to `gstRules` or billing totals without a test is not mergeable. The pure
functions are directly testable with no mocking:

- `computeBillTotals` — discount before advance; `patientPayable` gross of advance; clamping at 0
- `computeBillMoney` — `balanceDue` / `refundDue` mutual exclusivity
- `splitGst` — intra vs inter-state; unknown state code defaults to intra-state; `cgst + sgst === gst` after rounding
- `getDefaultGSTRate` / `getRoomChargeGSTRate` — the ₹5,000 room boundary at ₹4,999 / ₹5,000 / ₹5,001, and ICU exempt at every rate
- `resolveServiceGstPercent` — catalogue override beats default
- `summariseGstr1` — register totals reconcile to the bills

Boundary values are where money bugs live: 0, negative, exactly-at-threshold, and the half-paisa
split that makes `cgst + sgst` miss `gst` by a rupee.

## Checklist

- [ ] No hand-rolled money arithmetic — `computeBillTotals` / `computeBillMoney` / `splitGst`
- [ ] Persistence vs presentation contract not conflated
- [ ] `roundCurrency` at every step, not only the end
- [ ] GST rate via `getDefaultGSTRate` / `getRoomChargeGSTRate` / `resolveServiceGstPercent` — no inline numbers
- [ ] `cgst + sgst === gst` after rounding
- [ ] Charges posted via `postCharge`; payments via `recordBillPayment`
- [ ] `checkBillWritable` before offering an edit, not on save
- [ ] Amendments logged via `logBillAmendment` helpers
- [ ] Display via the right `formatINR*`; `en-IN` grouping; no hand-rolled L/Cr
- [ ] Tests for any change to totals or GST rules
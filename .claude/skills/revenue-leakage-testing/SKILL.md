---
name: revenue-leakage-testing
description: Use when writing or reviewing a test that touches money — a bill, a line item, a charge posted from lab/radiology/pharmacy/OT/ancillary, an insurance or PM-JAY claim, a TPA reconciliation, or a leakage scan. Covers the assertion shape that catches a silently missing or silently duplicated charge, both directions of every module-to-billing handoff, scheme bundling absence assertions, and which money functions in src/lib are pure and testable today. Load before asserting anything about a billing flow.
---

# Revenue leakage testing

[billing-and-gst](../billing-and-gst/SKILL.md) owns the rules and the arithmetic — rates, splits,
rounding, which helper to call. This skill owns **how you prove the money actually arrived**, and
it exists because every revenue defect this codebase has found looked completely healthy at
runtime.

## The governing rule: a revenue defect is never a crash

Go through the ones that were real here:









- Payroll wrote GL lines to a table that does not exist. The write "succeeded"; payroll never
  reached the ledger. HCX claims submitted with an **empty item list**, because the code read
  `bill_items` and the table is `bill_line_items`. The submission returned success.
- Radiology fees were looked up from `modalities` — a table that has never existed — so every
  radiology line priced at **₹0**. A perfectly valid bill, for nothing
  ([UnbilledServicesModal.tsx:122](../../../src/components/billing/UnbilledServicesModal.tsx)).
  `service_master` was likewise queried for a `rate` column; it is `fee`
  ([investigationBilling.ts](../../../src/lib/investigationBilling.ts)).
- An IPD lab order minted its own bill with no dedupe key while the discharge sweep pulled the same
  tests onto the IPD bill — **two lines per test and a duplicate GL posting**
  ([NewLabOrderModal.tsx:404](../../../src/components/lab/NewLabOrderModal.tsx)).

Not one of those threw. So **"the billing flow ran without error" is not an assertion.** Neither is
`expect(fn).not.toThrow()`, nor a truthy `data`, nor a toast firing. Supabase returns errors as
values, so an unchecked insert failure and a successful insert are indistinguishable to the caller.

Assert on **resulting state**, always three facts together:

```typescript
const lines = await lineItemsFor(billId, "lab:" + labOrderItemId);
expect(lines).toHaveLength(1);                          // exactly one — not ≥1, not truthy
expect(lines[0].total_amount).toBe(450);                // the right amount, not any amount
expect(lines[0].source_dedupe_key).toBe(`lab:${labOrderItemId}`);   // the right identity
```

`toHaveLength(1)` is load-bearing. `expect(lines.length).toBeGreaterThan(0)` passes on a
double-charge, which is the compliance-worse half of the failure.

## The core shape: delivered-but-never-billed, tested both ways

Every module-to-billing handoff gets two tests, never one:

| Direction | Act | Assert |
|---|---|---|
| **Missing charge** | Deliver the service in the source module (validate a lab result, dispense IP pharmacy, complete an OT case) | The charge appears on the bill: one row, right amount, right key |
| **Duplicate charge** | Run the same step **twice** | Still exactly one row, and the total is unchanged |

The duplicate direction is not paranoia. `bill_line_items_dedupe_uq` (migration
`20261016000013_rcm_integrity_constraints.sql`) is a **partial** unique index on
`(bill_id, source_dedupe_key) WHERE source_dedupe_key IS NOT NULL` — a line inserted without a key
is entirely unconstrained. At the time it was added only 132 of 216 rows carried a key.

Then add the third case nobody writes: the source record marked `billing_status = 'waived'`
(the CHECK on `lab_orders`/`radiology_orders` allows `unbilled` | `billed` | `waived`). A waived
order must produce **zero** lines and must not be reported as leakage.

## Two implementations of one decision — pin the authoritative one

The "is this delivered service already billed?" question has two competing answers in the tree, and
that disagreement *is* the bug class:

| Surface | How it decides |
|---|---|
| `daily-leakage-scan`, `UnbilledServicesModal` | Hard keys — `billing_status='unbilled'`, `bill_linked=false`, `.in("source_dedupe_key", keys)` |
| `LeakageScanner`, `PreDischargeLeakageBanner` | `description.toLowerCase().includes(testName)` |

Substring matching fails both ways: rename a lab test in master data and a real leak becomes
invisible; add trailing whitespace and an already-billed item is re-offered, and "Add All"
double-charges the patient. Write the test so it **pins the key-based method as authoritative** —
feed it two tests with overlapping names ("CBC" vs "CBC with ESR"), a description edited after the
order was placed, and the same drug dispensed twice in one admission. A test that merely reproduces
the substring behaviour freezes the bug in place.

Same trap in the fixer: [LeakageScanner.tsx:207](../../../src/components/billing/LeakageScanner.tsx)
inserts a `bill_line_items` row with `source_module` but **no `source_record_id` and no
`source_dedupe_key`** — so the unique index never applies, the source row's `billing_status` is
never flipped, and the nightly scan keeps reporting the same leak forever. Assert the key *and* the
source row's status after the fix runs, or the test passes while the leak persists.

## Declared but unreachable states

`bills.bill_status` allows `'insurance_pending'` in its CHECK constraint (migration
`20260323042425`). **Nothing in `src/` ever sets or reads it.** Asserting the value is *permitted*
proves nothing — the database already told you that. Assert the transition is **reached**: drive
the lifecycle and assert the status the bill actually lands in. If it can't be reached, that is a
finding to report, not a test to write.

## Reconciliation: two outstanding numbers that nothing ties together

`bills.balance_due` (from [billTotals.ts](../../../src/lib/billTotals.ts)) knows nothing about
claims. The insurance desk computes its own pending figure inline in `loadKPIs`
([PaymentReconciliation.tsx:227](../../../src/components/insurance/PaymentReconciliation.tsx)).
Read that code before testing it — the shape is not what you'd guess:

- `pendingAmount` sums the **full `claimed_amount`** of `insurance_claims` where
  `status='approved' AND reconciled=false`. It does not subtract `approved_amount` or payments
  already received, and a claim still in `submitted` is not counted at all.
- `underpaymentDisputed` comes from `insurance_payment_reconciliation` rows with
  `dispute_raised=true AND reconciled=false`, as `hospital_claimed_amount − tpa_paid_amount`.

So an **undisputed** underpayment is in neither figure, and flipping `reconciled` to true drops the
shortfall out of both at once. That is the assertion to write: seed a claim where
`approved_amount < claimed_amount`, settle it partially, and assert the shortfall is **still
visible** somewhere — never quietly zeroed. Then assert the billing desk and the insurance desk tie
out for the same admission, or that their divergence is explicit and explained.

Use [`outstandingAmount`/`totalOutstanding`](../../../src/lib/billStatus.ts) rather than reading
`balance_due` raw — a refunded bill's `balance_due` is rewritten back up to the full total, so the
raw column reports refunded money as collectable.

## Scheme patients: assert the absence

For PM-JAY / CGHS / ECHS / ESI, nursing is bundled into room rent and **must not** appear as a
separate line (`bundlesNursingIntoRoom` in [payerTypes.ts](../../../src/lib/payerTypes.ts), citing
CGHS 2025 Annexure-III and the IRDAI non-payable list). The test is an absence assertion:

```typescript
const lines = await lineItemsFor(billId);
expect(lines.filter((l) => l.item_type === "nursing")).toHaveLength(0);   // bundled — must be absent
```

This is the one people forget, and it is the one that catches **over-billing a scheme**. Cover both
spellings — `BUNDLED_NURSING_PAYER_TYPES` carries `esi`/`esic` and `cghs`/`echs` precisely because
two call sites once drifted on which spelling they recognised, so one path silently skipped a rule
the other enforced. Enumerate every payer-type string used in the app against that set.

Also cover the positive: a cash/self-pay admission **must** carry the nursing line. An absence test
that passes because the whole bill is empty is worthless.

## Start with the pure functions — no staging, no fixtures

These are pure and unit-testable today, with zero setup. Verified present in `src/lib/`:

| Module | Function | Test it for |
|---|---|---|
| `billTotals.ts` | `computeBillTotals` | Parts sum to the total; discount applied once |
| `billMoney.ts` | `computeBillMoney` | `patientPayable` gross of advance; `balanceDue`/`refundDue` exclusive |
| `billStatus.ts` | `outstandingAmount`, `totalOutstanding` | Refunded bill contributes 0 |
| `gst.ts` | `splitGst`, `resolveStateCode` | `cgst + sgst === gst` **after** rounding |
| `gstRules.ts` | `getRoomChargeGSTRate`, `resolveServiceGstPercent` | Boundaries — ₹4,999 / ₹5,000 / ₹5,001, and ICU exempt at every rate |
| `currency.ts` | `roundCurrency`, `calcGST`, `calcLineTotal` | Half-up at 2dp, applied at every step |
| `payerTypes.ts` | `bundlesNursingIntoRoom` | Every spelling; null/cash → false |
| `ipdAncillaryGate.ts` | `evaluateAncillaryGate`, `resolveChargePaymentStatus` | Gate outcome per policy mode |

Boundary rules get three cases — at the boundary and either side — never one. And never assert a
raw number where `formatCurrency()` is the display contract; assert the formatted string, `en-IN`
grouping included.

## Fixtures carry no PHI

No realistic Aadhaar, ABHA address, or mobile number in a fixture, ever — not even a plausible one.
Use `9000000001`-style placeholders, `TESTHOSP-A` / `TESTHOSP-B` tenant ids, and obviously
synthetic names. Two-hospital fixtures for any isolation claim; see
[multi-tenant-data-access](../multi-tenant-data-access/SKILL.md).

## Running them

```bash
npx vitest run src/lib/billTotals.test.ts
```

There is **no `npm run test` script** and there are currently **zero test files under `src/`** — the
billing coverage an older skill claimed does not exist. CI runs no tests, and `vitest.config.ts`
sets no coverage thresholds, so nothing blocks a merge for missing coverage today. Don't claim
otherwise; write the test because the money is wrong otherwise, not because a gate demands it.
Harness setup, naming, and mocking conventions: [vitest-testing](../vitest-testing/SKILL.md) and
[test-strategy](../test-strategy/SKILL.md).

## Checklist

- [ ] Asserts row count (`toHaveLength(1)`), amount, and `source_dedupe_key` — not absence of a throw
- [ ] Both directions covered: missing charge **and** run-it-twice duplicate
- [ ] `waived` source rows produce zero lines and zero leakage reports
- [ ] Key-based detection pinned as authoritative over description matching
- [ ] Status transitions asserted as *reached*, not merely allowed by a CHECK
- [ ] Underpayment stays visible after partial settlement
- [ ] Scheme bill asserts bundled items **absent**, cash bill asserts them present
- [ ] Formatted output compared via `formatCurrency()`, never a raw number
- [ ] No realistic Aadhaar/ABHA/mobile in any fixture

Grace-window boundaries, `scanHospital` extraction, and per-module handoff fixtures:
[references/patterns.md](references/patterns.md).
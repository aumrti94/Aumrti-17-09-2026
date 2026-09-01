# 17 — REVENUE CYCLE / FINANCIAL DATABASE AUDIT

Live row counts as of 2026-08-18: `bills` 137 · `bill_line_items` 215 · `bill_payments` 115 ·
`journal_entries` 841 · `journal_line_items` 1,683 · `insurance_claims` 0 · `pmjay_claims` 0.

## What the database actually prevents

| Risk | Prevented by DB? | Evidence |
|---|---|---|
| Duplicate bill numbers | **YES** | `bills` UNIQUE `(hospital_id, bill_number)` + `trg_bills_assign_bill_number` |
| Duplicate journal numbers | **YES** | `journal_entries` UNIQUE `(hospital_id, entry_number)` |
| Posting into a closed day | **YES** | `prevent_payment_on_locked_day`, `prevent_unauthorized_day_closure` |
| Unauthorised discount | **YES** | `enforce_discount_approval_authorization` trigger |
| Unposted-bill drift | **YES** | `trg_alert_bill_unposted`, `trg_auto_post_bill_journal` |
| Refund/line-item desync | **YES** | `trg_resync_refund_on_line_items` |
| Cross-hospital financial read | **YES** | tenant RLS on `bills`, `bill_*`, `journal_*` |
| **Duplicate payments** | **NO** | R-1 |
| **Duplicate line items** | **NO** | R-2 |
| **Unbalanced journal entries** | **NO** | R-3 |
| **Arbitrary bill totals** | **NO** | C-06 |
| **Deletion of financial evidence** | **NO** | R-4 |

The left column is a genuinely strong list. `bills` carries **7 triggers**, several implementing
real revenue-cycle controls — auto-posting to the GL, day-close locking, discount authorisation,
unposted-bill alerting. This is not a naive billing schema; someone thought carefully about
revenue leakage. The migration `20260531000007_billing_leakage_fix.sql` confirms that concern was
active.

The failures below are gaps in that same design, not evidence of its absence.

---

## R-1 · Nothing prevents the same payment being recorded twice
**Severity: HIGH · Confidence: HIGH**

`bill_payments` (115 rows) has **no UNIQUE constraint of any kind**. Its only CHECK is on
`payment_mode`. There is no idempotency key, no unique `(bill_id, transaction_reference)`, and no
unique `(bill_id, payment_date, amount)`.

A double-submitted payment form, a retried webhook, or a duplicated Razorpay callback inserts two
rows. Both are then counted by every downstream total, because `bills.paid_amount` is recomputed
by summing payments (see C-06). The patient's balance goes negative and the day's cash
reconciliation breaks.

Payment webhooks make this concrete: `razorpay-subscription-webhook` and
`create-razorpay-payment-link` edge functions exist, and payment providers explicitly guarantee
*at-least-once* delivery. A `razorpay_webhook_log` table exists (RLS-enabled, deny-all) which
suggests awareness of replay, but nothing ties it to `bill_payments` as a uniqueness guard.

**Fix:** `UNIQUE (bill_id, provider_reference)` where a provider reference exists, plus an
idempotency key column for manual entry.

## R-2 · Nothing prevents duplicate charge lines
**Severity: MEDIUM · Confidence: HIGH**

`bill_line_items` (215 rows, 28 columns) has **no UNIQUE constraint**. The same service can be
appended to a bill any number of times.

This is not hypothetical: `20260613100000_fix_duplicate_consultation_line_items.sql` is a **data
repair migration** for exactly this defect reaching production. The data was cleaned; the
constraint that would have prevented it was never added, so the condition can recur.

**Fix:** a partial unique index on `(bill_id, service_id, service_date)` for
non-repeatable service types. Note this needs care — some items legitimately repeat (consumables,
per-unit charges), so the constraint must be scoped by `item_type`.

## R-3 · The general ledger cannot enforce that debits equal credits
**Severity: HIGH · Confidence: HIGH**

`journal_entries` (841 rows) stores `total_debit` and `total_credit`. `journal_line_items` (1,683
rows) stores the detail. **No constraint or trigger relates them.** Specifically there is nothing
enforcing:

- `total_debit = total_credit` on the header (the fundamental double-entry invariant), nor
- `SUM(journal_line_items.debit) = journal_entries.total_debit`, nor
- that a posted `journal_entries` row has **any** lines at all.

The third is not theoretical — it is what C-03 actively produces. The payroll path inserts a
header with `status: "posted"` and balanced totals, then fails to insert its lines because it
targets the non-existent `journal_entry_lines`, and reports success. Every payroll approval since
that code shipped has added an unbalanced entry to the ledger.

`journal_line_items` has **0 CHECK constraints**.

**Fix (in order):** correct the table name in `PayrollTab.tsx` / `OffboardingTab.tsx` first —
that stops the bleeding. Then add a deferred constraint trigger asserting the header balances and
has lines. Then reconcile the existing 841 headers against 1,683 lines to find the orphans.

## R-4 · Financial and statutory records cascade away with the tenant
**Severity: HIGH · Confidence: MEDIUM**

18 `ON DELETE CASCADE` foreign keys reach financial and audit tables — `bill_payments`,
`bill_amendments`, `journal_entries`, `journal_line_items`, `audit_records`, `phi_access_audit`,
`ndps_register`. Combined with the `purge_hospital*` function family, removing a hospital destroys
its payment history, its posted ledger, its PHI access audit, and its narcotics register.

Detailed in [`21_CRITICAL_FINDINGS.md § C-10`](21_CRITICAL_FINDINGS.md). Confidence is MEDIUM
because whether purge is used in production, and whether an archive precedes it, is not
determinable from the repository.

## R-5 · Bill totals are client-computed — see C-06
**Severity: HIGH**

`recalculate_bill_totals` does not exist; [`src/lib/billTotals.ts`](../../src/lib/billTotals.ts)
computes every monetary total in the browser and writes it to `bills`. No database constraint
re-derives `total_amount` from `bill_line_items`. Full detail in
[`21_CRITICAL_FINDINGS.md § C-06`](21_CRITICAL_FINDINGS.md).

The `bills` CHECK constraints cover `bill_status`, `bill_type` and `payment_status` — the
*categorical* fields — but no CHECK covers the *monetary* fields. Not even
`total_amount >= 0` or `balance_due >= 0`.

## R-6 · Two near-identical day-lock triggers on `bill_payments`
**Severity: LOW · Confidence: HIGH**

```
trg_prevent_payment_on_locked_bill_day → prevent_payment_on_locked_bill_day()
trg_prevent_payment_on_locked_day      → prevent_payment_on_locked_day()
```

Two triggers, two functions, one rule — the classic fingerprint of a second session solving an
already-solved problem without recognising it. Both fire on every payment insert.

Harmless (both enforce the same restriction, so the stricter wins) but it doubles the work per
payment and creates ambiguity about which is authoritative when the rule next changes.

---

## Claims: valid separation, not duplication

`insurance_claims` (62 columns), `pmjay_claims`, `govt_scheme_claims` and `hcx_claims` were
examined as a suspected duplication cluster. **Verdict: VALID SEPARATION.**

They model genuinely different payer regimes with different lifecycles, different mandatory
fields, and different external protocols — private TPA claims, the PM-JAY national scheme, state
government schemes, and the HCX exchange respectively. `insurance_claims` alone carries four
CHECK constraints covering appeal status, HCX status, rejection codes and submission mode; those
concepts do not apply to PM-JAY.

Merging them would force a single table to carry the union of four regulatory schemas. The
separation is correct healthcare-RCM modelling and should be preserved.

`insurance_claims` does show heavy accretion — 48 `ADD COLUMN` across 11 migrations, reaching 62
columns — which is worth a normalisation review, but that is a tidiness question, not a
correctness one.

## Assessment

The revenue-cycle design is **better than average and incompletely enforced**. The controls that
exist are real, thoughtful and database-resident: sequence assignment, day-close locking, discount
authorisation, GL auto-posting, refund resync. What is missing is uniqueness and arithmetic
integrity — the database will faithfully store a duplicate payment, a duplicate charge line, an
unbalanced journal, and a bill total that bears no relation to its line items.

Three of the five significant findings (R-1, R-2, R-3) are fixed by adding constraints to tables
that are otherwise correctly modelled. That is a contained remediation, not a redesign.

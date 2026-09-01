-- Phase 2 — revenue-cycle integrity constraints.
--
-- ROOT CAUSE (RC-6): constraints were added reactively as DATA repairs and never as constraints.
-- 20260613100000_fix_duplicate_consultation_line_items.sql cleaned duplicate rows but never added
-- the index that would stop them recurring, so the class stayed open after the instance was fixed.
--
-- WHY NOT THE OBVIOUS CONSTRAINT. The audit proposed UNIQUE (bill_id, service_id, service_date)
-- on line items and a (bill_id, amount, payment_date) guard on payments. Checked against live
-- data, both would have been WRONG:
--
--   bill_payments has 3 groups sharing (bill_id, amount, payment_date). All three are `cash`,
--   each with a DISTINCT payment_time and no gateway reference — i.e. genuinely separate cash
--   payments of the same amount on the same day, which is ordinary hospital front-desk
--   behaviour. That constraint would have rejected legitimate collections.
--
--   bill_line_items likewise has 7 such groups; two X-rays on one day is not a duplicate.
--
-- THE RIGHT KEYS ALREADY EXIST. This codebase already carries purpose-built idempotency keys,
-- and all three are currently violation-free:
--   bill_line_items.source_dedupe_key   0 violating groups  (132/216 populated)
--   bill_payments.gateway_reference     0 violating groups  (1/115 populated)
--   bill_payments.transaction_id        0 violating groups  (10/115 populated)
--
-- source_dedupe_key is the mechanism OT/ancillary charge posting already uses
-- (e.g. `ot:<schedule>:implant:<id>` in OTImplantsConsumablesTab). gateway_reference and
-- transaction_id are what a replayed Razorpay webhook would repeat. Constraining these prevents
-- the actual duplication mechanism without touching legitimate repeat transactions.
--
-- Partial indexes: NULL/'' is left unconstrained so manually-entered cash payments and
-- hand-added line items are unaffected.

BEGIN;

-- ── bill_line_items: charge posting is idempotent on its dedupe key ──────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS bill_line_items_dedupe_uq
  ON public.bill_line_items (bill_id, source_dedupe_key)
  WHERE source_dedupe_key IS NOT NULL;

-- ── bill_payments: a replayed gateway callback cannot post twice ─────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS bill_payments_gateway_ref_uq
  ON public.bill_payments (bill_id, gateway_reference)
  WHERE gateway_reference IS NOT NULL AND gateway_reference <> '';

CREATE UNIQUE INDEX IF NOT EXISTS bill_payments_transaction_id_uq
  ON public.bill_payments (bill_id, transaction_id)
  WHERE transaction_id IS NOT NULL AND transaction_id <> '';

-- ── bills: monetary sanity ───────────────────────────────────────────────────────────────────
-- bills had three CHECK constraints, all on CATEGORICAL columns (bill_status, bill_type,
-- payment_status) and none on the MONETARY ones. Since totals are computed client-side
-- (see src/lib/billTotals.ts — the recalculate_bill_totals RPC does not exist), the database
-- accepted any number at all, including negatives.
-- Verified before adding: 0 rows currently violate any of these.
ALTER TABLE public.bills
  ADD CONSTRAINT bills_total_amount_non_negative    CHECK (total_amount    IS NULL OR total_amount    >= 0) NOT VALID,
  ADD CONSTRAINT bills_balance_due_non_negative     CHECK (balance_due     IS NULL OR balance_due     >= 0) NOT VALID,
  ADD CONSTRAINT bills_paid_amount_non_negative     CHECK (paid_amount     IS NULL OR paid_amount     >= 0) NOT VALID,
  ADD CONSTRAINT bills_discount_amount_non_negative CHECK (discount_amount IS NULL OR discount_amount >= 0) NOT VALID;

-- Added NOT VALID then validated separately: VALIDATE takes only a SHARE UPDATE EXCLUSIVE lock,
-- so existing rows are checked without blocking concurrent writes to the bills table.
ALTER TABLE public.bills VALIDATE CONSTRAINT bills_total_amount_non_negative;
ALTER TABLE public.bills VALIDATE CONSTRAINT bills_balance_due_non_negative;
ALTER TABLE public.bills VALIDATE CONSTRAINT bills_paid_amount_non_negative;
ALTER TABLE public.bills VALIDATE CONSTRAINT bills_discount_amount_non_negative;

COMMIT;

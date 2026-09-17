-- Adds billing_status/bill_id/billed_at to mortuary_admissions, matching the pattern already
-- established on lab_orders/radiology_orders (20260516000001).
--
-- WHY. Found live alongside 20261106000030's bill_type gap: autoChargeService's own
-- idempotency guard reads `sourceTable`.`billing_status` before charging, and writes
-- `billing_status`/`bill_id`/`billed_at` back onto the source row after a successful charge
-- (src/lib/serviceBilling.ts). MortuaryPage.tsx's handleRelease passes
-- sourceTable: "mortuary_admissions" for exactly this reason — but the column never existed,
-- so both the guard read and the post-charge write have always failed silently (Supabase
-- returns errors as values; neither call site checks them). The practical effect: even once
-- 20261106000030 lets a mortuary release actually bill, nothing can ever mark that admission
-- "billed" — the idempotency guard can never see anything but "not yet billed", which would
-- have let a retried or repeated release call double-charge the family for the same body.
--
-- Likely a wider pattern (other autoChargeService "standalone" callers may point sourceTable
-- at a table with the same gap) — scoped here to mortuary_admissions, the one this phase's
-- work actually exercises live; not audited further in this pass.

ALTER TABLE public.mortuary_admissions
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'unbilled'
    CHECK (billing_status IN ('unbilled', 'billed', 'waived')),
  ADD COLUMN IF NOT EXISTS bill_id uuid REFERENCES public.bills(id),
  ADD COLUMN IF NOT EXISTS billed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_mortuary_admissions_billing_status
  ON public.mortuary_admissions(hospital_id, billing_status);

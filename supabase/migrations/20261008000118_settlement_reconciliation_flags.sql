-- ============================================================
-- MRR ↔ Razorpay settlement reconciliation — flags table
-- ============================================================
-- Written by razorpay-settlement-reconcile (new edge function). For every
-- subscription_invoices row with a razorpay_payment_id, checks the real
-- Razorpay payment record and flags anything that doesn't match what we
-- believe was paid — this is what makes the MRR number verifiable against
-- real captured cash instead of just what our own DB claims.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.settlement_reconciliation_flags (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id        uuid NOT NULL REFERENCES public.subscription_invoices(id) ON DELETE CASCADE,
  hospital_id       uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  expected_amount   numeric(12,2) NOT NULL,
  settled_amount    numeric(12,2),
  discrepancy_type  text NOT NULL CHECK (discrepancy_type IN ('payment_not_found', 'not_captured', 'amount_mismatch', 'refunded')),
  razorpay_status   text,
  flagged_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  resolved_by       uuid REFERENCES public.users(id),
  resolution_note   text
);

CREATE INDEX IF NOT EXISTS idx_settlement_flags_unresolved
  ON public.settlement_reconciliation_flags (flagged_at DESC)
  WHERE resolved_at IS NULL;

-- One open flag per invoice at a time — re-running the scan updates rather
-- than duplicates while a discrepancy is still open.
CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_flags_invoice_open
  ON public.settlement_reconciliation_flags (invoice_id)
  WHERE resolved_at IS NULL;

ALTER TABLE public.settlement_reconciliation_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settlement_flags_admin_read" ON public.settlement_reconciliation_flags;
CREATE POLICY "settlement_flags_admin_read" ON public.settlement_reconciliation_flags
  FOR SELECT TO authenticated USING (public.is_aumrti_admin());

DROP POLICY IF EXISTS "settlement_flags_admin_update" ON public.settlement_reconciliation_flags;
CREATE POLICY "settlement_flags_admin_update" ON public.settlement_reconciliation_flags
  FOR UPDATE TO authenticated USING (public.is_aumrti_admin()) WITH CHECK (public.is_aumrti_admin());

-- Insert is service-role only (the scheduled edge function).

-- subscription_invoices only had hospital-own-read + service-role-all — no
-- admin read policy existed, which the reconciliation UI needs to join
-- invoice details for flagged rows.
DROP POLICY IF EXISTS "aumrti_admin_invoices_select" ON public.subscription_invoices;
CREATE POLICY "aumrti_admin_invoices_select" ON public.subscription_invoices
  FOR SELECT TO authenticated USING (public.is_aumrti_admin());

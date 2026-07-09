-- Pharmacy gap-fix plan, Phase 2 — Refund Approvals inbox needs a place to
-- record why a pending refund was rejected, matching the pattern already
-- used by bill_discount_approvals.rejection_reason.
ALTER TABLE public.refund_payables ADD COLUMN IF NOT EXISTS rejection_reason text;

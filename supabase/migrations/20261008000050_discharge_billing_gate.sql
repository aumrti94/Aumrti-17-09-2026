-- Billing gap-fill plan, Phase 11 — IPD discharge billing-completeness
-- becomes a real gate instead of advisory. billing_cleared previously
-- flipped true the moment ANY bill for the admission was paid, regardless
-- of whether every clinical charge (implants, OT, labs, nursing) actually
-- landed on a bill, and the OT-clearance step's missing-charge warning was
-- toast-only. Adding documented-override columns (same convention as
-- ot_checklists.skip_reason/skip_reason_by/skip_reason_at) so a hard block
-- can still be bypassed with an audited reason, plus a LAMA billing-waiver
-- acknowledgment (checkbox + audit, not a silent waive).

ALTER TABLE public.admissions
  ADD COLUMN IF NOT EXISTS discharge_billing_override_reason text,
  ADD COLUMN IF NOT EXISTS discharge_billing_override_by uuid,
  ADD COLUMN IF NOT EXISTS discharge_billing_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS lama_billing_ack_by uuid,
  ADD COLUMN IF NOT EXISTS lama_billing_ack_at timestamptz;

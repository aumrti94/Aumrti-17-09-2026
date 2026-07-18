-- ============================================================================
-- Direct discharge (without discharge-summary e-signature)
-- ----------------------------------------------------------------------------
-- The IPD discharge workflow only ever allowed discharge through the NABH
-- COP.10 e-signature gate (DischargeSummaryGenerator → executeDischarge).
-- Wards need a way to release a patient when a signature cannot be captured at
-- that moment, without the signature fields ever being falsified.
--
-- These columns record WHY the signature was skipped, by whom, and when —
-- mirroring the existing discharge_billing_override_* pattern on this table.
-- discharge_signed_by / _at / _signature_hash stay NULL on this path, so
-- "signed" continues to mean a real captured signature and nothing else.
--
-- STRICTLY ADDITIVE: no existing column is dropped, renamed, or re-defaulted.
-- Idempotent: safe to re-run.
-- ============================================================================

ALTER TABLE public.admissions
  ADD COLUMN IF NOT EXISTS discharge_unsigned_reason text,
  ADD COLUMN IF NOT EXISTS discharge_unsigned_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS discharge_unsigned_at timestamptz;

COMMENT ON COLUMN public.admissions.discharge_unsigned_reason IS
  'Mandatory reason captured when a patient is discharged without a signed discharge summary. NULL for signed discharges.';

-- Audit surface: find every discharge that bypassed the signature gate.
CREATE INDEX IF NOT EXISTS idx_admissions_discharge_unsigned
  ON public.admissions(hospital_id, discharge_unsigned_at)
  WHERE discharge_unsigned_reason IS NOT NULL;

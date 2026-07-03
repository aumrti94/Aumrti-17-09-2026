-- OT Gap review (Phase 3): consultant e-signature required to close an OT case
ALTER TABLE public.anaesthesia_records
  ADD COLUMN IF NOT EXISTS consultant_signature text,
  ADD COLUMN IF NOT EXISTS signed_by uuid,
  ADD COLUMN IF NOT EXISTS signed_at timestamptz;

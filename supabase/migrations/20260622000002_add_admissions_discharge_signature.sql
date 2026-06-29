-- Sprint 1B: e-signature fields for discharge summary (NABH COP.10 compliance)
ALTER TABLE public.admissions
  ADD COLUMN IF NOT EXISTS discharge_signed_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS discharge_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS discharge_signature_hash text;

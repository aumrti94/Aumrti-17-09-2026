-- OT Gap review (Phase 2): e-signature per WHO SSC phase + who/when documented a skip exception
ALTER TABLE public.ot_checklists
  ADD COLUMN IF NOT EXISTS signin_signature text,
  ADD COLUMN IF NOT EXISTS timeout_signature text,
  ADD COLUMN IF NOT EXISTS signout_signature text,
  ADD COLUMN IF NOT EXISTS skip_reason_by uuid,
  ADD COLUMN IF NOT EXISTS skip_reason_at timestamptz;

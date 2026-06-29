-- Sprint 4B: store 5-rights checkbox data as JSONB in mar_double_checks
ALTER TABLE public.mar_double_checks
  ADD COLUMN IF NOT EXISTS second_nurse_verified_rights jsonb;

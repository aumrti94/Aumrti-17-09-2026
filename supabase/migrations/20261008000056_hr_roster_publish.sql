-- ============================================================
-- HR — Roster publish support
-- Adds a published_at timestamp so a week's duty roster can be
-- explicitly published (vs. draft). Purely additive.
-- ============================================================

ALTER TABLE public.duty_roster
  ADD COLUMN IF NOT EXISTS published_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS published_by uuid NULL REFERENCES public.users(id);

-- Sprint 1A: allow documented emergency bypass of WHO SSC checklist
ALTER TABLE public.ot_checklists
  ADD COLUMN IF NOT EXISTS skip_reason text;

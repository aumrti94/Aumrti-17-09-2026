-- ============================================================
-- OT — privilege override audit
-- When an OT case is confirmed/started for a surgeon without an active
-- clinical privilege, the acting user must record an override reason.
-- ============================================================

ALTER TABLE public.ot_schedules
  ADD COLUMN IF NOT EXISTS privilege_override_reason text,
  ADD COLUMN IF NOT EXISTS privilege_override_by     uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS privilege_override_at     timestamptz;

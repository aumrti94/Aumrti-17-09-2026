-- ============================================================
-- Soft-delete grace window for hospitals
-- ============================================================
-- purge_hospital() (20260602150001_hospital_delete_complete.sql) runs an
-- irreversible, ordered cascade across ~79 tables the moment delete-hospital
-- is invoked. The frontend already has a two-step type-to-confirm dialog,
-- but there was no recovery window between "confirmed" and "gone forever".
--
-- This adds a nullable deleted_at marker so delete-hospital can be changed
-- to a two-phase flow: first call marks the hospital for deletion, a second
-- call (after the grace period has elapsed) actually purges it.
-- ============================================================

ALTER TABLE public.hospitals
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_hospitals_deleted_at
  ON public.hospitals (deleted_at)
  WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN public.hospitals.deleted_at IS
  'Set when an aumrti_admin marks a hospital for deletion. purge_hospital() should only run once this has been set for at least the grace period (7 days) — see supabase/functions/delete-hospital. NULL means the hospital is not marked for deletion.';

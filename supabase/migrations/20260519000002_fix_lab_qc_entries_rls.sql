-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: fix_lab_qc_entries_rls
-- Purpose  : Remove anonymous (unauthenticated) read and write access on
--            lab_qc_entries. Migration 20260331070613 created this table with
--            USING(true) / WITH CHECK(true) policies granting anon access —
--            a CAP-D patient-safety violation. Replace with hospital-isolation
--            authenticated-only policies matching the standard pattern.
-- Idempotent: Dynamic DROP of all existing policies, then CREATE.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.lab_qc_entries ENABLE ROW LEVEL SECURITY;

-- Drop ALL existing policies on this table (handles unknown anon policy names)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'lab_qc_entries'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.lab_qc_entries', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "lab_qc_entries_select" ON public.lab_qc_entries
  FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "lab_qc_entries_all" ON public.lab_qc_entries
  FOR ALL TO authenticated
  USING  (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

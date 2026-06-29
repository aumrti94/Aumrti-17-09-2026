-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: fix_v9_emr_rls
-- Purpose  : Five tables created in 20260501145300_v9_emr_procurement_foundation
--            have RLS policies using:
--              WHERE id = auth.uid()
--            which is WRONG. The `id` column is a gen_random_uuid() application
--            key; the auth UID is stored in `auth_user_id`. These policies
--            effectively return zero rows for all users. Fix: replace with
--            get_user_hospital_id() which correctly uses auth_user_id internally.
-- Idempotent: DROP POLICY IF EXISTS before every CREATE POLICY.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t    text;
  tables text[] := ARRAY[
    'emr_template_definitions',
    'patient_encounter_templates',
    'patient_template_responses',
    'demand_forecasts',
    'procurement_recommendations'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      t || '_select', t
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      t || '_all', t
    );
    EXECUTE format(
      $sql$
      CREATE POLICY %I ON public.%I
        FOR SELECT TO authenticated
        USING (hospital_id = public.get_user_hospital_id())
      $sql$,
      t || '_select', t
    );
    EXECUTE format(
      $sql$
      CREATE POLICY %I ON public.%I
        FOR ALL TO authenticated
        USING  (hospital_id = public.get_user_hospital_id())
        WITH CHECK (hospital_id = public.get_user_hospital_id())
      $sql$,
      t || '_all', t
    );
  END LOOP;
END $$;

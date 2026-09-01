-- BUG-P4-005 — the CGHS/ECHS referral check could never run on a freshly migrated database.
--
-- ROOT CAUSE. BillEditor.handleFinalize refuses to finalise a CGHS/ECHS bill unless a
-- cghs_echs_beneficiaries row exists for that patient with a non-null referral_date:
--
--     .from("cghs_echs_beneficiaries")
--     .select("referral_date, referral_hospital")
--     .eq("patient_id", bill.patient_id).eq("hospital_id", hospitalId)
--     .not("referral_date", "is", null)
--
-- but `patient_id` is NOT in that table's CREATE statement (20260901000010). It is added by a
-- guarded ALTER in 20260521000005_govt_schemes.sql:
--
--     IF EXISTS (SELECT 1 FROM information_schema.tables
--                WHERE table_schema='public' AND table_name='cghs_echs_beneficiaries') THEN
--       ALTER TABLE cghs_echs_beneficiaries ADD COLUMN IF NOT EXISTS patient_id uuid, ...
--
-- Migrations replay in filename order, and 20260521 sorts BEFORE 20260901 — so on any fresh
-- database the guard finds no table, the ALTER silently skips, and the column never exists.
-- The finalisation query then errors, `cghs` comes back null, and the block fires for EVERY
-- CGHS/ECHS patient, including the ones holding a valid referral letter. That is not a safe
-- failure: it is a hard stop on legitimate government billing that looks exactly like the
-- feature working correctly, and the desk's workaround is to re-register the patient as cash,
-- which loses the claim entirely.
--
-- This migration re-applies the columns unconditionally, AFTER the table certainly exists.
-- It is idempotent, so a database where the original ALTER did run is unaffected.
--
-- Locked by TC-P4D-009 (the column exists) and TC-P4D-012 (a referred patient finalises).

ALTER TABLE public.cghs_echs_beneficiaries
  ADD COLUMN IF NOT EXISTS patient_id       uuid REFERENCES public.patients(id),
  ADD COLUMN IF NOT EXISTS scheme_type      text,
  ADD COLUMN IF NOT EXISTS beneficiary_id   text,
  ADD COLUMN IF NOT EXISTS card_number      text,
  ADD COLUMN IF NOT EXISTS dispensary_name  text,
  ADD COLUMN IF NOT EXISTS employee_name    text,
  ADD COLUMN IF NOT EXISTS relationship     text DEFAULT 'self',
  ADD COLUMN IF NOT EXISTS ward_entitlement text,
  ADD COLUMN IF NOT EXISTS status           text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS valid_till       date;

COMMENT ON COLUMN public.cghs_echs_beneficiaries.patient_id IS
  'The patient this CGHS/ECHS card belongs to. BillEditor.handleFinalize filters on this '
  'column to decide whether a referral is on file, so it is load-bearing, not descriptive.';

-- handleFinalize filters on (patient_id, hospital_id) and then on referral_date NOT NULL.
CREATE INDEX IF NOT EXISTS idx_cghs_echs_patient
  ON public.cghs_echs_beneficiaries (patient_id);

CREATE INDEX IF NOT EXISTS idx_cghs_echs_referral_lookup
  ON public.cghs_echs_beneficiaries (hospital_id, patient_id)
  WHERE referral_date IS NOT NULL;

-- The service-role policy in 20260521000005 is inside the same skipped guard, so re-create it.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cghs_echs_beneficiaries' AND policyname = 'cghs_echs_service_role'
  ) THEN
    EXECUTE 'CREATE POLICY "cghs_echs_service_role" ON public.cghs_echs_beneficiaries '
            'TO service_role USING (true) WITH CHECK (true)';
  END IF;
END $$;

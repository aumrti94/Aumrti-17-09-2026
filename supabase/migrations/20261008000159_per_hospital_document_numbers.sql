-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: per_hospital_document_numbers
-- Purpose  : Make document numbers unique PER HOSPITAL instead of globally, so two
--            hospitals can each run their own series starting at 0001.
--
--            Symptom that surfaced this:
--              "duplicate key value violates unique constraint
--               advance_receipts_receipt_number_key"
--            raised when collecting a day care advance in a second hospital.
--
--            Every generator in the app numbers per-hospital-per-day —
--            generate_bill_number() → ADV-20260721-0001, generate_admission_number()
--            → DC-20260721-0004, next_seq() → JE-2026-0001. But the constraints these
--            rows land on were declared `<col> text UNIQUE NOT NULL`, which is GLOBAL
--            across every tenant. So the first hospital to issue a number takes it out
--            of circulation for all the others, permanently. It is not a day care bug;
--            it hits whichever module a second hospital touches first.
--
--            `bills` shows this was always meant to be per-hospital: 20260622000005
--            ADDED bills_hospital_bill_number_key UNIQUE (hospital_id, bill_number) but
--            never DROPPED the original global bills_bill_number_key, so bills still
--            collide across hospitals. This migration finishes that job and applies the
--            same treatment to the other 26 document-number columns.
--
-- Safety   : the existing GLOBAL unique already guarantees no two rows anywhere share a
--            number, so (hospital_id, <col>) is trivially unique on today's data and the
--            ADD can never fail. Verified before writing: no FOREIGN KEY references any
--            of these unique constraints, and no ON CONFLICT clause targets these
--            columns, so the DROP cannot break a dependency either.
--
-- Order    : ADD the per-hospital constraint FIRST, then DROP the global one — there is
--            never an instant where the column is unguarded.
--
-- Idempotent: the ADD is skipped when the target constraint name already exists (this is
--            what makes `bills` a drop-only case), and the DROP is IF EXISTS.
--
-- NOT converted — these are deliberately global and must stay that way:
--   • Security tokens, which must be unguessable and globally distinct:
--       patient_portal_sessions.session_token, payment_links.link_token,
--       prom_prem_surveys.response_token, teleconsult_sessions.room_id
--   • Externally-issued or platform-level identifiers:
--       abdm_consents.consent_id      (assigned by ABDM, not by us)
--       referral_codes.code           (one platform-wide namespace by design)
--       subscription_invoices.invoice_number (the PLATFORM is the GST issuer here —
--                                     a single invoice series is the correct behaviour)
--   • 1:1 foreign keys: blood_unit_tti_tests.unit_id, staff_profiles.user_id
--   • Composites already scoped through a hospital-scoped FK (doctor_quick_picks,
--     nursing_mar, payslips, store_stock, ot_*, …)
-- ─────────────────────────────────────────────────────────────────────────────

-- lms_courses is the only one of the 27 whose hospital_id is nullable, which would let
-- NULL-hospital rows slip past the composite constraint (Postgres treats NULLs as
-- distinct). Its sibling tables (lms_enrollments, lms_certificates) are already NOT NULL,
-- so this is an oversight rather than a "global course library" design. The table is
-- empty, so tightening it cannot fail or strand a row.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'lms_courses'
      AND column_name = 'hospital_id' AND is_nullable = 'YES'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.lms_courses WHERE hospital_id IS NULL
  ) THEN
    ALTER TABLE public.lms_courses ALTER COLUMN hospital_id SET NOT NULL;
  END IF;
END;
$$;

DO $$
DECLARE
  r            record;
  v_new_name   text;
  v_old_name   text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- Billing
      ('advance_receipts',     'receipt_number'),      -- the reported failure
      ('bills',                'bill_number'),         -- drop-only; ADD already done in 20260622000005
      -- IPD / Day care
      ('admissions',           'admission_number'),
      -- Finance
      ('journal_entries',      'entry_number'),
      -- Pharmacy
      ('pharmacy_dispensing',  'dispensing_number'),
      -- Procurement
      ('purchase_orders',      'po_number'),
      ('grn_records',          'grn_number'),
      ('department_indents',   'indent_number'),
      -- Radiology
      ('radiology_orders',     'accession_number'),
      -- Insurance
      ('pmjay_claims',         'claim_number'),
      -- Quality
      ('incident_reports',     'incident_number'),
      ('capa_records',         'capa_number'),
      -- Mortuary / ED
      ('mlc_records',          'mlc_number'),
      ('mortuary_admissions',  'body_number'),
      ('mccd_certificates',    'mccd_number'),
      ('death_certificates',   'mccd_form_number'),
      -- Blood bank
      ('blood_units',          'unit_number'),
      ('donors',               'donor_code'),
      -- OT / CSSD
      ('sterilization_cycles', 'cycle_number'),
      ('instrument_sets',      'set_code'),
      ('instruments',          'barcode'),
      -- Lab / MRD
      ('lab_samples',          'barcode'),
      ('medical_records',      'barcode'),
      -- Facilities
      ('visitor_passes',       'pass_number'),
      -- IVF
      ('art_couples',          'couple_code'),
      -- LMS
      ('lms_courses',          'course_code'),
      ('lms_certificates',     'certificate_number')
    ) AS t(tbl, col)
  LOOP
    -- Skip silently if the table or either column is absent, so this migration stays
    -- applicable to a database that has not run every optional module migration.
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = r.col
    );
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = 'hospital_id'
    );

    -- Matches the name 20260622000005 already used for bills, so that table is
    -- recognised as done and falls through to the DROP.
    v_new_name := r.tbl || '_hospital_' || r.col || '_key';
    v_old_name := r.tbl || '_' || r.col || '_key';

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = v_new_name AND conrelid = ('public.' || r.tbl)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (hospital_id, %I)',
        r.tbl, v_new_name, r.col
      );
      RAISE NOTICE 'added %', v_new_name;
    END IF;

    -- Only now is it safe to release the global one.
    EXECUTE format(
      'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
      r.tbl, v_old_name
    );
  END LOOP;
END;
$$;

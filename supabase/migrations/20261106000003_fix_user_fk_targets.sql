-- Repoint staff-attribution `*_by` foreign keys from auth.users(id) to public.users(id).
--
-- THE BUG. Every save in the ICU Workspace failed with a foreign-key violation
-- (icu_flowsheet_entries_recorded_by_fkey and its five siblings). The application is
-- correct: HospitalContext resolves the signed-in auth user to their public.users row and
-- publishes users.id, exactly as every other module consumes it. The SCHEMA was wrong —
-- 20260910000005_icu_workspace.sql declared all six columns REFERENCES auth.users(id).
--
-- WHY IT EVER WORKED. The original schema (20260321162749) defined
-- `public.users.id uuid PRIMARY KEY REFERENCES auth.users(id)`, so users.id WAS the auth
-- uid and an auth.users FK was satisfied by accident. 20260322111223 deliberately broke
-- that coupling: it added users.auth_user_id, dropped users_id_fkey, and repointed
-- get_user_hospital_id()/has_role() at auth_user_id. Since then users.id is a free-standing
-- UUID, and only legacy backfilled rows still satisfy id == auth_user_id. So these tables
-- accept writes from pre-decoupling accounts and reject everyone created afterwards —
-- exactly the "worked once, broken now" behaviour reported.
--
-- SCOPE. Auditing the whole migration tree (scripts/check-user-fk-convention.mjs) found the
-- same defect on 40 columns, not six. Most have a live write path and are therefore broken
-- right now — including nursing_mar.administered_by, the Medication Administration Record,
-- which is the most safety-critical of the set. Columns that genuinely hold an auth uid
-- (written from supabase.auth.getUser(): the platform/control-plane tables, user_mfa,
-- mobile_fcm_tokens, notifications, stock_reorder_triggers, hospital_module_entitlements,
-- hospital_addons) are deliberately NOT touched — for those, auth.users is the correct target.
--
-- DATA. Existing rows are REMAPPED, not discarded: a stored auth uid is translated to the
-- owning public.users.id via auth_user_id. NABH treats "who recorded this / who administered
-- this drug" as evidence, so attribution has to survive the repair. Only values matching no
-- user at all are set to NULL.
--
-- WHY A LOOP. Forty columns × (remap + blank orphans + drop + re-add) is 160 near-identical
-- statements; written out longhand nobody would review it and a single transposed column
-- name would be invisible. The list below IS the change — everything after it is mechanical.
-- The old constraint is located via pg_constraint rather than by assuming the
-- `<table>_<column>_fkey` default name, and tables/columns that do not exist in a given
-- database are skipped, so this is safe to run against a partially-migrated environment.

BEGIN;

DO $$
DECLARE
  r          record;
  v_relid    oid;
  v_attnum   smallint;
  v_notnull  boolean;
  v_conname  text;
  v_newname  text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- ICU Workspace (the reported failure) — 20260910000005
      ('icu_flowsheet_entries',       'recorded_by'),
      ('io_balance_records',          'recorded_by'),
      ('ventilator_params',           'recorded_by'),
      ('sedation_scores',             'recorded_by'),
      ('icu_daily_goals',             'updated_by'),
      ('care_bundle_checks',          'recorded_by'),
      -- Medication Administration Record — 20260322102931 (safety-critical)
      ('nursing_mar',                 'administered_by'),
      -- Medication Reconciliation — 20260910000007
      ('bpmh_records',                'recorded_by'),
      ('med_reconciliation_events',   'reconciled_by'),
      ('med_reconciliation_events',   'verified_by'),
      ('reconciliation_discrepancies','resolved_by'),
      ('high_alert_double_checks',    'first_check_by'),   -- NOT NULL; handled below
      ('high_alert_double_checks',    'second_check_by'),
      -- Nutrition & wound care — 20260910000008
      ('nutrition_screenings',        'screened_by'),
      ('dietitian_notes',             'noted_by'),
      ('wound_assessments',           'assessed_by'),
      ('braden_scale_assessments',    'assessed_by'),
      -- Dental — 20260901000000
      ('dental_charts',               'created_by'),
      ('periodontal_charts',          'created_by'),
      ('dental_treatment_plans',      'created_by'),
      ('dental_lab_orders',           'ordered_by'),
      -- IVF / ART — 20260901000001
      ('art_couples',                 'treating_doctor'),
      ('stimulation_monitoring',      'recorded_by'),
      ('andrology_reports',           'reported_by'),
      ('embryology_records',          'recorded_by'),
      -- Vaccination — 20260901000002
      ('vaccination_records',         'administered_by'),
      ('cold_chain_log',              'recorded_by'),
      -- ERP / MCI / JCI — 20260910000010
      ('budget_lines',                'created_by'),
      ('budget_lines',                'approved_by'),
      ('mci_events',                  'activated_by'),
      ('mci_events',                  'deactivated_by'),
      ('mci_triage_patients',         'triaged_by'),
      ('jci_evidence_items',          'assessed_by'),
      -- Research / NPS — 20260910000011
      ('research_cohorts',            'created_by'),
      -- Remaining clinical/operational strays
      ('revenue_alerts',              'resolved_by'),
      ('pmjay_preauth_requests',      'requested_by'),
      ('package_station_logs',        'completed_by'),
      ('referral_partners',           'created_by'),
      ('referral_codes',              'created_by'),
      ('order_name_aliases',          'created_by')
    ) AS t(tbl, col)
  LOOP
    v_relid := to_regclass('public.' || quote_ident(r.tbl));
    CONTINUE WHEN v_relid IS NULL;                       -- table not in this database

    SELECT attnum, attnotnull INTO v_attnum, v_notnull
      FROM pg_attribute
     WHERE attrelid = v_relid AND attname = r.col AND NOT attisdropped;
    CONTINUE WHEN v_attnum IS NULL;                      -- column not in this database

    -- Locate the existing FK on this column that points at auth.users, by catalog rather
    -- than by guessing its name.
    SELECT conname INTO v_conname
      FROM pg_constraint
     WHERE conrelid = v_relid
       AND contype  = 'f'
       AND confrelid = 'auth.users'::regclass
       AND conkey = ARRAY[v_attnum]::smallint[]
     LIMIT 1;
    CONTINUE WHEN v_conname IS NULL;                     -- already repointed; idempotent

    -- 1. Preserve attribution: auth uid -> the owning public.users.id.
    EXECUTE format(
      'UPDATE public.%I t SET %I = u.id FROM public.users u
        WHERE t.%I = u.auth_user_id AND t.%I IS DISTINCT FROM u.id',
      r.tbl, r.col, r.col, r.col);

    -- 2. Blank values that match no user at all. Impossible on a NOT NULL column, which is
    --    why that case gets NOT VALID treatment in step 3 instead.
    IF NOT v_notnull THEN
      EXECUTE format(
        'UPDATE public.%I SET %I = NULL
          WHERE %I IS NOT NULL AND %I NOT IN (SELECT id FROM public.users)',
        r.tbl, r.col, r.col, r.col);
    END IF;

    -- 3. Swap the constraint. Keep the conventional name so the codebase's error messages
    --    and the perf-index migration's comments still line up.
    v_newname := r.tbl || '_' || r.col || '_fkey';
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tbl, v_conname);

    IF v_notnull THEN
      -- ON DELETE SET NULL is illegal on a NOT NULL column, and step 2 could not clean it.
      -- Attach NOT VALID so new rows are enforced immediately, then try to validate: a
      -- pre-existing orphan raises a NOTICE instead of aborting the whole push. Same
      -- approach as 20261016000013_rcm_integrity_constraints.sql.
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I)
           REFERENCES public.users(id) ON DELETE RESTRICT NOT VALID',
        r.tbl, v_newname, r.col);
      BEGIN
        EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', r.tbl, v_newname);
      EXCEPTION WHEN others THEN
        RAISE NOTICE '%.% has rows referencing no public.users row; constraint left NOT VALID and enforced for new rows only. Repair those rows, then: ALTER TABLE public.% VALIDATE CONSTRAINT %;',
          r.tbl, r.col, r.tbl, v_newname;
      END;
    ELSE
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I)
           REFERENCES public.users(id) ON DELETE SET NULL',
        r.tbl, v_newname, r.col);
    END IF;

    RAISE NOTICE 'repointed %.% -> public.users(id)', r.tbl, r.col;
  END LOOP;
END $$;

COMMIT;

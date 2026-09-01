-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- API Platform — make the columns the public API paginates on NOT NULL
--
-- ── The defect ───────────────────────────────────────────────────────────────────────────────
-- The gateway paginates by keyset: `WHERE sort_col > :cursor OR (sort_col = :cursor AND id > :id)`.
-- In Postgres every comparison against NULL yields NULL, so a row whose sort column is NULL
-- matches no page after the first and becomes silently unreachable. The list is quietly
-- incomplete — no error, no warning, and the integrator has no way to detect it.
--
-- Each of these tables declares created_at with DEFAULT now() but WITHOUT a NOT NULL constraint,
-- so the guarantee the API depends on was assumed rather than enforced. Any code path inserting
-- an explicit NULL would hide those rows from every partner integration for good.
--
-- ── Why this shape ───────────────────────────────────────────────────────────────────────────
-- A bare `SET NOT NULL` takes an ACCESS EXCLUSIVE lock and scans the whole table, blocking reads
-- AND writes for the duration. On admissions or lab_order_items at a busy hospital that is an
-- outage during ward rounds, which Lakshmi's 99.5%-during-hospital-hours rule does not permit.
--
-- So this uses the standard zero-downtime sequence (PostgreSQL 12+):
--   1. ADD CHECK (col IS NOT NULL) NOT VALID   — instant, no scan
--   2. VALIDATE CONSTRAINT                     — scans under SHARE UPDATE EXCLUSIVE, which does
--                                                not block reads or writes
--   3. SET NOT NULL                            — the planner trusts the validated constraint and
--                                                skips its own scan
--   4. DROP the now-redundant CHECK
--
-- Idempotent throughout: safe to re-run, and skips any table already NOT NULL.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  -- Exactly the tables the API paginates on. Deliberately NOT every table with a created_at:
  -- this migration exists to back a specific guarantee, and widening it would lock tables for
  -- no reason.
  v_tables text[] := ARRAY[
    'admissions', 'bill_payments', 'blood_requests', 'blood_units', 'dialysis_sessions',
    'ed_visits', 'insurance_claims', 'insurance_pre_auth', 'inventory_items',
    'lab_order_items', 'lab_orders', 'opd_encounters', 'pharmacy_dispensing',
    'prescriptions', 'radiology_orders', 'radiology_reports', 'stock_transactions',
    'tpa_queries', 'vaccination_records'
  ];
  v_table    text;
  v_check    text;
  v_nulls    bigint;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP

    -- Skip anything absent from this environment rather than aborting the whole push.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = v_table AND column_name = 'created_at'
    ) THEN
      RAISE NOTICE 'skip %: no created_at column', v_table;
      CONTINUE;
    END IF;

    -- Already NOT NULL: nothing to do, and re-running the dance would lock for no gain.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = v_table
         AND column_name = 'created_at' AND is_nullable = 'NO'
    ) THEN
      CONTINUE;
    END IF;

    -- Backfill. DEFAULT now() means this should find nothing, but a row predating the default —
    -- or inserted with an explicit NULL — would make step 2 fail and abort the migration.
    EXECUTE format(
      'UPDATE public.%I SET created_at = COALESCE(created_at, now()) WHERE created_at IS NULL',
      v_table
    );
    GET DIAGNOSTICS v_nulls = ROW_COUNT;
    IF v_nulls > 0 THEN
      -- Worth surfacing: these rows were invisible to the paginated API until now.
      RAISE NOTICE 'backfilled % NULL created_at row(s) in %', v_nulls, v_table;
    END IF;

    v_check := v_table || '_created_at_not_null';

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = v_check AND conrelid = format('public.%I', v_table)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (created_at IS NOT NULL) NOT VALID',
        v_table, v_check
      );
    END IF;

    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', v_table, v_check);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN created_at SET NOT NULL', v_table);
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', v_table, v_check);

    -- A NULL default would reintroduce the problem through the front door.
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN created_at SET DEFAULT now()', v_table);

    RAISE NOTICE 'created_at is now NOT NULL on %', v_table;

  END LOOP;
END $$;

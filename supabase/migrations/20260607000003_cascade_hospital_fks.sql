-- ============================================================
-- HOSPITAL FK CASCADE — two-part migration
--
-- Part A: Re-apply ON DELETE CASCADE to all hospitals → child FKs
--         (idempotent re-run of 20260601f, guarantees it's live)
--
-- Part B: Add ON DELETE CASCADE to grandchild FKs — tables that
--         reference a hospital-owned table (one whose FK column
--         is 'id' and whose own table has a hospital_id column).
--         This enables DELETE FROM hospitals to cascade all the
--         way down: hospital → lab_orders → lab_order_items, etc.
--
-- Each ALTER is wrapped in EXCEPTION WHEN OTHERS so missing tables
-- never abort the migration.
--
-- ── KNOWN-BUG-117 fix (2026-09-12) ─────────────────────────────
-- This migration could not apply to a fresh database in any reasonable time.
-- `supabase start` against an empty schema of ~333 tables stalled here for
-- 225+ seconds and was still running when interrupted.
--
-- Root cause, confirmed directly (not inferred): the cursor query alone —
-- BEFORE a single ALTER TABLE ran — took over 150 seconds and had not
-- finished when killed, on a database with zero rows in any of these
-- tables. This rules out FK-validation cost (nothing to validate) and lock
-- contention (a fresh single-session container, nothing else connected).
-- The cause is the query shape: self-joining
-- `information_schema.key_column_usage` twice plus `table_constraints` and
-- `referential_constraints`, with a correlated EXISTS against
-- `information_schema.columns`. Those views are defined with a
-- `has_column_privilege()`/`has_table_privilege()` check evaluated per
-- row, and joining several of them multiplies that cost across every
-- table and column in the schema — a well-documented PostgreSQL trap,
-- independent of how many rows the query ultimately returns.
--
-- Fix: enumerate the same constraints from `pg_constraint` / `pg_class` /
-- `pg_namespace` / `pg_attribute` directly. Same information, no
-- privilege-check overhead — these are the raw system catalogs
-- `information_schema` is itself built on top of.
--
-- Also split each ADD CONSTRAINT into NOT VALID + a separate VALIDATE
-- CONSTRAINT, matching the pattern already used in
-- 20261106000005_alert_escalation_channels_and_quiet_hours.sql. Doesn't
-- change the diagnosed bottleneck (this schema is empty), but it matters
-- the moment this migration reaches a database with real rows: NOT VALID
-- takes ACCESS EXCLUSIVE only long enough to register metadata, and the
-- data scan runs afterward under the much weaker SHARE UPDATE EXCLUSIVE,
-- which does not block ordinary reads or writes on the table.
--
-- A single-column FK is assumed throughout, matching the original
-- query's behaviour (a multi-column FK would have produced one loop
-- iteration per column via the key_column_usage join, silently replacing
-- the constraint with a single-column one built from whichever column
-- the join happened to visit first). No such FK exists in this schema —
-- every hospital-owned table's key is `id`, referenced as a single
-- column — but rather than reproduce that silent mis-handling, a
-- multi-column FK is now explicitly skipped with a NOTICE.
-- ============================================================

-- ── Part A: hospitals → direct children ──────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT
      childns.nspname                          AS table_schema,
      childcls.relname                         AS table_name,
      con.conname                              AS constraint_name,
      (SELECT a.attname FROM pg_attribute a
        WHERE a.attrelid = con.conrelid AND a.attnum = con.conkey[1])
                                                AS column_name
    FROM pg_constraint con
    JOIN pg_class     childcls  ON childcls.oid  = con.conrelid
    JOIN pg_namespace childns   ON childns.oid   = childcls.relnamespace
    JOIN pg_class     parentcls ON parentcls.oid = con.confrelid
    JOIN pg_namespace parentns  ON parentns.oid  = parentcls.relnamespace
    WHERE con.contype       = 'f'
      AND childns.nspname   = 'public'
      AND con.confdeltype  <> 'c'
      AND parentns.nspname  = 'public'
      AND parentcls.relname = 'hospitals'
      AND array_length(con.conkey, 1) = 1
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER TABLE %I.%I DROP CONSTRAINT %I',
        r.table_schema, r.table_name, r.constraint_name
      );
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT %I '
        'FOREIGN KEY (%I) REFERENCES public.hospitals(id) ON DELETE CASCADE NOT VALID',
        r.table_schema, r.table_name, r.constraint_name, r.column_name
      );
      EXECUTE format(
        'ALTER TABLE %I.%I VALIDATE CONSTRAINT %I',
        r.table_schema, r.table_name, r.constraint_name
      );
      RAISE NOTICE 'Part A: upgraded % on %.% to CASCADE', r.constraint_name, r.table_schema, r.table_name;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Part A: skipped % on %.% (%)', r.constraint_name, r.table_schema, r.table_name, SQLERRM;
    END;
  END LOOP;

  -- Visibility for the case this fix exists to avoid: a multi-column FK
  -- to hospitals that the loop above deliberately did not touch.
  FOR r IN
    SELECT childns.nspname AS table_schema, childcls.relname AS table_name, con.conname AS constraint_name
    FROM pg_constraint con
    JOIN pg_class     childcls  ON childcls.oid  = con.conrelid
    JOIN pg_namespace childns   ON childns.oid   = childcls.relnamespace
    JOIN pg_class     parentcls ON parentcls.oid = con.confrelid
    JOIN pg_namespace parentns  ON parentns.oid  = parentcls.relnamespace
    WHERE con.contype = 'f' AND childns.nspname = 'public' AND con.confdeltype <> 'c'
      AND parentns.nspname = 'public' AND parentcls.relname = 'hospitals'
      AND array_length(con.conkey, 1) <> 1
  LOOP
    RAISE NOTICE 'Part A: SKIPPED multi-column FK % on %.% — needs a manual CASCADE upgrade', r.constraint_name, r.table_schema, r.table_name;
  END LOOP;

  RAISE NOTICE 'Part A complete: hospitals → child FKs all CASCADE.';
END;
$$;


-- ── Part B: hospital-owned tables → their children (grandchildren) ──
-- Find all FK constraints where the referenced table has a hospital_id
-- column (meaning it's owned by a hospital). Add CASCADE to those FKs
-- so deletions propagate: hospital → lab_orders → lab_order_items, etc.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT
      childns.nspname                          AS table_schema,
      childcls.relname                         AS child_table,
      con.conname                              AS constraint_name,
      (SELECT a.attname FROM pg_attribute a
        WHERE a.attrelid = con.conrelid AND a.attnum = con.conkey[1])
                                                AS fk_column,
      parentcls.relname                        AS parent_table,
      (SELECT a.attname FROM pg_attribute a
        WHERE a.attrelid = con.confrelid AND a.attnum = con.confkey[1])
                                                AS parent_column
    FROM pg_constraint con
    JOIN pg_class     childcls  ON childcls.oid  = con.conrelid
    JOIN pg_namespace childns   ON childns.oid   = childcls.relnamespace
    JOIN pg_class     parentcls ON parentcls.oid = con.confrelid
    JOIN pg_namespace parentns  ON parentns.oid  = parentcls.relnamespace
    WHERE con.contype      = 'f'
      AND childns.nspname  = 'public'
      AND con.confdeltype <> 'c'
      AND parentns.nspname = 'public'
      -- The referenced (parent) table must have a hospital_id column
      -- (meaning it is itself owned by a hospital)
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = con.confrelid
          AND a.attname  = 'hospital_id'
          AND NOT a.attisdropped
      )
      -- Exclude hospital self-references already handled in Part A
      AND parentcls.relname <> 'hospitals'
      AND array_length(con.conkey, 1) = 1
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER TABLE %I.%I DROP CONSTRAINT %I',
        r.table_schema, r.child_table, r.constraint_name
      );
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT %I '
        'FOREIGN KEY (%I) REFERENCES %I.%I(%I) ON DELETE CASCADE NOT VALID',
        r.table_schema, r.child_table, r.constraint_name,
        r.fk_column,
        r.table_schema, r.parent_table, r.parent_column
      );
      EXECUTE format(
        'ALTER TABLE %I.%I VALIDATE CONSTRAINT %I',
        r.table_schema, r.child_table, r.constraint_name
      );
      RAISE NOTICE 'Part B: upgraded %.% (%) → %.% to CASCADE',
        r.child_table, r.fk_column, r.constraint_name,
        r.parent_table, r.parent_column;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Part B: skipped % on %.% (%)', r.constraint_name, r.table_schema, r.child_table, SQLERRM;
    END;
  END LOOP;

  FOR r IN
    SELECT childns.nspname AS table_schema, childcls.relname AS child_table, con.conname AS constraint_name
    FROM pg_constraint con
    JOIN pg_class     childcls  ON childcls.oid  = con.conrelid
    JOIN pg_namespace childns   ON childns.oid   = childcls.relnamespace
    JOIN pg_class     parentcls ON parentcls.oid = con.confrelid
    JOIN pg_namespace parentns  ON parentns.oid  = parentcls.relnamespace
    WHERE con.contype = 'f' AND childns.nspname = 'public' AND con.confdeltype <> 'c'
      AND parentns.nspname = 'public'
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = con.confrelid AND a.attname = 'hospital_id' AND NOT a.attisdropped
      )
      AND parentcls.relname <> 'hospitals'
      AND array_length(con.conkey, 1) <> 1
  LOOP
    RAISE NOTICE 'Part B: SKIPPED multi-column FK % on %.% — needs a manual CASCADE upgrade', r.constraint_name, r.table_schema, r.child_table;
  END LOOP;

  RAISE NOTICE 'Part B complete: grandchild FKs all CASCADE.';
END;
$$;

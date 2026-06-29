-- Fix: hospitals → child tables missing ON DELETE CASCADE
--
-- Lovable/Antigravity created many tables with hospital_id FKs but WITHOUT
-- ON DELETE CASCADE. This migration finds ALL such constraints automatically
-- and upgrades every one to CASCADE in a single pass.
--
-- Safe to re-run: uses DROP CONSTRAINT + ADD CONSTRAINT which is idempotent
-- for tables that already have CASCADE (they just get re-added identically).

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT
      tc.table_schema,
      tc.table_name,
      tc.constraint_name,
      kcu.column_name
    FROM information_schema.table_constraints       tc
    JOIN information_schema.key_column_usage        kcu
      ON  tc.constraint_name  = kcu.constraint_name
      AND tc.table_schema     = kcu.table_schema
    JOIN information_schema.referential_constraints rc
      ON  tc.constraint_name  = rc.constraint_name
      AND tc.table_schema     = rc.constraint_schema
    JOIN information_schema.key_column_usage        kcu2
      ON  rc.unique_constraint_name = kcu2.constraint_name
    WHERE kcu2.table_name   = 'hospitals'
      AND kcu2.table_schema = 'public'
      AND tc.table_schema   = 'public'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND rc.delete_rule    != 'CASCADE'
  LOOP
    RAISE NOTICE 'Upgrading FK % on %.% (%) to ON DELETE CASCADE',
      r.constraint_name, r.table_schema, r.table_name, r.column_name;

    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT %I',
      r.table_schema, r.table_name, r.constraint_name
    );

    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I '
      'FOREIGN KEY (%I) REFERENCES public.hospitals(id) ON DELETE CASCADE',
      r.table_schema, r.table_name, r.constraint_name, r.column_name
    );
  END LOOP;

  RAISE NOTICE 'All hospital FK constraints upgraded to ON DELETE CASCADE.';
END;
$$;

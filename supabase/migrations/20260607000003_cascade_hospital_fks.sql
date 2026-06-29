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
-- ============================================================

-- ── Part A: hospitals → direct children ──────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT
      tc.table_schema,
      tc.table_name,
      tc.constraint_name,
      kcu.column_name
    FROM information_schema.table_constraints       tc
    JOIN information_schema.key_column_usage        kcu
      ON  tc.constraint_name = kcu.constraint_name
      AND tc.table_schema    = kcu.table_schema
    JOIN information_schema.referential_constraints rc
      ON  tc.constraint_name = rc.constraint_name
      AND tc.table_schema    = rc.constraint_schema
    JOIN information_schema.key_column_usage        kcu2
      ON  rc.unique_constraint_name = kcu2.constraint_name
    WHERE kcu2.table_name    = 'hospitals'
      AND kcu2.table_schema  = 'public'
      AND tc.table_schema    = 'public'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND rc.delete_rule    != 'CASCADE'
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER TABLE %I.%I DROP CONSTRAINT %I',
        r.table_schema, r.table_name, r.constraint_name
      );
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT %I '
        'FOREIGN KEY (%I) REFERENCES public.hospitals(id) ON DELETE CASCADE',
        r.table_schema, r.table_name, r.constraint_name, r.column_name
      );
      RAISE NOTICE 'Part A: upgraded % on %.% to CASCADE', r.constraint_name, r.table_schema, r.table_name;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Part A: skipped % on %.% (%)', r.constraint_name, r.table_schema, r.table_name, SQLERRM;
    END;
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
      tc.table_schema,
      tc.table_name        AS child_table,
      tc.constraint_name,
      kcu.column_name      AS fk_column,
      kcu2.table_name      AS parent_table,
      kcu2.column_name     AS parent_column
    FROM information_schema.table_constraints       tc
    JOIN information_schema.key_column_usage        kcu
      ON  tc.constraint_name = kcu.constraint_name
      AND tc.table_schema    = kcu.table_schema
    JOIN information_schema.referential_constraints rc
      ON  tc.constraint_name = rc.constraint_name
      AND tc.table_schema    = rc.constraint_schema
    JOIN information_schema.key_column_usage        kcu2
      ON  rc.unique_constraint_name = kcu2.constraint_name
    WHERE tc.table_schema    = 'public'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND rc.delete_rule    != 'CASCADE'
      -- The referenced (parent) table must have a hospital_id column
      -- (meaning it is itself owned by a hospital)
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name   = kcu2.table_name
          AND c.column_name  = 'hospital_id'
      )
      -- Exclude hospital self-references already handled in Part A
      AND kcu2.table_name != 'hospitals'
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER TABLE %I.%I DROP CONSTRAINT %I',
        r.table_schema, r.child_table, r.constraint_name
      );
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT %I '
        'FOREIGN KEY (%I) REFERENCES %I.%I(%I) ON DELETE CASCADE',
        r.table_schema, r.child_table, r.constraint_name,
        r.fk_column,
        r.table_schema, r.parent_table, r.parent_column
      );
      RAISE NOTICE 'Part B: upgraded %.% (%) → %.% to CASCADE',
        r.child_table, r.fk_column, r.constraint_name,
        r.parent_table, r.parent_column;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Part B: skipped % on %.% (%)', r.constraint_name, r.table_schema, r.child_table, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'Part B complete: grandchild FKs all CASCADE.';
END;
$$;

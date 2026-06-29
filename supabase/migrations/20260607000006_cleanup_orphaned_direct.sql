-- ============================================================
-- ONE-TIME CLEANUP Part 2: Dynamic loop — all hospital_id tables
-- Deletes orphaned rows from every table that has a hospital_id
-- column, where that hospital_id no longer exists in hospitals.
-- 2 passes handle cross-table FK ordering automatically.
-- ============================================================

DO $$
DECLARE
  _rec record;
  _i   int;
BEGIN
  FOR _i IN 1..2 LOOP
    FOR _rec IN
      SELECT table_name
      FROM information_schema.columns
      WHERE column_name  = 'hospital_id'
        AND table_schema = 'public'
        AND table_name  != 'hospitals'
      ORDER BY table_name
    LOOP
      BEGIN
        EXECUTE format(
          'DELETE FROM %I WHERE hospital_id NOT IN (SELECT id FROM hospitals)',
          _rec.table_name
        );
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Part 2 complete: all hospital_id table orphans removed.';
END;
$$;

-- ============================================================
-- Checkpointable hospital purge — powers the streaming progress bar
-- ============================================================
-- purge_hospital() (20260602150001) deletes ~79 tables in ONE opaque
-- transaction, so the delete-hospital edge function could only report a
-- boolean "done". To stream real progress, we expose the same purge as
-- discrete, individually-callable steps the edge function can run one at a
-- time (each its own transaction), emitting an SSE event after each:
--
--   purge_hospital_estimate(id)      -> total rows (denominator for the bar)
--   purge_hospital_grandchildren(id) -> deletes the join-only child tables
--   purge_hospital_plan(id)          -> ordered list of direct hospital_id tables
--   purge_hospital_table(id, name)   -> deletes ONE table, returns row count
--   purge_hospital_finalize(id)      -> deletes the hospital row (must succeed)
--
-- The original purge_hospital() is kept intact as a single-shot fallback.
-- All functions are SECURITY DEFINER and granted ONLY to service_role, exactly
-- like purge_hospital().
-- ============================================================

-- ── Estimate: total rows that will be removed (for the progress denominator) ──
CREATE OR REPLACE FUNCTION public.purge_hospital_estimate(p_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rec   record;
  _cnt   bigint;
  _total bigint := 0;
BEGIN
  -- Direct hospital_id tables
  FOR _rec IN
    SELECT table_name
    FROM information_schema.columns
    WHERE column_name  = 'hospital_id'
      AND table_schema = 'public'
      AND table_name  != 'hospitals'
  LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM %I WHERE hospital_id = $1', _rec.table_name)
        INTO _cnt USING p_id;
      _total := _total + COALESCE(_cnt, 0);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  -- Join-only grandchildren (tables that reference a hospital-owned parent but
  -- lack their own hospital_id column)
  FOR _rec IN
    SELECT DISTINCT
      tc.table_name    AS child_table,
      kcu.column_name  AS fk_col,
      kcu2.table_name  AS parent_table,
      kcu2.column_name AS parent_pk
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
      AND EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = kcu2.table_name
          AND c.column_name  = 'hospital_id')
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = tc.table_name
          AND c.column_name  = 'hospital_id')
      AND kcu2.table_name != 'hospitals'
  LOOP
    BEGIN
      EXECUTE format(
        'SELECT count(*) FROM %I WHERE %I IN (SELECT %I FROM %I WHERE hospital_id = $1)',
        _rec.child_table, _rec.fk_col, _rec.parent_pk, _rec.parent_table)
        INTO _cnt USING p_id;
      _total := _total + COALESCE(_cnt, 0);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  RETURN _total;
END;
$$;

-- ── Grandchildren: delete every join-only child table, return rows removed ────
-- Dynamic discovery: any table whose FK points at a hospital-owned parent but
-- which itself has no hospital_id column. Two passes to resolve FK depth.
CREATE OR REPLACE FUNCTION public.purge_hospital_grandchildren(p_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rec     record;
  _deleted bigint := 0;
  _rc      bigint;
  _pass    int;
BEGIN
  FOR _pass IN 1..2 LOOP
    FOR _rec IN
      SELECT DISTINCT
        tc.table_name    AS child_table,
        kcu.column_name  AS fk_col,
        kcu2.table_name  AS parent_table,
        kcu2.column_name AS parent_pk
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
        AND EXISTS (
          SELECT 1 FROM information_schema.columns c
          WHERE c.table_schema = 'public' AND c.table_name = kcu2.table_name
            AND c.column_name  = 'hospital_id')
        AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns c
          WHERE c.table_schema = 'public' AND c.table_name = tc.table_name
            AND c.column_name  = 'hospital_id')
        AND kcu2.table_name != 'hospitals'
      ORDER BY tc.table_name
    LOOP
      BEGIN
        EXECUTE format(
          'DELETE FROM %I WHERE %I IN (SELECT %I FROM %I WHERE hospital_id = $1)',
          _rec.child_table, _rec.fk_col, _rec.parent_pk, _rec.parent_table)
          USING p_id;
        GET DIAGNOSTICS _rc = ROW_COUNT;
        _deleted := _deleted + COALESCE(_rc, 0);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END LOOP;
  END LOOP;

  RETURN _deleted;
END;
$$;

-- ── Plan: ordered list of direct hospital_id tables to purge ──────────────────
CREATE OR REPLACE FUNCTION public.purge_hospital_plan(p_id uuid)
RETURNS TABLE(table_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.table_name::text
  FROM information_schema.columns c
  WHERE c.column_name  = 'hospital_id'
    AND c.table_schema = 'public'
    AND c.table_name  != 'hospitals'
  ORDER BY c.table_name;
$$;

-- ── One table: delete rows for this hospital, return the count ────────────────
-- Injection-safe: p_table is validated against information_schema before it is
-- ever placed into a query (and only via %I quoting). FK-violation errors are
-- allowed to propagate so the orchestrator can retry the table in a later sweep.
CREATE OR REPLACE FUNCTION public.purge_hospital_table(p_id uuid, p_table text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rc bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = p_table
      AND column_name  = 'hospital_id'
  ) THEN
    RAISE EXCEPTION 'purge_hospital_table: % is not a hospital-owned table', p_table;
  END IF;

  EXECUTE format('DELETE FROM %I WHERE hospital_id = $1', p_table) USING p_id;
  GET DIAGNOSTICS _rc = ROW_COUNT;
  RETURN COALESCE(_rc, 0);
END;
$$;

-- ── Finalize: delete the hospital row itself (must succeed) ───────────────────
CREATE OR REPLACE FUNCTION public.purge_hospital_finalize(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM hospitals WHERE id = p_id;
END;
$$;

-- ── Lock down: only the edge function (service_role) may run these ────────────
REVOKE ALL ON FUNCTION public.purge_hospital_estimate(uuid)       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_hospital_grandchildren(uuid)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_hospital_plan(uuid)           FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_hospital_table(uuid, text)    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_hospital_finalize(uuid)       FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.purge_hospital_estimate(uuid)       TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_hospital_grandchildren(uuid)  TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_hospital_plan(uuid)           TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_hospital_table(uuid, text)    TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_hospital_finalize(uuid)       TO service_role;

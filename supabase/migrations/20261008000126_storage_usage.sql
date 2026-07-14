-- Storage usage metering for the Plan & Billing page.
--   (a) Per-plan storage quota column on subscription_plans (mirrors ai_included_budget_usd).
--   (b) get_storage_usage(hospital) RPC returning exact file bytes + an estimated DB-row share.
--
-- Multi-tenant shared Postgres: file storage is byte-accurate per hospital (objects live under a
-- {hospital_id}/... path); database size can only be estimated per tenant (pg size functions are
-- whole-table), so the DB portion is a proportional share of each tenant table's on-disk size.

-- ── (a) Plan quota column + defaults ─────────────────────────────────────────
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS storage_included_gb integer;   -- NULL = unlimited / not metered

UPDATE public.subscription_plans SET storage_included_gb = 25
  WHERE slug = 'starter'      AND storage_included_gb IS NULL;
UPDATE public.subscription_plans SET storage_included_gb = 100
  WHERE slug = 'professional' AND storage_included_gb IS NULL;
-- 'enterprise' left NULL (unlimited)

-- ── (b) Per-tenant storage usage RPC ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_storage_usage(p_hospital_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_file_bytes bigint := 0;
  v_db_bytes   bigint := 0;
  v_tbl        text;
  v_total      bigint;
  v_rows       bigint;
  v_size       bigint;
BEGIN
  -- Scope guard: callers may only read their own hospital's usage.
  IF p_hospital_id IS DISTINCT FROM public.get_user_hospital_id() THEN
    RAISE EXCEPTION 'not authorized for this hospital';
  END IF;

  -- Exact file storage: sum object sizes whose first path segment is this hospital id.
  SELECT COALESCE(SUM((metadata->>'size')::bigint), 0)
    INTO v_file_bytes
    FROM storage.objects
   WHERE (storage.foldername(name))[1] = p_hospital_id::text;

  -- Estimated DB size: for every public table with a hospital_id column, take that table's
  -- on-disk size and allocate the tenant's proportional share (rows_for_hospital / total_rows).
  FOR v_tbl IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND c.column_name = 'hospital_id'
       AND t.table_type = 'BASE TABLE'
  LOOP
    BEGIN
      SELECT GREATEST(reltuples::bigint, 0) INTO v_total
        FROM pg_class WHERE oid = format('public.%I', v_tbl)::regclass;

      EXECUTE format('SELECT count(*) FROM public.%I WHERE hospital_id = $1', v_tbl)
        INTO v_rows USING p_hospital_id;

      IF v_rows > 0 THEN
        v_size := pg_total_relation_size(format('public.%I', v_tbl)::regclass);
        -- Denominator clamped so the ratio never exceeds 1 even with stale/zero reltuples.
        v_db_bytes := v_db_bytes + (v_size * v_rows / GREATEST(v_total, v_rows, 1));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Skip any table that can't be measured (dropped, permission, odd type) rather than fail.
      CONTINUE;
    END;
  END LOOP;

  RETURN json_build_object(
    'file_bytes',   v_file_bytes,
    'db_bytes_est', v_db_bytes,
    'total_bytes',  v_file_bytes + v_db_bytes
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_storage_usage(uuid) TO authenticated;

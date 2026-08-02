-- IPC bundle compliance: derive compliance_pct, and guard device removal times.
--
-- ipc_bundle_checklists.compliance_pct was never computed anywhere in the database:
-- no default, no generated column, no trigger. 20260909000003_ipc_surveillance.sql
-- left a comment saying it was "computed by app before insert", but only one of the
-- two writers actually does that:
--
--   * NursingKardexTab  — computes yes/total*100 and stores real booleans in `elements`
--   * IPDDeviceTab      — sends no compliance_pct at all, and stores "true"/"false" STRINGS
--
-- Those NULL rows were then read two incompatible ways: the IPC dashboard treated
-- NULL as 100% (`compliance_pct ?? 100`), while qi_collect_hic counted the same rows
-- as failures (`count(*) FILTER (WHERE compliance_pct >= 100)`). The same checklist
-- was simultaneously perfect and non-compliant depending on who asked.

-- ─── 1. Derive a percentage from the elements jsonb ──────────────────────────
CREATE OR REPLACE FUNCTION public.ipc_bundle_elements_compliance(p_elements jsonb)
RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
WITH e AS (SELECT value FROM jsonb_each(COALESCE(p_elements, '{}'::jsonb))),
n AS (
  SELECT count(*) AS total,
         count(*) FILTER (
           WHERE (jsonb_typeof(value) = 'boolean' AND value = 'true'::jsonb)
              -- historical IPDDeviceTab rows stored booleans as strings
              OR (jsonb_typeof(value) = 'string'
                  AND lower(btrim(value #>> '{}')) IN ('true','yes','y','1'))
              OR (jsonb_typeof(value) = 'number' AND (value #>> '{}')::numeric = 1)
         ) AS yes
  FROM e
)
-- NULL (not 0) for an empty checklist: "unknown" must stay unknown, otherwise an
-- element-less row would drag a ward's average to zero.
-- JSON null and unanswered items count toward `total` but not `yes`, matching
-- NursingKardexTab's "unanswered = non-compliant" rule.
SELECT CASE WHEN total = 0 THEN NULL ELSE round(100.0 * yes / total, 2) END FROM n;
$$;

-- ─── 2. Fill it in whenever the application omits it ─────────────────────────
CREATE OR REPLACE FUNCTION public.ipc_bundle_set_compliance()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only when absent, so an explicit value from the app stays authoritative.
  IF NEW.compliance_pct IS NULL THEN
    NEW.compliance_pct := public.ipc_bundle_elements_compliance(NEW.elements);
  END IF;
  RETURN NEW;
END $$;

-- DROP first: 20260909000003 created its triggers unguarded and is not re-runnable.
DROP TRIGGER IF EXISTS trg_ipc_bundle_compliance ON public.ipc_bundle_checklists;
CREATE TRIGGER trg_ipc_bundle_compliance
  BEFORE INSERT OR UPDATE OF elements, compliance_pct
  ON public.ipc_bundle_checklists
  FOR EACH ROW EXECUTE FUNCTION public.ipc_bundle_set_compliance();

-- ─── 3. Backfill the rows the app already left NULL ──────────────────────────
UPDATE public.ipc_bundle_checklists
   SET compliance_pct = public.ipc_bundle_elements_compliance(elements)
 WHERE compliance_pct IS NULL
   AND elements IS NOT NULL
   AND elements <> '{}'::jsonb;

-- ─── 4. Device removal cannot precede insertion ──────────────────────────────
-- The IPC module now lets a user type a removal timestamp by hand. The device-days
-- SQL in qi_collect_hic_device has no GREATEST(..., 0), so a removal time before the
-- insertion time would SUBTRACT device-days from the hospital's denominator and
-- inflate every rate on the dashboard.
--
-- NOT VALID so a pre-existing bad row cannot block deployment; the rule is still
-- enforced on every insert and update. Once
--   SELECT count(*) FROM ipc_device_usage WHERE device_removed_at < device_inserted_at;
-- returns 0, run:
--   ALTER TABLE public.ipc_device_usage VALIDATE CONSTRAINT ipc_device_usage_removal_after_insertion;
ALTER TABLE public.ipc_device_usage
  DROP CONSTRAINT IF EXISTS ipc_device_usage_removal_after_insertion;
ALTER TABLE public.ipc_device_usage
  ADD CONSTRAINT ipc_device_usage_removal_after_insertion
  CHECK (device_removed_at IS NULL OR device_removed_at >= device_inserted_at)
  NOT VALID;

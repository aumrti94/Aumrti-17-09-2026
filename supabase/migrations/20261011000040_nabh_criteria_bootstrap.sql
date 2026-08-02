-- ============================================================================
-- NABH Quality Indicator Engine — 4/7: criteria bootstrap and scoring
-- ============================================================================
-- `nabh_criteria` has never been seeded by any migration. NABHDashboard's
-- "Run Full Auto-Collection" UPDATEs rows by (hospital_id, criterion_number)
-- and therefore updates ZERO rows on every real hospital, while still reporting
-- success. This migration projects the seeded `nabh_standards` master into
-- per-hospital criteria so that stops being a no-op, and then scores those
-- criteria from the collected indicators.
--
-- DESIGN PRINCIPLE: a criterion with no mapped indicator is left `not_assessed`.
-- A criterion is never scored from "the module has some rows in it". That is
-- exactly the fake-evidence pattern of the four hardcoded "Auto-Evidence
-- Collected" strings on the current dashboard (two of which — COP.2 and MOM.3 —
-- have no collector behind them at all). "23 of 74 criteria auto-scored, 51
-- require manual assessment" is a statement an assessor can act on; a green
-- tick that means nothing is not.
-- ============================================================================

-- ─── Attainment: how close a value sits to its target, 0-100 ────────────────
-- Mirrored exactly in src/lib/qualityIndicators.ts so SQL and UI never disagree.
CREATE OR REPLACE FUNCTION public.qi_attainment(
  p_value numeric, p_target numeric, p_direction text
) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_value IS NULL OR p_target IS NULL THEN NULL
    WHEN p_direction = 'neutral' THEN NULL          -- volume metrics never score
    WHEN p_direction = 'higher_is_better' THEN
      CASE WHEN p_target = 0 THEN NULL
           ELSE LEAST(100, GREATEST(0, round(100 * p_value / p_target, 2))) END
    WHEN p_direction = 'lower_is_better' THEN
      CASE WHEN p_value <= p_target THEN 100        -- target 0 and value 0 => 100
           WHEN p_value = 0 THEN 100
           ELSE GREATEST(0, round(100 * p_target / p_value, 2)) END
    ELSE NULL
  END;
$$;

-- Same 80/50 bands the dashboard already uses.
CREATE OR REPLACE FUNCTION public.qi_band_status(p_pct numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_pct IS NULL  THEN 'not_assessed'
    WHEN p_pct >= 80    THEN 'compliant'
    WHEN p_pct >= 50    THEN 'partially_compliant'
    ELSE 'non_compliant'
  END;
$$;

-- ─── Bootstrap per-hospital criteria from the global standard set ───────────
CREATE OR REPLACE FUNCTION public.bootstrap_nabh_criteria(p_hospital_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n integer;
BEGIN
  INSERT INTO public.nabh_criteria
    (hospital_id, chapter_code, chapter_name, criterion_number, criterion_text, compliance_status)
  SELECT p_hospital_id,
         s.chapter_code,
         COALESCE(cn.chapter_name, s.chapter_code),
         s.standard_code,
         s.description,
         'not_assessed'
  FROM public.nabh_standards s
  LEFT JOIN public.nabh_chapter_names cn ON cn.chapter_code = s.chapter_code
  WHERE s.is_active
    AND s.objective_element_code IS NULL   -- standard-level rows only
  ON CONFLICT (hospital_id, criterion_number) DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- Keep the newer compliance-matrix model populated in step.
  INSERT INTO public.nabh_hospital_compliance (hospital_id, nabh_standard_id)
  SELECT p_hospital_id, s.id FROM public.nabh_standards s WHERE s.is_active
  ON CONFLICT (hospital_id, nabh_standard_id) DO NOTHING;

  RETURN v_n;
END $$;

-- New tenants get their criteria automatically.
CREATE OR REPLACE FUNCTION public.tg_bootstrap_nabh_criteria()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.bootstrap_nabh_criteria(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block hospital creation on accreditation scaffolding.
  RAISE WARNING 'bootstrap_nabh_criteria failed for hospital %: %', NEW.id, SQLERRM;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bootstrap_nabh_criteria ON public.hospitals;
CREATE TRIGGER trg_bootstrap_nabh_criteria
  AFTER INSERT ON public.hospitals
  FOR EACH ROW EXECUTE FUNCTION public.tg_bootstrap_nabh_criteria();

-- ─── Score criteria from collected indicators ───────────────────────────────
-- The criterion <-> indicator mapping is NOT a separate table: each indicator
-- declares the standard it evidences via quality_indicator_definitions
-- .nabh_standard_code. One source of truth, nothing to keep in sync.
CREATE OR REPLACE FUNCTION public.run_nabh_auto_collection(
  p_hospital_id  uuid,
  p_period_start date DEFAULT date_trunc('month', current_date)::date
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n integer;
BEGIN
  IF auth.uid() IS NOT NULL
     AND p_hospital_id IS DISTINCT FROM public.get_user_hospital_id()
     AND NOT public.is_aumrti_admin() THEN
    RAISE EXCEPTION 'not authorised for hospital %', p_hospital_id USING ERRCODE = '42501';
  END IF;

  WITH scored AS (
    SELECT d.nabh_standard_code AS criterion_number,
           round(SUM(public.qi_attainment(q.value, q.target, q.direction) * d.criterion_weight)
                 / NULLIF(SUM(d.criterion_weight), 0))::integer AS score,
           jsonb_agg(jsonb_build_object(
             'indicator_code', q.indicator_code,
             'display_name',   d.display_name,
             'value',          q.value,
             'target',         q.target,
             'unit',           q.unit,
             'direction',      q.direction,
             'attainment',     public.qi_attainment(q.value, q.target, q.direction)
           ) ORDER BY q.indicator_code) AS evidence
    FROM public.quality_indicators q
    JOIN public.quality_indicator_definitions d USING (indicator_code)
    WHERE q.hospital_id  = p_hospital_id
      AND q.period_start = p_period_start
      AND q.period       = 'monthly'
      AND d.nabh_standard_code IS NOT NULL
      AND d.is_active
      -- Only indicators that actually produced a scorable number contribute.
      AND public.qi_attainment(q.value, q.target, q.direction) IS NOT NULL
    GROUP BY d.nabh_standard_code
  )
  UPDATE public.nabh_criteria c
  SET compliance_score  = s.score,
      compliance_status = public.qi_band_status(s.score),
      auto_collected    = true,
      auto_source       = 'indicator_engine',
      evidence_json     = s.evidence,
      last_assessed     = p_period_start,
      computed_at       = now()
  FROM scored s
  WHERE c.hospital_id      = p_hospital_id
    AND c.criterion_number = s.criterion_number;

  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- Leave an evidence-trail row per auto-scored criterion.
  INSERT INTO public.nabh_evidence_log
    (hospital_id, criterion_number, description, compliance_status, value, source)
  SELECT c.hospital_id, c.criterion_number,
         'Auto-scored from ' || jsonb_array_length(c.evidence_json)
           || ' quality indicator(s) for period ' || p_period_start,
         c.compliance_status, c.compliance_score, 'auto_collector'
  FROM public.nabh_criteria c
  WHERE c.hospital_id = p_hospital_id
    AND c.auto_source = 'indicator_engine'
    AND c.computed_at >= now() - interval '1 minute';

  PERFORM public.sync_nabh_compliance_from_criteria(p_hospital_id);

  RETURN v_n;
END $$;

-- ─── Reconcile the two NABH models, one-directionally ───────────────────────
-- nabh_criteria (auto-scored) -> nabh_hospital_compliance (assessor-facing).
-- A function rather than a trigger: no loops, and it is greppable.
CREATE OR REPLACE FUNCTION public.sync_nabh_compliance_from_criteria(p_hospital_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n integer;
BEGIN
  UPDATE public.nabh_hospital_compliance hc
  SET status = CASE c.compliance_status
                 WHEN 'compliant'           THEN 'Compliant'
                 WHEN 'partially_compliant' THEN 'Partially Compliant'
                 WHEN 'non_compliant'       THEN 'Non-Compliant'
                 ELSE 'Not Started'
               END,
      last_assessed_at = c.computed_at,
      updated_at       = now()
  FROM public.nabh_criteria c
  JOIN public.nabh_standards s ON s.standard_code = c.criterion_number
  WHERE hc.hospital_id      = p_hospital_id
    AND c.hospital_id       = p_hospital_id
    AND hc.nabh_standard_id = s.id
    AND c.auto_collected
    AND c.computed_at IS NOT NULL
    -- A human assessor's entry on NABHMatrixPage always wins over a stale
    -- auto score.
    AND (hc.last_assessed_at IS NULL OR hc.last_assessed_at < c.computed_at);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- ─── Backfill existing hospitals ────────────────────────────────────────────
DO $$
DECLARE r record; v_total integer := 0;
BEGIN
  FOR r IN SELECT id FROM public.hospitals LOOP
    v_total := v_total + public.bootstrap_nabh_criteria(r.id);
  END LOOP;
  RAISE NOTICE 'bootstrap_nabh_criteria: created % criteria rows across all hospitals', v_total;
END $$;

REVOKE ALL ON FUNCTION public.bootstrap_nabh_criteria(uuid)                 FROM public;
REVOKE ALL ON FUNCTION public.run_nabh_auto_collection(uuid, date)          FROM public;
REVOKE ALL ON FUNCTION public.sync_nabh_compliance_from_criteria(uuid)      FROM public;
GRANT EXECUTE ON FUNCTION public.qi_attainment(numeric, numeric, text)      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.qi_band_status(numeric)                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bootstrap_nabh_criteria(uuid)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.run_nabh_auto_collection(uuid, date)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_nabh_compliance_from_criteria(uuid)   TO authenticated, service_role;

COMMENT ON FUNCTION public.run_nabh_auto_collection(uuid, date) IS
  'Scores nabh_criteria from collected quality indicators for one period. '
  'Criteria with no mapped indicator are deliberately left not_assessed.';

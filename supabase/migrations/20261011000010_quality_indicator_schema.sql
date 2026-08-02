-- ============================================================================
-- NABH Quality Indicator Engine — 1/7: schema
-- ============================================================================
-- Prepares `quality_indicators` to be an auto-collected, per-period table with
-- history, and adds the definition registry that drives collection.
--
-- Before this migration, `quality_indicators` had no unique constraint, so an
-- upsert was impossible and nothing could ever write to it idempotently. It has
-- never held a single seeded row in any environment.
-- ============================================================================

-- ─── 1. quality_indicators: new columns ──────────────────────────────────────
ALTER TABLE public.quality_indicators
  ADD COLUMN IF NOT EXISTS indicator_code text,
  ADD COLUMN IF NOT EXISTS nabh_chapter   text,
  ADD COLUMN IF NOT EXISTS direction      text NOT NULL DEFAULT 'lower_is_better',
  ADD COLUMN IF NOT EXISTS period_end     date,
  ADD COLUMN IF NOT EXISTS computed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS notes          text;

-- Postgres refuses to alter the type of a column a view depends on, so the
-- current-value view is dropped here and recreated in section 3 below. Without
-- this, re-running the migration fails on the ALTERs.
DROP VIEW IF EXISTS public.quality_indicators_current;

-- Widen the numeric caps.
--
-- `value numeric(8,4)` tops out at 9999.9999. A per-1000 rate with a small
-- denominator blows straight through it: 1 CLABSI over 0.05 central-line days
-- is 20,000 per 1000 device-days, which raises numeric_field_overflow and
-- aborts the entire collection transaction for that hospital-month. Count-shaped
-- indicators (sentinel events, drill counts, OPD volume) can exceed it too.
ALTER TABLE public.quality_indicators
  ALTER COLUMN value       TYPE numeric(14,4),
  ALTER COLUMN target      TYPE numeric(14,4),
  ALTER COLUMN benchmark   TYPE numeric(14,4),
  ALTER COLUMN numerator   TYPE numeric(16,4),
  ALTER COLUMN denominator TYPE numeric(16,4);

-- `denominator DEFAULT 1` silently turns a raw count into a "rate". A missing
-- denominator must be NULL so the engine can report "no data" instead of a lie.
ALTER TABLE public.quality_indicators ALTER COLUMN denominator DROP DEFAULT;

-- Direction vocabulary. 'neutral' exists so volume metrics (BMW kg/patient-day)
-- are not forced into a good/bad polarity they do not have.
ALTER TABLE public.quality_indicators
  DROP CONSTRAINT IF EXISTS chk_quality_indicators_direction;
ALTER TABLE public.quality_indicators
  ADD CONSTRAINT chk_quality_indicators_direction
  CHECK (direction IN ('higher_is_better','lower_is_better','neutral'));

-- ─── 2. Backfill indicator_code, de-duplicate, then constrain ────────────────
UPDATE public.quality_indicators
SET indicator_code = 'manual.' || regexp_replace(lower(indicator_name), '[^a-z0-9]+', '_', 'g')
WHERE indicator_code IS NULL;

UPDATE public.quality_indicators
SET period_start = COALESCE(period_start, date_trunc('month', COALESCE(created_at, now()))::date),
    period       = COALESCE(period, 'monthly');

-- There has never been a unique constraint here, so duplicates are possible.
-- Newest row wins. created_at is nullable, so it is coalesced: a NULL would make
-- every comparison NULL, leave the duplicate in place, and then fail the unique
-- index below.
DELETE FROM public.quality_indicators a
USING public.quality_indicators b
WHERE a.hospital_id    = b.hospital_id
  AND a.indicator_code = b.indicator_code
  AND a.period         = b.period
  AND a.period_start   = b.period_start
  AND (COALESCE(a.created_at, 'epoch'::timestamptz)
         < COALESCE(b.created_at, 'epoch'::timestamptz)
       OR (COALESCE(a.created_at, 'epoch'::timestamptz)
             = COALESCE(b.created_at, 'epoch'::timestamptz)
           AND a.ctid < b.ctid));

ALTER TABLE public.quality_indicators ALTER COLUMN indicator_code SET NOT NULL;

-- The ON CONFLICT target that makes upsert-per-period possible.
CREATE UNIQUE INDEX IF NOT EXISTS uq_quality_indicators_key
  ON public.quality_indicators (hospital_id, indicator_code, period, period_start);

CREATE INDEX IF NOT EXISTS idx_quality_indicators_trend
  ON public.quality_indicators (hospital_id, indicator_code, period_start DESC);

-- ─── 3. Current-value view ───────────────────────────────────────────────────
-- `quality_indicators` now carries one row per period, so it *is* the history
-- table. Readers that want "the latest value" must not scan raw rows or they
-- will match an arbitrary month.
CREATE OR REPLACE VIEW public.quality_indicators_current AS
SELECT DISTINCT ON (hospital_id, indicator_code) *
FROM public.quality_indicators
ORDER BY hospital_id, indicator_code, period_start DESC;

-- security_invoker makes the view respect the *caller's* RLS on the base table.
-- Without it the view would run as its owner and leak across tenants.
ALTER VIEW public.quality_indicators_current SET (security_invoker = on);

-- supabase/config.toml does not auto-expose new objects, so this GRANT is what
-- makes the view reachable through PostgREST at all.
GRANT SELECT ON public.quality_indicators_current TO authenticated;

-- ─── 4. Indicator definition registry (global) ───────────────────────────────
-- Deliberately holds *meaning*, never executable SQL. Storing query text here
-- and running it through EXECUTE format() inside a SECURITY DEFINER function
-- would be arbitrary SQL execution as the function owner, and would lose the
-- compile-time column checking that catches exactly the class of bug this
-- migration series exists to fix.
CREATE TABLE IF NOT EXISTS public.quality_indicator_definitions (
  indicator_code          text PRIMARY KEY,
  display_name            text NOT NULL,
  nabh_chapter            text NOT NULL,
  -- Which NABH standard this indicator is evidence for. NULL means the seeded
  -- standard set has no matching entry (the seed is explicitly "representative"
  -- and carries a TODO for full CSV import) — such indicators are still
  -- collected, they just do not score a criterion.
  nabh_standard_code      text,
  -- Relative weight when several indicators evidence the same standard.
  criterion_weight        numeric NOT NULL DEFAULT 1 CHECK (criterion_weight > 0),
  category                text NOT NULL
    CHECK (category IN ('clinical','operational','patient_safety',
                        'infection_control','financial','nabh')),
  unit                    text NOT NULL,
  direction               text NOT NULL
    CHECK (direction IN ('higher_is_better','lower_is_better','neutral')),
  -- 100 => percentage, 1000 => per-1000 rate, 1 => raw value (hrs/min/days/count)
  multiplier              numeric NOT NULL DEFAULT 100,
  collection_mode         text NOT NULL
    CHECK (collection_mode IN ('auto','manual','hybrid')),
  default_target          numeric(14,4),
  default_benchmark       numeric(14,4),
  benchmark_source        text,
  numerator_description   text NOT NULL,
  denominator_description text,
  source_tables           jsonb NOT NULL DEFAULT '[]'::jsonb,
  caveats                 text,
  is_active               boolean NOT NULL DEFAULT true,
  sort_order              integer NOT NULL DEFAULT 100,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qi_definitions_chapter
  ON public.quality_indicator_definitions (nabh_chapter, sort_order);
CREATE INDEX IF NOT EXISTS idx_qi_definitions_standard
  ON public.quality_indicator_definitions (nabh_standard_code)
  WHERE nabh_standard_code IS NOT NULL;

ALTER TABLE public.quality_indicator_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read indicator definitions"
  ON public.quality_indicator_definitions;
CREATE POLICY "Authenticated can read indicator definitions"
  ON public.quality_indicator_definitions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Aumrti admins manage indicator definitions"
  ON public.quality_indicator_definitions;
CREATE POLICY "Aumrti admins manage indicator definitions"
  ON public.quality_indicator_definitions FOR ALL TO authenticated
  USING (public.is_aumrti_admin()) WITH CHECK (public.is_aumrti_admin());

GRANT SELECT ON public.quality_indicator_definitions TO authenticated;

-- ─── 5. Per-hospital overrides ───────────────────────────────────────────────
-- Lets a day-care centre with no OT and no ventilators mark cop.ot_cancellation_pct
-- and hic.vap_per1000 Not Applicable instead of showing a permanent red zero.
CREATE TABLE IF NOT EXISTS public.quality_indicator_overrides (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id    uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  indicator_code text NOT NULL
    REFERENCES public.quality_indicator_definitions(indicator_code) ON DELETE CASCADE,
  is_applicable  boolean NOT NULL DEFAULT true,
  target         numeric(14,4),
  benchmark      numeric(14,4),
  updated_by     uuid REFERENCES public.users(id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, indicator_code)
);

ALTER TABLE public.quality_indicator_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own hospital indicator overrides"
  ON public.quality_indicator_overrides;
CREATE POLICY "Users view own hospital indicator overrides"
  ON public.quality_indicator_overrides FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

DROP POLICY IF EXISTS "Users manage own hospital indicator overrides"
  ON public.quality_indicator_overrides;
CREATE POLICY "Users manage own hospital indicator overrides"
  ON public.quality_indicator_overrides FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quality_indicator_overrides TO authenticated;

-- ─── 6. nabh_evidence_log — the table ~50 call sites already expect ──────────
-- src/pages/quality/QualityPage.tsx queries this for the Export Evidence Bundle
-- and it has never existed, so that CSV has always been header-only.
--
-- More importantly, logNABHEvidence() in src/lib/nabh-evidence.ts is called from
-- ~50 places (lab verification, OT close, CSSD, BMW, consent, fall risk, ICU
-- bundles, training, blood bank...). Every one of them UPDATEs `nabh_criteria`
-- by (hospital_id, criterion_number) — against a table that has zero rows for
-- any real hospital — inside a swallowing catch. All ~50 are silent no-ops.
-- Redirecting that helper to INSERT here turns them into a real evidence trail
-- without touching a single call site.
CREATE TABLE IF NOT EXISTS public.nabh_evidence_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id        uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  criterion_number   text NOT NULL,
  -- Several call sites use codes that are not in nabh_standards at all
  -- (TMS.3, DIC.1, NABL.CAL, NFS.1, PCC.1, AAC.11, FMS.8...). Flagging them
  -- surfaces the gap as a backlog instead of hiding it.
  is_known_criterion boolean NOT NULL DEFAULT false,
  indicator_code     text,
  description        text NOT NULL,
  compliance_status  text NOT NULL DEFAULT 'compliant'
    CHECK (compliance_status IN ('compliant','partially_compliant','non_compliant',
                                 'not_applicable','not_assessed')),
  numerator          numeric(16,4),
  denominator        numeric(16,4),
  value              numeric(14,4),
  source             text NOT NULL DEFAULT 'module_event'
    CHECK (source IN ('module_event','auto_collector','manual')),
  logged_by          uuid REFERENCES public.users(id),
  logged_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nabh_evidence_log_hospital
  ON public.nabh_evidence_log (hospital_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_nabh_evidence_log_criterion
  ON public.nabh_evidence_log (hospital_id, criterion_number, logged_at DESC);

CREATE OR REPLACE FUNCTION public.tg_nabh_evidence_log_known_criterion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.is_known_criterion := EXISTS (
    SELECT 1 FROM public.nabh_standards s WHERE s.standard_code = NEW.criterion_number
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_nabh_evidence_log_known ON public.nabh_evidence_log;
CREATE TRIGGER trg_nabh_evidence_log_known
  BEFORE INSERT OR UPDATE ON public.nabh_evidence_log
  FOR EACH ROW EXECUTE FUNCTION public.tg_nabh_evidence_log_known_criterion();

ALTER TABLE public.nabh_evidence_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own hospital nabh evidence" ON public.nabh_evidence_log;
CREATE POLICY "Users view own hospital nabh evidence"
  ON public.nabh_evidence_log FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

-- Append-only: evidence is an audit trail, so no UPDATE/DELETE policy exists.
DROP POLICY IF EXISTS "Users append own hospital nabh evidence" ON public.nabh_evidence_log;
CREATE POLICY "Users append own hospital nabh evidence"
  ON public.nabh_evidence_log FOR INSERT TO authenticated
  WITH CHECK (hospital_id = public.get_user_hospital_id());

GRANT SELECT, INSERT ON public.nabh_evidence_log TO authenticated;

-- ─── 7. nabh_criteria: the missing unique constraint ─────────────────────────
-- Both existing writers (NABHDashboard.runAutoCollection and logNABHEvidence)
-- address rows by (hospital_id, criterion_number) with nothing enforcing it.
DELETE FROM public.nabh_criteria a
USING public.nabh_criteria b
WHERE a.hospital_id      = b.hospital_id
  AND a.criterion_number = b.criterion_number
  AND a.ctid < b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_nabh_criteria_hospital_criterion
  ON public.nabh_criteria (hospital_id, criterion_number);

ALTER TABLE public.nabh_criteria
  ADD COLUMN IF NOT EXISTS auto_source   text,
  ADD COLUMN IF NOT EXISTS evidence_json jsonb,
  ADD COLUMN IF NOT EXISTS computed_at   timestamptz;

-- ─── 8. Chapter names ────────────────────────────────────────────────────────
-- nabh_standards stores only chapter_code, but nabh_criteria.chapter_name is
-- NOT NULL and drives the dashboard's chapter list.
CREATE TABLE IF NOT EXISTS public.nabh_chapter_names (
  chapter_code text PRIMARY KEY,
  chapter_name text NOT NULL,
  sort_order   integer NOT NULL DEFAULT 100
);

INSERT INTO public.nabh_chapter_names (chapter_code, chapter_name, sort_order) VALUES
  ('AAC', 'Access, Assessment and Continuity of Care', 10),
  ('COP', 'Care of Patients',                          20),
  ('MOM', 'Management of Medication',                  30),
  ('PRE', 'Patient Rights and Education',              40),
  ('HIC', 'Hospital Infection Control',                50),
  ('ROM', 'Responsibilities of Management',            70),
  ('FMS', 'Facility Management and Safety',            80),
  ('HRM', 'Human Resource Management',                 90),
  ('IMS', 'Information Management System',            100),
  ('QPS', 'Quality and Patient Safety',               110)
ON CONFLICT (chapter_code) DO UPDATE
  SET chapter_name = EXCLUDED.chapter_name,
      sort_order   = EXCLUDED.sort_order;

ALTER TABLE public.nabh_chapter_names ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can read nabh chapter names" ON public.nabh_chapter_names;
CREATE POLICY "Authenticated can read nabh chapter names"
  ON public.nabh_chapter_names FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.nabh_chapter_names TO authenticated;

COMMENT ON TABLE public.quality_indicator_definitions IS
  'Global catalogue of NABH quality indicators: meaning, targets, provenance. '
  'Never stores executable SQL — collection logic lives in qi_collect_* functions.';
COMMENT ON TABLE public.nabh_evidence_log IS
  'Append-only NABH evidence trail written by logNABHEvidence() and the auto-collector.';
COMMENT ON VIEW public.quality_indicators_current IS
  'Latest period per (hospital, indicator). Read this for "current value"; read '
  'quality_indicators directly only for trends.';

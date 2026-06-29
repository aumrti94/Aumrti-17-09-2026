-- ── Gap 6: ICU Workspace Tables ──────────────────────────────────────────────

-- 1. Hourly vitals flowsheet (scrollable 24/48/72h grid)
CREATE TABLE IF NOT EXISTS public.icu_flowsheet_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id   uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  admission_id  uuid NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  recorded_by   uuid REFERENCES auth.users(id),
  hr            integer,
  sbp           integer,
  dbp           integer,
  map_calc      integer GENERATED ALWAYS AS (ROUND((sbp + 2 * dbp) / 3.0)) STORED,
  spo2          numeric(5,2),
  rr            integer,
  temp          numeric(4,1),
  gcs_total     integer,
  urine_ml      integer,
  ng_drain_ml   integer,
  chest_drain_ml integer,
  fio2_pct      numeric(5,2),
  peep          numeric(5,2),
  tv            integer,
  pip           integer,
  notes         text
);

CREATE INDEX IF NOT EXISTS idx_icu_flowsheet_admission
  ON public.icu_flowsheet_entries (hospital_id, admission_id, recorded_at DESC);

ALTER TABLE public.icu_flowsheet_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "icu_flowsheet_hospital_iso" ON public.icu_flowsheet_entries;
CREATE POLICY "icu_flowsheet_hospital_iso" ON public.icu_flowsheet_entries
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());


-- 2. Intake / Output balance records
CREATE TABLE IF NOT EXISTS public.io_balance_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id   uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  admission_id  uuid NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  recorded_by   uuid REFERENCES auth.users(id),
  category      text NOT NULL CHECK (category IN ('intake', 'output')),
  io_type       text NOT NULL,
  volume_ml     integer NOT NULL CHECK (volume_ml >= 0),
  description   text
);

CREATE INDEX IF NOT EXISTS idx_io_balance_admission
  ON public.io_balance_records (hospital_id, admission_id, recorded_at DESC);

ALTER TABLE public.io_balance_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "io_balance_hospital_iso" ON public.io_balance_records;
CREATE POLICY "io_balance_hospital_iso" ON public.io_balance_records
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());


-- 3. Ventilator parameters
CREATE TABLE IF NOT EXISTS public.ventilator_params (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id   uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  admission_id  uuid NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  recorded_by   uuid REFERENCES auth.users(id),
  vent_mode     text,
  fio2          numeric(5,2),
  peep          numeric(5,2),
  tv_set        integer,
  rr_set        integer,
  pip           numeric(6,2),
  pplat         numeric(6,2),
  compliance    numeric(6,2),
  ie_ratio      text,
  ps_above_peep numeric(5,2),
  notes         text
);

CREATE INDEX IF NOT EXISTS idx_vent_params_admission
  ON public.ventilator_params (hospital_id, admission_id, recorded_at DESC);

ALTER TABLE public.ventilator_params ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vent_params_hospital_iso" ON public.ventilator_params;
CREATE POLICY "vent_params_hospital_iso" ON public.ventilator_params
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());


-- 4. Sedation & delirium scores
CREATE TABLE IF NOT EXISTS public.sedation_scores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  admission_id    uuid NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  recorded_by     uuid REFERENCES auth.users(id),
  rass_score      integer CHECK (rass_score BETWEEN -5 AND 4),
  cpot_score      integer CHECK (cpot_score BETWEEN 0 AND 8),
  bps_score       integer CHECK (bps_score BETWEEN 3 AND 12),
  cam_icu_positive boolean,
  target_rass     integer,
  notes           text
);

CREATE INDEX IF NOT EXISTS idx_sedation_scores_admission
  ON public.sedation_scores (hospital_id, admission_id, recorded_at DESC);

ALTER TABLE public.sedation_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sedation_scores_hospital_iso" ON public.sedation_scores;
CREATE POLICY "sedation_scores_hospital_iso" ON public.sedation_scores
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());


-- 5. ICU daily goals checklist
CREATE TABLE IF NOT EXISTS public.icu_daily_goals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id   uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  admission_id  uuid NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
  goal_date     date NOT NULL DEFAULT CURRENT_DATE,
  goals         jsonb NOT NULL DEFAULT '{}',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES auth.users(id),
  UNIQUE (hospital_id, admission_id, goal_date)
);

CREATE INDEX IF NOT EXISTS idx_icu_daily_goals_admission
  ON public.icu_daily_goals (hospital_id, admission_id, goal_date DESC);

ALTER TABLE public.icu_daily_goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "icu_daily_goals_hospital_iso" ON public.icu_daily_goals;
CREATE POLICY "icu_daily_goals_hospital_iso" ON public.icu_daily_goals
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());


-- 6. Care bundle compliance (VAP, CLABSI, CAUTI)
CREATE TABLE IF NOT EXISTS public.care_bundle_checks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  admission_id    uuid NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
  bundle_type     text NOT NULL CHECK (bundle_type IN ('vap', 'clabsi', 'cauti', 'sepsis_6')),
  check_date      date NOT NULL DEFAULT CURRENT_DATE,
  items           jsonb NOT NULL DEFAULT '{}',
  compliance_pct  numeric(5,2),
  recorded_by     uuid REFERENCES auth.users(id),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, admission_id, bundle_type, check_date)
);

CREATE INDEX IF NOT EXISTS idx_care_bundles_admission
  ON public.care_bundle_checks (hospital_id, admission_id, bundle_type, check_date DESC);

ALTER TABLE public.care_bundle_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "care_bundles_hospital_iso" ON public.care_bundle_checks;
CREATE POLICY "care_bundles_hospital_iso" ON public.care_bundle_checks
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

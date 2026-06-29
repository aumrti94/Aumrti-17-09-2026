-- ── Gap 12: Nutrition & Dietetics ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.nutrition_screenings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  admission_id    uuid NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
  patient_id      uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  screening_tool  text NOT NULL DEFAULT 'nrs_2002'
    CHECK (screening_tool IN ('nrs_2002', 'must', 'mna')),
  -- NRS-2002 fields
  nrs_bmi_score       integer DEFAULT 0 CHECK (nrs_bmi_score BETWEEN 0 AND 3),
  nrs_weight_loss_score integer DEFAULT 0 CHECK (nrs_weight_loss_score BETWEEN 0 AND 3),
  nrs_intake_score    integer DEFAULT 0 CHECK (nrs_intake_score BETWEEN 0 AND 3),
  nrs_disease_score   integer DEFAULT 0 CHECK (nrs_disease_score BETWEEN 0 AND 3),
  nrs_age_score       integer DEFAULT 0 CHECK (nrs_age_score BETWEEN 0 AND 1),
  nrs_total_score     integer GENERATED ALWAYS AS (
    nrs_bmi_score + nrs_weight_loss_score + nrs_intake_score + nrs_disease_score + nrs_age_score
  ) STORED,
  risk_category   text,
  calorie_target  integer,
  protein_target  numeric(5,1),
  screened_by     uuid REFERENCES auth.users(id),
  screened_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (admission_id, screening_tool)
);

CREATE INDEX IF NOT EXISTS idx_nutrition_screenings_admission
  ON public.nutrition_screenings (hospital_id, admission_id);

ALTER TABLE public.nutrition_screenings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "nutrition_screenings_hospital_iso" ON public.nutrition_screenings;
CREATE POLICY "nutrition_screenings_hospital_iso" ON public.nutrition_screenings
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());


CREATE TABLE IF NOT EXISTS public.dietitian_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  admission_id    uuid NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
  note_date       date NOT NULL DEFAULT CURRENT_DATE,
  assessment      text,
  plan            text,
  goals           text,
  calorie_actual  integer,
  protein_actual  numeric(5,1),
  noted_by        uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dietitian_notes_admission
  ON public.dietitian_notes (hospital_id, admission_id, note_date DESC);

ALTER TABLE public.dietitian_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dietitian_notes_hospital_iso" ON public.dietitian_notes;
CREATE POLICY "dietitian_notes_hospital_iso" ON public.dietitian_notes
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- Extend diet_orders with calorie/protein targets (table already exists)
ALTER TABLE public.diet_orders
  ADD COLUMN IF NOT EXISTS calorie_target  integer,
  ADD COLUMN IF NOT EXISTS protein_target  numeric(5,1),
  ADD COLUMN IF NOT EXISTS texture_modification text,
  ADD COLUMN IF NOT EXISTS fluid_restriction_ml integer,
  ADD COLUMN IF NOT EXISTS notes text;


-- ── Gap 13: Wound Care Management ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.wound_assessments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  admission_id    uuid NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
  patient_id      uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  assessed_at     timestamptz NOT NULL DEFAULT now(),
  assessed_by     uuid REFERENCES auth.users(id),
  wound_type      text NOT NULL CHECK (wound_type IN ('pressure_injury','surgical','diabetic_foot','venous','arterial','traumatic','burn','other')),
  location        text NOT NULL,
  -- Size
  length_cm       numeric(5,1),
  width_cm        numeric(5,1),
  depth_cm        numeric(5,1),
  area_cm2        numeric(6,2) GENERATED ALWAYS AS (COALESCE(length_cm * width_cm, NULL)) STORED,
  -- Classification
  stage           text,
  tissue_type     text CHECK (tissue_type IN ('epithelial','granulation','slough','eschar','necrotic','mixed')),
  exudate_amount  text CHECK (exudate_amount IN ('none','minimal','moderate','heavy')),
  exudate_type    text CHECK (exudate_type IN ('serous','serosanguineous','sanguineous','purulent','haemoserous')),
  periwound       text,
  odour           boolean DEFAULT false,
  pain_score      integer CHECK (pain_score BETWEEN 0 AND 10),
  -- Care plan
  cleansing_agent text,
  dressing_type   text,
  dressing_frequency text,
  next_review_date date,
  wound_photo_url text,
  notes           text
);

CREATE INDEX IF NOT EXISTS idx_wound_assessments_admission
  ON public.wound_assessments (hospital_id, admission_id, assessed_at DESC);

ALTER TABLE public.wound_assessments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wound_assessments_hospital_iso" ON public.wound_assessments;
CREATE POLICY "wound_assessments_hospital_iso" ON public.wound_assessments
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());


CREATE TABLE IF NOT EXISTS public.braden_scale_assessments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  admission_id    uuid NOT NULL REFERENCES public.admissions(id) ON DELETE CASCADE,
  assessed_at     timestamptz NOT NULL DEFAULT now(),
  assessed_by     uuid REFERENCES auth.users(id),
  sensory_perception integer NOT NULL DEFAULT 4 CHECK (sensory_perception BETWEEN 1 AND 4),
  moisture           integer NOT NULL DEFAULT 4 CHECK (moisture BETWEEN 1 AND 4),
  activity           integer NOT NULL DEFAULT 4 CHECK (activity BETWEEN 1 AND 4),
  mobility           integer NOT NULL DEFAULT 4 CHECK (mobility BETWEEN 1 AND 4),
  nutrition_score    integer NOT NULL DEFAULT 4 CHECK (nutrition_score BETWEEN 1 AND 4),
  friction_shear     integer NOT NULL DEFAULT 3 CHECK (friction_shear BETWEEN 1 AND 3),
  total_score        integer GENERATED ALWAYS AS (
    sensory_perception + moisture + activity + mobility + nutrition_score + friction_shear
  ) STORED
);

CREATE INDEX IF NOT EXISTS idx_braden_admission
  ON public.braden_scale_assessments (hospital_id, admission_id, assessed_at DESC);

ALTER TABLE public.braden_scale_assessments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "braden_hospital_iso" ON public.braden_scale_assessments;
CREATE POLICY "braden_hospital_iso" ON public.braden_scale_assessments
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

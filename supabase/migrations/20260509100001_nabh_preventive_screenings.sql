
-- F1: Preventive & Promotive Health (AAC.11)
-- PHQ-9 mental health + NCD screenings + adult immunization

CREATE TABLE public.preventive_screenings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id   uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id    uuid NOT NULL REFERENCES public.patients(id),
  encounter_id  uuid,
  admission_id  uuid,
  screen_type   text NOT NULL CHECK (screen_type IN ('phq9','ncd_diabetes','ncd_hypertension','ncd_obesity','ncd_copd','cervical_cancer','breast_cancer')),
  score         integer,
  result_flag   text CHECK (result_flag IN ('normal','at_risk','positive','referred')),
  screened_by   uuid REFERENCES public.users(id),
  screened_at   timestamptz NOT NULL DEFAULT now(),
  referral_note text,
  is_deleted    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.preventive_screenings(hospital_id, patient_id);
CREATE INDEX ON public.preventive_screenings(hospital_id, screen_type, screened_at);
ALTER TABLE public.preventive_screenings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "preventive_screenings_hospital_isolation" ON public.preventive_screenings
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

CREATE TABLE public.adult_immunization_schedule (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id   uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id    uuid NOT NULL REFERENCES public.patients(id),
  vaccine_name  text NOT NULL,
  due_date      date,
  given_date    date,
  given_by      uuid REFERENCES public.users(id),
  batch_no      text,
  site          text,
  status        text NOT NULL DEFAULT 'due' CHECK (status IN ('due','given','overdue','deferred')),
  is_deleted    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.adult_immunization_schedule(hospital_id, patient_id);
CREATE INDEX ON public.adult_immunization_schedule(hospital_id, status, due_date);
ALTER TABLE public.adult_immunization_schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY "adult_immunization_schedule_hospital_isolation" ON public.adult_immunization_schedule
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

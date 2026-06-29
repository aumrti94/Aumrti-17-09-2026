
-- F5: Domiciliary / Home Care (AAC.12.f)
-- Post-discharge home visits and tele-monitoring

CREATE TABLE public.home_care_plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id       uuid NOT NULL REFERENCES public.patients(id),
  admission_id     uuid,
  created_by       uuid REFERENCES public.users(id),
  plan_type        text NOT NULL DEFAULT 'post_discharge' CHECK (plan_type IN ('post_discharge','chronic_care','palliative')),
  diagnosis        text,
  services_needed  text[],
  frequency        text,
  start_date       date NOT NULL,
  end_date         date,
  care_coordinator uuid REFERENCES public.users(id),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  notes            text,
  is_deleted       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.home_care_plans(hospital_id, patient_id);
CREATE INDEX ON public.home_care_plans(hospital_id, status);
ALTER TABLE public.home_care_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "home_care_plans_hospital_isolation" ON public.home_care_plans
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

CREATE TABLE public.home_care_visits (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      uuid NOT NULL REFERENCES public.hospitals(id),
  plan_id          uuid NOT NULL REFERENCES public.home_care_plans(id),
  patient_id       uuid NOT NULL REFERENCES public.patients(id),
  scheduled_date   date NOT NULL,
  visit_date       date,
  nurse_id         uuid REFERENCES public.users(id),
  status           text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','missed','rescheduled')),
  vital_bp         text,
  vital_pulse      integer,
  vital_temp       numeric(4,1),
  vital_spo2       integer,
  wound_condition  text CHECK (wound_condition IN ('healing','static','deteriorating','na')),
  services_done    text[],
  patient_feedback text,
  nurse_notes      text,
  geolocation      text,
  is_deleted       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.home_care_visits(hospital_id, plan_id, scheduled_date);
CREATE INDEX ON public.home_care_visits(hospital_id, scheduled_date);
ALTER TABLE public.home_care_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "home_care_visits_hospital_isolation" ON public.home_care_visits
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

CREATE TABLE public.home_tele_monitoring (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id   uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id    uuid NOT NULL REFERENCES public.patients(id),
  plan_id       uuid NOT NULL REFERENCES public.home_care_plans(id),
  bp_systolic   integer,
  bp_diastolic  integer,
  pulse         integer,
  blood_sugar   integer,
  spo2          integer,
  weight_kg     numeric(5,1),
  reported_at   timestamptz NOT NULL DEFAULT now(),
  source        text NOT NULL DEFAULT 'patient_entry' CHECK (source IN ('patient_entry','nurse_entry','device')),
  alert_sent    boolean NOT NULL DEFAULT false,
  is_deleted    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.home_tele_monitoring(hospital_id, patient_id, reported_at DESC);
ALTER TABLE public.home_tele_monitoring ENABLE ROW LEVEL SECURITY;
CREATE POLICY "home_tele_monitoring_hospital_isolation" ON public.home_tele_monitoring
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

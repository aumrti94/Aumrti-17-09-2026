
-- F9: Antibiotic Stewardship & High-Alert Meds (MOM.8.a, HRM.5.f)
-- Double-check log for high-alert MAR + antibiotic justification forms

ALTER TABLE public.drug_master ADD COLUMN IF NOT EXISTS is_high_alert boolean NOT NULL DEFAULT false;
ALTER TABLE public.drug_master ADD COLUMN IF NOT EXISTS high_alert_reason text;

CREATE TABLE public.mar_double_checks (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id               uuid NOT NULL REFERENCES public.hospitals(id),
  mar_id                    uuid,
  first_nurse_id            uuid REFERENCES public.users(id),
  second_nurse_id           uuid NOT NULL REFERENCES public.users(id),
  second_nurse_confirmed_at timestamptz NOT NULL DEFAULT now(),
  five_rights_both          boolean NOT NULL DEFAULT false,
  notes                     text,
  is_deleted                boolean NOT NULL DEFAULT false,
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.mar_double_checks(hospital_id, mar_id);
ALTER TABLE public.mar_double_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mar_double_checks_hospital_isolation" ON public.mar_double_checks
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

CREATE TABLE public.antibiotic_justifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id          uuid REFERENCES public.patients(id),
  admission_id        uuid,
  encounter_id        uuid,
  drug_name           text NOT NULL,
  prescribed_by       uuid REFERENCES public.users(id),
  indication          text NOT NULL,
  culture_available   boolean NOT NULL DEFAULT false,
  culture_ref         text,
  empirical           boolean NOT NULL DEFAULT true,
  de_escalation_plan  text,
  review_date         date,
  iv_to_oral_plan     boolean NOT NULL DEFAULT false,
  duration_days       integer,
  approved            boolean,
  approved_by         uuid REFERENCES public.users(id),
  is_deleted          boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.antibiotic_justifications(hospital_id, created_at DESC);
CREATE INDEX ON public.antibiotic_justifications(hospital_id, patient_id);
ALTER TABLE public.antibiotic_justifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "antibiotic_justifications_hospital_isolation" ON public.antibiotic_justifications
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

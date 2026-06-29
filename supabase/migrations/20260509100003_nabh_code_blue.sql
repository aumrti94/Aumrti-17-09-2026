
-- F3: Post-CPR / Code Blue Analysis (COP.5.e)
-- Multi-disciplinary post-event audit + CAPA documentation

CREATE TABLE public.code_blue_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id      uuid REFERENCES public.patients(id),
  admission_id    uuid,
  event_datetime  timestamptz NOT NULL,
  location        text NOT NULL,
  event_type      text NOT NULL DEFAULT 'cardiac_arrest' CHECK (event_type IN ('cardiac_arrest','respiratory_arrest','anaphylaxis','status_epilepticus','other')),
  initial_rhythm  text,
  rosc_achieved   boolean,
  rosc_time_min   integer,
  outcome         text CHECK (outcome IN ('survived','death','transferred_icu','discharged')),
  team_leader     uuid REFERENCES public.users(id),
  team_members    text[],
  is_deleted      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.code_blue_events(hospital_id, event_datetime DESC);
ALTER TABLE public.code_blue_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "code_blue_events_hospital_isolation" ON public.code_blue_events
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

CREATE TABLE public.code_blue_audits (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id           uuid NOT NULL REFERENCES public.hospitals(id),
  event_id              uuid NOT NULL REFERENCES public.code_blue_events(id),
  audit_date            date NOT NULL,
  audited_by            uuid REFERENCES public.users(id),
  mdt_doctor            boolean NOT NULL DEFAULT false,
  mdt_nurse             boolean NOT NULL DEFAULT false,
  mdt_pharmacist        boolean NOT NULL DEFAULT false,
  mdt_intensivist       boolean NOT NULL DEFAULT false,
  response_time_min     integer,
  cpr_quality           text CHECK (cpr_quality IN ('adequate','suboptimal','poor')),
  defibrillation_time   integer,
  protocol_followed     boolean,
  drug_errors           text,
  equipment_issues      text,
  good_practice_noted   text,
  areas_for_improvement text,
  root_cause            text,
  corrective_action     text,
  preventive_action     text,
  responsible_person    text,
  due_date              date,
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved')),
  is_deleted            boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.code_blue_audits(hospital_id, event_id);
ALTER TABLE public.code_blue_audits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "code_blue_audits_hospital_isolation" ON public.code_blue_audits
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

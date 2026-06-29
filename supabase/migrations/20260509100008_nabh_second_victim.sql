
-- F8: Second Victim Support (HRM.9.a)
-- Psychological support log for staff involved in adverse events

CREATE TABLE public.second_victim_cases (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         uuid NOT NULL REFERENCES public.hospitals(id),
  staff_id            uuid NOT NULL REFERENCES public.users(id),
  incident_ref_id     uuid,
  event_date          date NOT NULL,
  event_description   text,
  support_type        text[] NOT NULL DEFAULT '{}',
  support_assigned_to uuid REFERENCES public.users(id),
  status              text NOT NULL DEFAULT 'identified' CHECK (status IN ('identified','support_initiated','counselling_in_progress','returned_to_duty','closed')),
  sessions_count      integer NOT NULL DEFAULT 0,
  return_to_duty_date date,
  outcome_notes       text,
  is_confidential     boolean NOT NULL DEFAULT true,
  is_deleted          boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.second_victim_cases(hospital_id, event_date DESC);
ALTER TABLE public.second_victim_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "second_victim_cases_hospital_isolation" ON public.second_victim_cases
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

CREATE TABLE public.second_victim_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id  uuid NOT NULL REFERENCES public.hospitals(id),
  case_id      uuid NOT NULL REFERENCES public.second_victim_cases(id),
  session_date date NOT NULL,
  session_type text NOT NULL CHECK (session_type IN ('peer_support','counselling','debriefing','follow_up')),
  counsellor   text,
  duration_min integer,
  notes        text,
  is_deleted   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.second_victim_sessions(hospital_id, case_id);
ALTER TABLE public.second_victim_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "second_victim_sessions_hospital_isolation" ON public.second_victim_sessions
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

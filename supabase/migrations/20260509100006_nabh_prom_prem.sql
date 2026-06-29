
-- F6: Patient-Reported Outcome & Experience Measures (PRE.7.b & PSQ.1)
-- WhatsApp-triggered surveys 48h post-discharge

CREATE TABLE public.prom_prem_surveys (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id          uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id           uuid NOT NULL REFERENCES public.patients(id),
  admission_id         uuid,
  survey_type          text NOT NULL DEFAULT 'combined' CHECK (survey_type IN ('prem','prom','combined')),
  sent_at              timestamptz,
  responded_at         timestamptz,
  status               text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','responded','expired')),
  -- PREM scores (experience) 1-5 scale
  prem_communication   integer CHECK (prem_communication BETWEEN 1 AND 5),
  prem_cleanliness     integer CHECK (prem_cleanliness BETWEEN 1 AND 5),
  prem_responsiveness  integer CHECK (prem_responsiveness BETWEEN 1 AND 5),
  prem_dignity         integer CHECK (prem_dignity BETWEEN 1 AND 5),
  prem_discharge_info  integer CHECK (prem_discharge_info BETWEEN 1 AND 5),
  prem_overall         integer CHECK (prem_overall BETWEEN 1 AND 5),
  -- PROM scores (outcome)
  prom_pain_score      integer CHECK (prom_pain_score BETWEEN 0 AND 10),
  prom_mobility        text CHECK (prom_mobility IN ('normal','limited','bed_rest')),
  prom_able_to_work    boolean,
  prom_readmitted      boolean,
  comments             text,
  response_token       text UNIQUE DEFAULT gen_random_uuid()::text,
  is_deleted           boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.prom_prem_surveys(hospital_id, sent_at DESC);
CREATE INDEX ON public.prom_prem_surveys(response_token);
ALTER TABLE public.prom_prem_surveys ENABLE ROW LEVEL SECURITY;

-- Authenticated staff can read/write surveys for their hospital
CREATE POLICY "prom_prem_surveys_hospital_isolation" ON public.prom_prem_surveys
  FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

-- Public (anon) can SELECT and UPDATE using a response_token link (for patient portal response page)
CREATE POLICY "prom_prem_surveys_public_response_select" ON public.prom_prem_surveys
  FOR SELECT TO anon USING (response_token IS NOT NULL);

CREATE POLICY "prom_prem_surveys_public_response_update" ON public.prom_prem_surveys
  FOR UPDATE TO anon USING (response_token IS NOT NULL AND status = 'sent')
  WITH CHECK (response_token IS NOT NULL);

-- ── Gap 24: Research Platform ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.research_cohorts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  criteria        jsonb NOT NULL DEFAULT '[]',
  patient_count   integer DEFAULT 0,
  is_anonymised   boolean NOT NULL DEFAULT false,
  anonymisation_k integer DEFAULT 5,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_research_cohorts_hospital
  ON public.research_cohorts (hospital_id, created_at DESC);

ALTER TABLE public.research_cohorts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "research_cohorts_hospital_iso" ON public.research_cohorts;
CREATE POLICY "research_cohorts_hospital_iso" ON public.research_cohorts
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());


-- ── Gap 26: NPS Surveys ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.nps_surveys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  trigger_day     integer NOT NULL CHECK (trigger_day IN (30, 90, 180)),
  sent_at         timestamptz NOT NULL DEFAULT now(),
  patient_id      uuid REFERENCES public.patients(id),
  patient_phone   text,
  status          text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','responded','bounced'))
);

CREATE TABLE IF NOT EXISTS public.nps_responses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  survey_id       uuid NOT NULL REFERENCES public.nps_surveys(id) ON DELETE CASCADE,
  score           integer NOT NULL CHECK (score BETWEEN 0 AND 10),
  verbatim        text,
  responded_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nps_surveys_hospital
  ON public.nps_surveys (hospital_id, sent_at DESC);

ALTER TABLE public.nps_surveys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "nps_surveys_hospital_iso" ON public.nps_surveys;
CREATE POLICY "nps_surveys_hospital_iso" ON public.nps_surveys
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

ALTER TABLE public.nps_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "nps_responses_hospital_iso" ON public.nps_responses;
CREATE POLICY "nps_responses_hospital_iso" ON public.nps_responses
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());


-- ── Gap 25: White-Label Chain Management ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hospital_chains (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  slug            text NOT NULL UNIQUE,
  logo_url        text,
  primary_color   text DEFAULT '#1A2F5A',
  custom_domain   text,
  dns_verified    boolean DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chain_memberships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id        uuid NOT NULL REFERENCES public.hospital_chains(id) ON DELETE CASCADE,
  hospital_id     uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  joined_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, hospital_id)
);

CREATE INDEX IF NOT EXISTS idx_chain_memberships_hospital
  ON public.chain_memberships (hospital_id);

ALTER TABLE public.hospital_chains ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hospital_chains_platform_only" ON public.hospital_chains;
CREATE POLICY "hospital_chains_platform_only" ON public.hospital_chains
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.chain_memberships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chain_memberships_platform_only" ON public.chain_memberships;
CREATE POLICY "chain_memberships_platform_only" ON public.chain_memberships
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── Extend hospitals table with white-label theme columns ──────────────────

ALTER TABLE public.hospitals
  ADD COLUMN IF NOT EXISTS theme_accent_color   text,
  ADD COLUMN IF NOT EXISTS theme_font_family    text DEFAULT 'Inter',
  ADD COLUMN IF NOT EXISTS custom_domain        text,
  ADD COLUMN IF NOT EXISTS chain_id             uuid REFERENCES public.hospital_chains(id),
  ADD COLUMN IF NOT EXISTS abha_facility_id     text;

-- ABDM / ABHA database foundation
-- hospital_abdm_config, patient_abha_profiles, abdm_care_contexts,
-- abdm_consents, abdm_gateway_logs + hpr_id on users

-- ─── hospital_abdm_config ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hospital_abdm_config (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id           UUID NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  hfr_id                TEXT,
  facility_name         TEXT,
  abdm_client_id        TEXT,
  abdm_client_secret    TEXT,
  abdm_base_url         TEXT NOT NULL DEFAULT 'https://dev.abdm.gov.in',
  bridge_url            TEXT,
  hfr_registered_at     TIMESTAMPTZ,
  is_production         BOOLEAN NOT NULL DEFAULT false,
  feature_abha_creation BOOLEAN NOT NULL DEFAULT false,
  feature_hip_sharing   BOOLEAN NOT NULL DEFAULT false,
  feature_hiu_fetch     BOOLEAN NOT NULL DEFAULT false,
  feature_hcx_claims    BOOLEAN NOT NULL DEFAULT false,
  -- token cache (managed by abdm-gateway-token edge function)
  abdm_access_token     TEXT,
  abdm_token_expires_at TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hospital_id)
);

ALTER TABLE public.hospital_abdm_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "abdm_config_select" ON public.hospital_abdm_config;
DROP POLICY IF EXISTS "abdm_config_all"    ON public.hospital_abdm_config;

CREATE POLICY "abdm_config_select" ON public.hospital_abdm_config
  FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "abdm_config_all" ON public.hospital_abdm_config
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ─── patient_abha_profiles ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.patient_abha_profiles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  hospital_id      UUID NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  abha_number      TEXT,
  abha_address     TEXT,
  abha_profile     JSONB,
  mobile           TEXT,
  linked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_by        UUID REFERENCES public.users(id),
  consent_given    BOOLEAN NOT NULL DEFAULT false,
  consent_given_at TIMESTAMPTZ,
  abdm_token       TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL abha_numbers are excluded from uniqueness (PostgreSQL NULLs != NULL)
  UNIQUE (hospital_id, abha_number)
);

ALTER TABLE public.patient_abha_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "abha_profiles_select" ON public.patient_abha_profiles;
DROP POLICY IF EXISTS "abha_profiles_all"    ON public.patient_abha_profiles;

CREATE POLICY "abha_profiles_select" ON public.patient_abha_profiles
  FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "abha_profiles_all" ON public.patient_abha_profiles
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ─── abdm_care_contexts ─────────────────────────────────────────────────────
-- Column names match exactly what edge functions insert/query.
-- context_type values match ABDMCareContextsPanel CONTEXT_TYPE_LABEL keys.
-- link_status 'unlinked' is the default written by abdm-auto-link-care-context.
CREATE TABLE IF NOT EXISTS public.abdm_care_contexts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id  UUID NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  patient_id   UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  reference    TEXT NOT NULL,
  display      TEXT NOT NULL,
  context_type TEXT CHECK (context_type IN (
                  'OPDRecord',
                  'DischargeSummaryRecord',
                  'DiagnosticReportRecord',
                  'PrescriptionRecord',
                  'ImmunizationRecord',
                  'HealthDocumentRecord'
                )),
  source_id    UUID,
  linked_at    TIMESTAMPTZ,
  link_status  TEXT NOT NULL DEFAULT 'unlinked'
               CHECK (link_status IN ('unlinked', 'pending', 'linked', 'failed')),
  fhir_bundle  JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.abdm_care_contexts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "care_contexts_select" ON public.abdm_care_contexts;
DROP POLICY IF EXISTS "care_contexts_all"    ON public.abdm_care_contexts;

CREATE POLICY "care_contexts_select" ON public.abdm_care_contexts
  FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "care_contexts_all" ON public.abdm_care_contexts
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ─── abdm_consents ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.abdm_consents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     UUID NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  patient_id      UUID REFERENCES public.patients(id) ON DELETE SET NULL,
  consent_id      TEXT UNIQUE,
  requester_nid   TEXT,
  requester_name  TEXT,
  purpose_code    TEXT,
  purpose_text    TEXT,
  hip_ids         JSONB,
  hi_types        JSONB,
  date_range_from DATE,
  date_range_to   DATE,
  expiry          TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'REQUESTED'
                  CHECK (status IN ('REQUESTED', 'GRANTED', 'DENIED', 'REVOKED', 'EXPIRED')),
  granted_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  consent_detail  JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.abdm_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "abdm_consents_select" ON public.abdm_consents;
DROP POLICY IF EXISTS "abdm_consents_all"    ON public.abdm_consents;

CREATE POLICY "abdm_consents_select" ON public.abdm_consents
  FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "abdm_consents_all" ON public.abdm_consents
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ─── abdm_gateway_logs ──────────────────────────────────────────────────────
-- Column names match exactly what edge functions insert.
-- direction uses lowercase ('inbound'/'outbound') to match edge function inserts.
CREATE TABLE IF NOT EXISTS public.abdm_gateway_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      UUID REFERENCES public.hospitals(id) ON DELETE CASCADE,
  action           TEXT,
  direction        TEXT CHECK (direction IN ('inbound', 'outbound')),
  request_payload  JSONB,
  response_payload JSONB,
  status           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.abdm_gateway_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gateway_logs_select" ON public.abdm_gateway_logs;
DROP POLICY IF EXISTS "gateway_logs_all"    ON public.abdm_gateway_logs;

CREATE POLICY "gateway_logs_select" ON public.abdm_gateway_logs
  FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "gateway_logs_all" ON public.abdm_gateway_logs
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- ─── users: HPR registry columns ────────────────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS hpr_id TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS hpr_verified_at TIMESTAMPTZ;

-- HCX (Health Claims Exchange) schema
-- Extends hospital_abdm_config, insurance_claims, insurance_pre_auth
-- and adds an hcx_submissions audit log.

-- ─── hospital_abdm_config: HCX credentials ──────────────────────────────────
ALTER TABLE public.hospital_abdm_config
  ADD COLUMN IF NOT EXISTS hcx_participant_code    TEXT,
  ADD COLUMN IF NOT EXISTS hcx_client_id           TEXT,
  ADD COLUMN IF NOT EXISTS hcx_client_secret       TEXT,
  -- cached Keycloak access token (managed by hcx-claim-submit function)
  ADD COLUMN IF NOT EXISTS hcx_access_token        TEXT,
  ADD COLUMN IF NOT EXISTS hcx_token_expires_at    TIMESTAMPTZ;

-- ─── insurance_claims: HCX tracking columns ─────────────────────────────────
ALTER TABLE public.insurance_claims
  ADD COLUMN IF NOT EXISTS hcx_claim_id        TEXT,
  ADD COLUMN IF NOT EXISTS hcx_correlation_id  TEXT,
  ADD COLUMN IF NOT EXISTS hcx_workflow_id     TEXT,
  ADD COLUMN IF NOT EXISTS hcx_status          TEXT
    CHECK (hcx_status IN ('submitted','acknowledged','processing','approved','rejected','error')),
  ADD COLUMN IF NOT EXISTS hcx_response_json   JSONB,
  ADD COLUMN IF NOT EXISTS hcx_submitted_at    TIMESTAMPTZ;

-- ─── insurance_pre_auth: HCX pre-determination tracking ─────────────────────
ALTER TABLE public.insurance_pre_auth
  ADD COLUMN IF NOT EXISTS hcx_preauth_id      TEXT,
  ADD COLUMN IF NOT EXISTS hcx_correlation_id  TEXT,
  ADD COLUMN IF NOT EXISTS hcx_workflow_id     TEXT,
  ADD COLUMN IF NOT EXISTS hcx_status          TEXT
    CHECK (hcx_status IN ('submitted','acknowledged','processing','approved','rejected','error')),
  ADD COLUMN IF NOT EXISTS hcx_response_json   JSONB,
  ADD COLUMN IF NOT EXISTS hcx_submitted_at    TIMESTAMPTZ;

-- ─── hcx_submissions: full request / response audit log ─────────────────────
CREATE TABLE IF NOT EXISTS public.hcx_submissions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      UUID NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  claim_id         UUID REFERENCES public.insurance_claims(id) ON DELETE SET NULL,
  pre_auth_id      UUID REFERENCES public.insurance_pre_auth(id) ON DELETE SET NULL,
  api_call_id      TEXT NOT NULL,
  correlation_id   TEXT NOT NULL,
  workflow_id      TEXT,
  -- e.g. "coverageeligibility/check", "claim/submit", "claim/predetermination"
  action           TEXT NOT NULL,
  direction        TEXT NOT NULL CHECK (direction IN ('outbound','inbound')),
  request_fhir     JSONB,
  response_payload JSONB,
  hcx_status       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.hcx_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hcx_submissions_select" ON public.hcx_submissions;
DROP POLICY IF EXISTS "hcx_submissions_all"    ON public.hcx_submissions;

CREATE POLICY "hcx_submissions_select" ON public.hcx_submissions
  FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "hcx_submissions_all" ON public.hcx_submissions
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

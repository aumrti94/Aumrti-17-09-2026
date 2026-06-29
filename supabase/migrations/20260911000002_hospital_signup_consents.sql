-- DPDP Act 2023 consent capture for the /register self-signup flow.
-- Records the hospital admin's explicit acknowledgement of (a) Terms of Service +
-- Privacy Policy and (b) DPDP data-processing consent, with version, purpose,
-- timestamp and source IP for auditability. This is tenant/admin-level consent
-- (not patient PHI consent).

CREATE TABLE IF NOT EXISTS public.hospital_signup_consents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid REFERENCES public.hospitals(id) ON DELETE CASCADE,
  admin_email     text,
  terms_accepted  boolean NOT NULL DEFAULT false,
  dpdp_consent    boolean NOT NULL DEFAULT false,
  terms_version   text,
  purpose         text,
  consent_ip      text,
  consent_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hospital_signup_consents_hospital
  ON public.hospital_signup_consents (hospital_id);

ALTER TABLE public.hospital_signup_consents ENABLE ROW LEVEL SECURITY;

-- Hospital users may read their own consent records. Inserts happen via the
-- service-role register-hospital edge function (which bypasses RLS), so no
-- INSERT policy for anon/authenticated is required.
DROP POLICY IF EXISTS hospital_signup_consents_isolation ON public.hospital_signup_consents;
CREATE POLICY hospital_signup_consents_isolation
  ON public.hospital_signup_consents
  FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

COMMENT ON TABLE public.hospital_signup_consents IS 'DPDP Act 2023 consent + Terms acceptance captured at hospital self-registration.';

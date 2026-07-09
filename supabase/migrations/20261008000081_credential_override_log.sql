-- ============================================================
-- Clinical credential-gate override audit log
-- Records when a clinician proceeds with a high-risk sign-off (lab/radiology/
-- nursing) despite an expired/missing medical license, with the reason.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.credential_override_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id    uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  clinician_id   uuid REFERENCES public.users(id),   -- whose credential was in question
  acting_user_id uuid REFERENCES public.users(id),   -- who authorised the override
  module         text NOT NULL,                        -- lab | radiology | nursing
  action         text NOT NULL,                        -- validate_result | validate_report | medication_admin
  record_id      uuid,
  reason         text NOT NULL,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS credential_override_log_hospital_idx ON public.credential_override_log (hospital_id, created_at DESC);

ALTER TABLE public.credential_override_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'credential_override_log' AND policyname = 'credential_override_log_hospital') THEN
    CREATE POLICY "credential_override_log_hospital" ON public.credential_override_log
      FOR ALL TO authenticated
      USING (hospital_id = get_user_hospital_id())
      WITH CHECK (hospital_id = get_user_hospital_id());
  END IF;
END $$;

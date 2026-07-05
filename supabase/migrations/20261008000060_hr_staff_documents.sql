-- ============================================================
-- HR — Staff Document Vault
-- Contracts, ID proofs, certificates, licenses with expiry tracking.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.staff_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id  uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  doc_type     text NOT NULL DEFAULT 'other',
  file_url     text NOT NULL,
  file_name    text,
  expiry_date  date,
  verified     boolean DEFAULT false,
  verified_by  uuid REFERENCES public.users(id),
  uploaded_by  uuid REFERENCES public.users(id),
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_documents_user_idx ON public.staff_documents (user_id);
CREATE INDEX IF NOT EXISTS staff_documents_hospital_idx ON public.staff_documents (hospital_id);

ALTER TABLE public.staff_documents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'staff_documents' AND policyname = 'staff_documents_hospital') THEN
    CREATE POLICY "staff_documents_hospital" ON public.staff_documents
      FOR ALL TO authenticated
      USING (hospital_id = get_user_hospital_id())
      WITH CHECK (hospital_id = get_user_hospital_id());
  END IF;
END $$;

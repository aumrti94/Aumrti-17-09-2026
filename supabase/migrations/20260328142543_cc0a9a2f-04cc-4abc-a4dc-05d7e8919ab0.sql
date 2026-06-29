
-- Table: patient_documents
CREATE TABLE public.patient_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  document_name text NOT NULL,
  document_type text DEFAULT 'other',
  file_url text NOT NULL,
  ocr_text text,
  ocr_summary text,
  uploaded_by uuid REFERENCES public.users(id),
  upload_date date DEFAULT current_date,
  created_at timestamptz DEFAULT now()
);

-- Validation trigger
CREATE OR REPLACE FUNCTION public.validate_patient_document_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.document_type NOT IN ('old_prescription','old_report','discharge_summary','xray_image','insurance_card','id_proof','referral_letter','other') THEN
    RAISE EXCEPTION 'Invalid document_type: %', NEW.document_type;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_patient_document_type
  BEFORE INSERT OR UPDATE ON public.patient_documents
  FOR EACH ROW EXECUTE FUNCTION public.validate_patient_document_type();

-- RLS
ALTER TABLE public.patient_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view patient documents for their hospital"
  ON public.patient_documents FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Users can insert patient documents for their hospital"
  ON public.patient_documents FOR INSERT TO authenticated
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- Index
CREATE INDEX idx_patient_documents_patient ON public.patient_documents(hospital_id, patient_id);

-- Storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('patient-documents', 'patient-documents', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies
CREATE POLICY "Authenticated users can upload patient documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'patient-documents');

CREATE POLICY "Authenticated users can view patient documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'patient-documents');

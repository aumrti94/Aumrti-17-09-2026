-- Radiology modalities
CREATE TABLE public.radiology_modalities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  name text NOT NULL,
  modality_type text NOT NULL CHECK (modality_type IN (
    'xray','usg','ct','mri','echo','ecg',
    'mammography','dexa','fluoroscopy','endoscopy','other'
  )),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.radiology_modalities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own hospital radiology_modalities" ON public.radiology_modalities
  FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can view own hospital radiology_modalities" ON public.radiology_modalities
  FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

-- Radiology orders
CREATE TABLE public.radiology_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  encounter_id uuid REFERENCES public.opd_encounters(id),
  admission_id uuid REFERENCES public.admissions(id),
  modality_id uuid REFERENCES public.radiology_modalities(id) NOT NULL,
  modality_type text NOT NULL,
  study_name text NOT NULL,
  body_part text,
  clinical_history text,
  indication text,
  ordered_by uuid REFERENCES public.users(id) NOT NULL,
  priority text NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine','urgent','stat')),
  order_date date NOT NULL DEFAULT CURRENT_DATE,
  order_time timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'ordered' CHECK (status IN (
    'ordered','scheduled','patient_arrived',
    'in_progress','images_acquired','reported',
    'validated','cancelled'
  )),
  scheduled_time timestamptz,
  accession_number text UNIQUE,
  dicom_study_uid text,
  dicom_pacs_url text,
  is_pcpndt boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.radiology_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own hospital radiology_orders" ON public.radiology_orders
  FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can view own hospital radiology_orders" ON public.radiology_orders
  FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

-- Radiology reports
CREATE TABLE public.radiology_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  order_id uuid REFERENCES public.radiology_orders(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  technique text,
  findings text,
  impression text,
  recommendations text,
  ai_impression_suggestion text,
  is_ai_used boolean DEFAULT false,
  comparison_note text,
  critical_finding text,
  is_critical boolean DEFAULT false,
  radiologist_id uuid REFERENCES public.users(id),
  reported_at timestamptz,
  validated_at timestamptz,
  validated_by uuid REFERENCES public.users(id),
  is_signed boolean DEFAULT false,
  whatsapp_sent boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.radiology_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own hospital radiology_reports" ON public.radiology_reports
  FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can view own hospital radiology_reports" ON public.radiology_reports
  FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

-- PCPNDT Form F
CREATE TABLE public.pcpndt_form_f (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  order_id uuid REFERENCES public.radiology_orders(id) NOT NULL,
  patient_name text NOT NULL,
  patient_age integer,
  patient_address text,
  referred_by text,
  indication text,
  sex_determination_done boolean DEFAULT false,
  remarks text,
  signed_by uuid REFERENCES public.users(id) NOT NULL,
  signed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.pcpndt_form_f ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own hospital pcpndt_form_f" ON public.pcpndt_form_f
  FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can view own hospital pcpndt_form_f" ON public.pcpndt_form_f
  FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

-- Seed default modalities for the hospital (skipped on fresh DBs where this hospital doesn't exist)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.hospitals WHERE id = '8f3d08b3-8835-42a7-920e-fdf5a78260bc') THEN RETURN; END IF;
  INSERT INTO public.radiology_modalities (hospital_id, name, modality_type) VALUES
    ('8f3d08b3-8835-42a7-920e-fdf5a78260bc', 'X-Ray', 'xray'),
    ('8f3d08b3-8835-42a7-920e-fdf5a78260bc', 'Ultrasound (USG)', 'usg'),
    ('8f3d08b3-8835-42a7-920e-fdf5a78260bc', 'ECG', 'ecg'),
    ('8f3d08b3-8835-42a7-920e-fdf5a78260bc', '2D Echo', 'echo');
END $$;
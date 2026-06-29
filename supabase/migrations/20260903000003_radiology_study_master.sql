-- Radiology Study Master: individual studies under each modality category with per-study fees

CREATE TABLE IF NOT EXISTS public.radiology_study_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  modality_id uuid REFERENCES public.radiology_modalities(id) ON DELETE CASCADE NOT NULL,
  modality_type text NOT NULL,
  study_name text NOT NULL,
  fee numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.radiology_study_master ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own hospital radiology_study_master" ON public.radiology_study_master
  FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

CREATE INDEX idx_radiology_study_master_hospital ON public.radiology_study_master(hospital_id);
CREATE INDEX idx_radiology_study_master_modality ON public.radiology_study_master(modality_id);

-- Seed default studies for all existing hospitals that have modalities
-- Each study inherits the modality's current fee as starting point
INSERT INTO public.radiology_study_master (hospital_id, modality_id, modality_type, study_name, fee, sort_order)
SELECT m.hospital_id, m.id, m.modality_type, s.study_name, m.fee, s.sorder
FROM public.radiology_modalities m
JOIN (VALUES
  ('xray',        'X-Ray Chest PA View',      1),
  ('xray',        'X-Ray Chest AP View',      2),
  ('xray',        'X-Ray KUB',                3),
  ('xray',        'X-Ray LS Spine AP/Lat',    4),
  ('xray',        'X-Ray Knee AP/Lat',        5),
  ('xray',        'X-Ray Skull AP/Lat',       6),
  ('usg',         'USG Abdomen',              1),
  ('usg',         'USG Pelvis',               2),
  ('usg',         'USG Abdomen + Pelvis',     3),
  ('usg',         'USG Neck',                 4),
  ('usg',         'USG Breast',               5),
  ('usg',         'USG KUB + Prostate',       6),
  ('usg',         'USG Obstetric',            7),
  ('usg',         'USG Thyroid',              8),
  ('usg',         'Doppler Study',            9),
  ('ct',          'CT Brain Plain',           1),
  ('ct',          'CT Chest',                 2),
  ('ct',          'CT Abdomen + Pelvis',      3),
  ('ct',          'HRCT Chest',               4),
  ('ct',          'CECT Abdomen',             5),
  ('mri',         'MRI Brain',                1),
  ('mri',         'MRI Spine',                2),
  ('mri',         'MRI Knee',                 3),
  ('mri',         'MRI Shoulder',             4),
  ('echo',        '2D Echo + Doppler',        1),
  ('echo',        'Stress Echo',              2),
  ('ecg',         'ECG (12-Lead)',            1),
  ('ecg',         'Stress ECG (TMT)',         2),
  ('dexa',        'DEXA Scan (Spine + Hip)',  1),
  ('mammography', 'Mammography Bilateral',    1),
  ('mammography', 'Mammography Unilateral',   2),
  ('fluoroscopy', 'Fluoroscopy Upper GI',     1),
  ('fluoroscopy', 'Barium Swallow',           2)
) AS s(modality_type, study_name, sorder) ON m.modality_type = s.modality_type
ON CONFLICT DO NOTHING;

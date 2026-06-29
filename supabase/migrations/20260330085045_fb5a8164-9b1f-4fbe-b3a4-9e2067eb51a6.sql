
-- AYUSH Module (M37) Tables

-- 1. Prakriti Assessments
CREATE TABLE public.prakriti_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  patient_id uuid REFERENCES patients(id) NOT NULL,
  assessed_by uuid REFERENCES users(id) NOT NULL,
  assessed_at date NOT NULL DEFAULT current_date,
  responses jsonb NOT NULL DEFAULT '{}',
  vata_score integer NOT NULL,
  pitta_score integer NOT NULL,
  kapha_score integer NOT NULL,
  dominant_dosha text NOT NULL,
  prakriti_summary text,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.validate_prakriti_assessment()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.dominant_dosha NOT IN ('vata','pitta','kapha','vata_pitta','pitta_kapha','vata_kapha','tridosha') THEN
    RAISE EXCEPTION 'Invalid dominant_dosha: %', NEW.dominant_dosha;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_prakriti_assessment
  BEFORE INSERT OR UPDATE ON public.prakriti_assessments
  FOR EACH ROW EXECUTE FUNCTION public.validate_prakriti_assessment();

-- 2. AYUSH Encounters
CREATE TABLE public.ayush_encounters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  patient_id uuid REFERENCES patients(id) NOT NULL,
  encounter_date date NOT NULL DEFAULT current_date,
  system text NOT NULL,
  practitioner_id uuid REFERENCES users(id) NOT NULL,
  chief_complaint text NOT NULL,
  nadi_pariksha text,
  mala_pariksha text,
  mutra_pariksha text,
  jivha_pariksha text,
  shabda_pariksha text,
  sparsha_pariksha text,
  drik_pariksha text,
  akriti_pariksha text,
  ayurvedic_diagnosis text,
  icd_code text,
  prescription jsonb DEFAULT '[]',
  diet_advice text,
  lifestyle_advice text,
  follow_up_days integer,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.validate_ayush_encounter()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.system NOT IN ('ayurveda','homeopathy','unani','siddha','yoga','naturopathy') THEN
    RAISE EXCEPTION 'Invalid system: %', NEW.system;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_ayush_encounter
  BEFORE INSERT OR UPDATE ON public.ayush_encounters
  FOR EACH ROW EXECUTE FUNCTION public.validate_ayush_encounter();

-- 3. Panchakarma Schedules
CREATE TABLE public.panchakarma_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  patient_id uuid REFERENCES patients(id) NOT NULL,
  prescribed_by uuid REFERENCES users(id) NOT NULL,
  procedure_type text NOT NULL,
  scheduled_date date NOT NULL,
  session_time time,
  duration_minutes integer,
  therapist_id uuid REFERENCES users(id),
  oil_medicine text,
  oil_quantity_ml numeric(6,1),
  status text DEFAULT 'scheduled',
  patient_feedback text,
  observations text,
  completed_at timestamptz,
  billed boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.validate_panchakarma_schedule()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.procedure_type NOT IN (
    'abhyanga','shirodhara','basti','virechana','vamana',
    'nasya','raktamokshana','udvartana','pinda_sweda',
    'shastika_shali','netra_tarpana','kati_basti','other'
  ) THEN
    RAISE EXCEPTION 'Invalid procedure_type: %', NEW.procedure_type;
  END IF;
  IF NEW.status NOT IN ('scheduled','completed','cancelled','no_show') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_panchakarma_schedule
  BEFORE INSERT OR UPDATE ON public.panchakarma_schedules
  FOR EACH ROW EXECUTE FUNCTION public.validate_panchakarma_schedule();

-- 4. AYUSH Drug Master
CREATE TABLE public.ayush_drug_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id),
  drug_name text NOT NULL,
  formulation_type text NOT NULL,
  system text NOT NULL,
  manufacturer text,
  dose_adult text,
  anupana text,
  indications text,
  contraindications text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.validate_ayush_drug_master()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.formulation_type NOT IN (
    'kashaya','arishta','asava','vati','churna',
    'ghrita','taila','leha','bhasma','single_herb','proprietary'
  ) THEN
    RAISE EXCEPTION 'Invalid formulation_type: %', NEW.formulation_type;
  END IF;
  IF NEW.system NOT IN ('ayurveda','homeopathy','unani','siddha') THEN
    RAISE EXCEPTION 'Invalid system: %', NEW.system;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_ayush_drug_master
  BEFORE INSERT OR UPDATE ON public.ayush_drug_master
  FOR EACH ROW EXECUTE FUNCTION public.validate_ayush_drug_master();

-- Indexes
CREATE INDEX idx_prakriti_patient ON prakriti_assessments(patient_id);
CREATE INDEX idx_prakriti_hospital ON prakriti_assessments(hospital_id);
CREATE INDEX idx_ayush_enc_patient ON ayush_encounters(patient_id);
CREATE INDEX idx_ayush_enc_hospital ON ayush_encounters(hospital_id);
CREATE INDEX idx_ayush_enc_system ON ayush_encounters(system);
CREATE INDEX idx_panchakarma_patient ON panchakarma_schedules(patient_id);
CREATE INDEX idx_panchakarma_hospital ON panchakarma_schedules(hospital_id);
CREATE INDEX idx_panchakarma_date ON panchakarma_schedules(scheduled_date);
CREATE INDEX idx_ayush_drug_system ON ayush_drug_master(system);
CREATE INDEX idx_ayush_drug_hospital ON ayush_drug_master(hospital_id);

-- RLS
ALTER TABLE prakriti_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ayush_encounters ENABLE ROW LEVEL SECURITY;
ALTER TABLE panchakarma_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE ayush_drug_master ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital isolation" ON prakriti_assessments FOR ALL USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "Hospital isolation" ON ayush_encounters FOR ALL USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "Hospital isolation" ON panchakarma_schedules FOR ALL USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "Hospital or system drugs" ON ayush_drug_master FOR ALL USING (hospital_id IS NULL OR hospital_id = public.get_user_hospital_id());

-- Seed 30 Ayurvedic formulations
INSERT INTO ayush_drug_master (drug_name, formulation_type, system, dose_adult, anupana, indications) VALUES
('Triphala Churna','churna','ayurveda','5-10g at bedtime','With warm water','Constipation, digestive disorders, eye health'),
('Ashwagandha Churna','churna','ayurveda','3-6g twice daily','With milk','Stress, weakness, rejuvenation, muscle building'),
('Brahmi Vati','vati','ayurveda','1-2 tabs twice daily','With water','Memory, anxiety, epilepsy, insomnia'),
('Triphala Guggulu','vati','ayurveda','2 tabs thrice daily','With warm water','Obesity, skin disorders, joint pain'),
('Arjunarishta','arishta','ayurveda','15-20ml after meals','Equal water','Heart conditions, hypertension'),
('Dashamoolarishta','arishta','ayurveda','15ml twice daily','Equal water','Neurological disorders, post-partum care'),
('Punarnavarishta','arishta','ayurveda','15-30ml twice daily','Equal water','Kidney disorders, oedema, anaemia'),
('Draksharishtam','arishta','ayurveda','15ml after meals','Equal water','Weakness, respiratory conditions'),
('Saraswatarishta','arishta','ayurveda','15-20ml twice daily','Equal water','Mental disorders, epilepsy, speech problems'),
('Abhayarishta','arishta','ayurveda','15-30ml twice daily','Equal water','Constipation, haemorrhoids, digestive issues'),
('Bala Ashwagandha Tailam','taila','ayurveda','External application','Warm oil massage','Joint pain, paralysis, muscle weakness'),
('Mahanarayan Tailam','taila','ayurveda','External/internal','Warm oil massage','Arthritis, pain, nervous system'),
('Ksheerabala Tailam','taila','ayurveda','External/5-10 drops oral','Warm oil massage','Vata disorders, pain, neurological'),
('Neem Churna','churna','ayurveda','3-5g twice daily','With water','Skin disorders, diabetes, infections, worms'),
('Shatavari Churna','churna','ayurveda','5g twice daily','With milk','Female reproductive health, menopause, galactagogue'),
('Yashtimadhu Churna','churna','ayurveda','3-5g twice daily','With honey','Gastric ulcer, cough, throat, skin'),
('Giloy Juice','single_herb','ayurveda','20-30ml once daily','Empty stomach','Immunity, fever, chronic diseases, diabetes'),
('Tulsi Drops','single_herb','ayurveda','1-2ml in water daily','Warm water','Cold, cough, immunity, stress'),
('Chyawanprash','leha','ayurveda','1-2 tsp twice daily','Milk or warm water','General immunity, respiratory health, rejuvenation'),
('Mahamanjisthadi Kadha','kashaya','ayurveda','30-60ml twice daily','Before meals','Skin disorders, blood purification'),
('Chandraprabha Vati','vati','ayurveda','2 tabs twice daily','With warm water','Urinary disorders, diabetes, kidney stones'),
('Aarogyavardhini Vati','vati','ayurveda','2 tabs twice daily','With warm water','Liver disorders, obesity, skin conditions'),
('Kanchanar Guggulu','vati','ayurveda','2-4 tabs twice daily','With warm water','Thyroid disorders, lymphadenopathy, PCOS'),
('Shuddha Shilajit','single_herb','ayurveda','250-500mg with milk','Milk','Diabetes, anti-ageing, energy, kidney disorders'),
('Punarnavadi Kashayam','kashaya','ayurveda','15ml twice daily','Warm water','Kidney disorders, oedema, anaemia'),
('Mustadi Kashayam','kashaya','ayurveda','15ml twice daily','Warm water','Skin disorders, oedema, fever'),
('Manjishtadi Kashayam','kashaya','ayurveda','15ml twice daily','Warm water','Skin disorders, inflammatory conditions'),
('Varanadi Kashayam','kashaya','ayurveda','15ml twice daily','Warm water','Obesity, thyroid, PCOS'),
('Rasnadi Guggulu','vati','ayurveda','2 tabs twice daily','Warm water','Arthritis, joint pain, sciatica, gout'),
('Mahasudarshan Churna','churna','ayurveda','3-6g twice daily','Warm water','Fever, malaria, liver disorders, infections');

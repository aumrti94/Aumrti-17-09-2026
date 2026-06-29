
-- Validation functions first
CREATE OR REPLACE FUNCTION public.validate_vaccine_master()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.type NOT IN ('live_attenuated','inactivated','subunit','toxoid','mrna','viral_vector','combination','other') THEN
    RAISE EXCEPTION 'Invalid vaccine type: %', NEW.type;
  END IF;
  IF NEW.route NOT IN ('im','sc','id','oral','intranasal') THEN
    RAISE EXCEPTION 'Invalid route: %', NEW.route;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.validate_vaccination_record()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.vvm_status IS NOT NULL AND NEW.vvm_status NOT IN ('ok','stage1','stage2','discarded') THEN
    RAISE EXCEPTION 'Invalid vvm_status: %', NEW.vvm_status;
  END IF;
  IF NEW.aefi_severity IS NOT NULL AND NEW.aefi_severity NOT IN ('mild','moderate','severe') THEN
    RAISE EXCEPTION 'Invalid aefi_severity: %', NEW.aefi_severity;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.validate_vaccination_due()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status NOT IN ('due','given','overdue','missed','waived') THEN
    RAISE EXCEPTION 'Invalid vaccination_due status: %', NEW.status;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.validate_vaccine_stock()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.stock_type NOT IN ('government_supplied','purchased') THEN
    RAISE EXCEPTION 'Invalid stock_type: %', NEW.stock_type;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.validate_vaccine_camp()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status NOT IN ('planned','ongoing','completed','cancelled') THEN
    RAISE EXCEPTION 'Invalid camp status: %', NEW.status;
  END IF;
  RETURN NEW;
END; $$;

-- Tables
CREATE TABLE vaccine_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id),
  vaccine_name text NOT NULL,
  vaccine_code text UNIQUE NOT NULL,
  manufacturer text,
  type text NOT NULL,
  route text NOT NULL,
  dose_ml numeric(4,2),
  site text,
  storage_temp_c text DEFAULT '2-8',
  vvm_type text,
  nis_schedule boolean DEFAULT false,
  age_given text,
  week_of_life integer,
  contraindications text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE vaccination_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  patient_id uuid REFERENCES patients(id) NOT NULL,
  vaccine_id uuid REFERENCES vaccine_master(id) NOT NULL,
  dose_number integer DEFAULT 1,
  administered_at date NOT NULL,
  administered_by uuid REFERENCES users(id) NOT NULL,
  batch_number text,
  manufacturer text,
  expiry_date date,
  site text,
  route text,
  vvm_status text,
  aefi_reported boolean DEFAULT false,
  aefi_description text,
  aefi_severity text,
  next_dose_due date,
  notes text,
  camp_id uuid,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE vaccination_due (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  patient_id uuid REFERENCES patients(id) NOT NULL,
  vaccine_id uuid REFERENCES vaccine_master(id) NOT NULL,
  dose_number integer NOT NULL,
  due_date date NOT NULL,
  status text DEFAULT 'due',
  reminder_sent boolean DEFAULT false,
  reminder_sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE vaccine_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  vaccine_id uuid REFERENCES vaccine_master(id) NOT NULL,
  stock_type text DEFAULT 'purchased',
  batch_number text NOT NULL,
  manufacturer text NOT NULL,
  received_date date NOT NULL,
  expiry_date date NOT NULL,
  quantity_received integer NOT NULL,
  quantity_used integer DEFAULT 0,
  quantity_wasted integer DEFAULT 0,
  quantity_balance integer GENERATED ALWAYS AS (quantity_received - quantity_used - quantity_wasted) STORED,
  storage_location text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE vaccine_camps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  camp_name text NOT NULL,
  camp_date date NOT NULL,
  location text NOT NULL,
  target_population text,
  target_count integer,
  vaccines_planned jsonb DEFAULT '[]',
  actual_count integer DEFAULT 0,
  conducted_by uuid REFERENCES users(id),
  status text DEFAULT 'planned',
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE cold_chain_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  unit_name text NOT NULL,
  temperature_c numeric(4,1) NOT NULL,
  recorded_at timestamptz DEFAULT now(),
  recorded_by uuid REFERENCES users(id),
  alert_triggered boolean DEFAULT false,
  corrective_action text
);

-- Triggers
CREATE TRIGGER trg_validate_vaccine_master BEFORE INSERT OR UPDATE ON vaccine_master
FOR EACH ROW EXECUTE FUNCTION public.validate_vaccine_master();

CREATE TRIGGER trg_validate_vaccination_record BEFORE INSERT OR UPDATE ON vaccination_records
FOR EACH ROW EXECUTE FUNCTION public.validate_vaccination_record();

CREATE TRIGGER trg_validate_vaccination_due BEFORE INSERT OR UPDATE ON vaccination_due
FOR EACH ROW EXECUTE FUNCTION public.validate_vaccination_due();

CREATE TRIGGER trg_validate_vaccine_stock BEFORE INSERT OR UPDATE ON vaccine_stock
FOR EACH ROW EXECUTE FUNCTION public.validate_vaccine_stock();

CREATE TRIGGER trg_validate_vaccine_camp BEFORE INSERT OR UPDATE ON vaccine_camps
FOR EACH ROW EXECUTE FUNCTION public.validate_vaccine_camp();

-- RLS
ALTER TABLE vaccine_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE vaccination_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE vaccination_due ENABLE ROW LEVEL SECURITY;
ALTER TABLE vaccine_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE vaccine_camps ENABLE ROW LEVEL SECURITY;
ALTER TABLE cold_chain_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vaccine_master_read" ON vaccine_master FOR SELECT TO authenticated
USING (hospital_id IS NULL OR hospital_id = public.get_user_hospital_id());
CREATE POLICY "vaccine_master_write" ON vaccine_master FOR INSERT TO authenticated
WITH CHECK (hospital_id = public.get_user_hospital_id());
CREATE POLICY "vaccine_master_update" ON vaccine_master FOR UPDATE TO authenticated
USING (hospital_id = public.get_user_hospital_id())
WITH CHECK (hospital_id = public.get_user_hospital_id());
CREATE POLICY "vaccine_master_delete" ON vaccine_master FOR DELETE TO authenticated
USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "vaccination_records_all" ON vaccination_records FOR ALL TO authenticated
USING (hospital_id = public.get_user_hospital_id())
WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "vaccination_due_all" ON vaccination_due FOR ALL TO authenticated
USING (hospital_id = public.get_user_hospital_id())
WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "vaccine_stock_all" ON vaccine_stock FOR ALL TO authenticated
USING (hospital_id = public.get_user_hospital_id())
WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "vaccine_camps_all" ON vaccine_camps FOR ALL TO authenticated
USING (hospital_id = public.get_user_hospital_id())
WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "cold_chain_log_all" ON cold_chain_log FOR ALL TO authenticated
USING (hospital_id = public.get_user_hospital_id())
WITH CHECK (hospital_id = public.get_user_hospital_id());

-- Indexes
CREATE INDEX idx_vaccination_records_patient ON vaccination_records(patient_id);
CREATE INDEX idx_vaccination_records_hospital ON vaccination_records(hospital_id);
CREATE INDEX idx_vaccination_due_patient ON vaccination_due(patient_id, status);
CREATE INDEX idx_vaccination_due_date ON vaccination_due(due_date, status);
CREATE INDEX idx_vaccine_stock_hospital ON vaccine_stock(hospital_id, vaccine_id);
CREATE INDEX idx_vaccine_stock_expiry ON vaccine_stock(expiry_date);
CREATE INDEX idx_cold_chain_log_hospital ON cold_chain_log(hospital_id, recorded_at);

-- SEED NIS 2025
INSERT INTO vaccine_master
  (vaccine_name, vaccine_code, type, route, dose_ml, site, storage_temp_c, nis_schedule, age_given, week_of_life)
VALUES
('BCG','BCG','live_attenuated','id',0.1,'Left upper arm','2-8',true,'At birth',0),
('Hepatitis B - Birth dose','HBV0','inactivated','im',0.5,'Anterolateral thigh','2-8',true,'At birth',0),
('OPV - Birth dose','OPV0','live_attenuated','oral',2.0,'Oral','2-8',true,'At birth',0),
('OPV - 1st dose','OPV1','live_attenuated','oral',2.0,'Oral','2-8',true,'6 weeks',6),
('DPT - 1st dose','DPT1','inactivated','im',0.5,'Anterolateral thigh','2-8',true,'6 weeks',6),
('Hepatitis B - 1st dose','HBV1','inactivated','im',0.5,'Anterolateral thigh','2-8',true,'6 weeks',6),
('Hib - 1st dose','HIB1','inactivated','im',0.5,'Anterolateral thigh','2-8',true,'6 weeks',6),
('IPV - 1st dose','IPV1','inactivated','im',0.5,'Anterolateral thigh','2-8',true,'6 weeks',6),
('Rotavirus - 1st dose','ROTA1','live_attenuated','oral',1.5,'Oral','2-8',true,'6 weeks',6),
('PCV - 1st dose','PCV1','inactivated','im',0.5,'Anterolateral thigh','2-8',true,'6 weeks',6),
('OPV - 2nd dose','OPV2','live_attenuated','oral',2.0,'Oral','2-8',true,'10 weeks',10),
('DPT - 2nd dose','DPT2','inactivated','im',0.5,'Anterolateral thigh','2-8',true,'10 weeks',10),
('Hepatitis B - 2nd dose','HBV2','inactivated','im',0.5,'Anterolateral thigh','2-8',true,'10 weeks',10),
('Hib - 2nd dose','HIB2','inactivated','im',0.5,'Anterolateral thigh','2-8',true,'10 weeks',10),
('Rotavirus - 2nd dose','ROTA2','live_attenuated','oral',1.5,'Oral','2-8',true,'10 weeks',10),
('PCV - 2nd dose','PCV2','inactivated','im',0.5,'Anterolateral thigh','2-8',true,'10 weeks',10),
('OPV - 3rd dose','OPV3','live_attenuated','oral',2.0,'Oral','2-8',true,'14 weeks',14),
('DPT - 3rd dose','DPT3','inactivated','im',0.5,'Anterolateral thigh','2-8',true,'14 weeks',14),
('Hepatitis B - 3rd dose','HBV3','inactivated','im',0.5,'Anterolateral thigh','2-8',true,'14 weeks',14),
('Hib - 3rd dose','HIB3','inactivated','im',0.5,'Anterolateral thigh','2-8',true,'14 weeks',14),
('IPV - 2nd dose','IPV2','inactivated','im',0.5,'Anterolateral thigh','2-8',true,'14 weeks',14),
('Rotavirus - 3rd dose','ROTA3','live_attenuated','oral',1.5,'Oral','2-8',true,'14 weeks',14),
('PCV - 3rd dose (Booster)','PCV3','inactivated','im',0.5,'Anterolateral thigh','2-8',true,'9 months',39),
('Measles-Rubella (1st)','MR1','live_attenuated','sc',0.5,'Left upper arm','2-8',true,'9 months',39),
('JE - 1st dose','JE1','inactivated','sc',0.5,'Left upper arm','2-8',true,'9 months',39),
('Vitamin A 1st dose','VITA1','other','oral',1.0,'Oral (1 lakh IU)','2-8',true,'9 months',39),
('DPT Booster 1','DPT-B1','inactivated','im',0.5,'Anterolateral thigh','2-8',true,'16-24 months',78),
('OPV Booster','OPV-B','live_attenuated','oral',2.0,'Oral','2-8',true,'16-24 months',78),
('Measles-Rubella (2nd)','MR2','live_attenuated','sc',0.5,'Left upper arm','2-8',true,'16-24 months',78),
('JE - 2nd dose','JE2','inactivated','sc',0.5,'Left upper arm','2-8',true,'16-24 months',78),
('Vitamin A 2nd dose','VITA2','other','oral',2.0,'Oral (2 lakh IU)','2-8',true,'16-24 months',78),
('DPT Booster 2','DPT-B2','inactivated','im',0.5,'Upper arm','2-8',true,'5-6 years',null),
('OPV Booster 2','OPV-B2','live_attenuated','oral',2.0,'Oral','2-8',true,'5-6 years',null),
('TT/Td - 10 years','TT10','toxoid','im',0.5,'Upper arm','2-8',true,'10 years',null),
('TT/Td - 16 years','TT16','toxoid','im',0.5,'Upper arm','2-8',true,'16 years',null),
('Varicella - 1st dose','VAR1','live_attenuated','sc',0.5,'Left upper arm','-15 to -25',false,'15 months',null),
('Varicella - 2nd dose','VAR2','live_attenuated','sc',0.5,'Left upper arm','-15 to -25',false,'4-6 years',null),
('Typhoid Conjugate','TCV','inactivated','im',0.5,'Anterolateral thigh','2-8',false,'9-12 months',null),
('MMR - 1st dose','MMR1','live_attenuated','sc',0.5,'Left upper arm','2-8',false,'12 months',null),
('Hepatitis A - 1st dose','HEPA1','inactivated','im',0.5,'Anterolateral thigh','2-8',false,'12 months',null),
('HPV - 1st dose (girls)','HPV1','inactivated','im',0.5,'Upper arm','2-8',false,'9-14 years',null),
('HPV - 2nd dose (girls)','HPV2','inactivated','im',0.5,'Upper arm','2-8',false,'9-14 years + 6 months',null),
('Influenza (Annual)','FLU','inactivated','im',0.5,'Upper arm','2-8',false,'Annual from 6 months',null),
('COVID-19 Booster','COVID-B','mrna','im',0.5,'Upper arm','-15 to -25',false,'As per schedule',null);

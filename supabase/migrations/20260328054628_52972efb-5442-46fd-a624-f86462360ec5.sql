
-- ══════════════════════════════════════════════════
-- ONCOLOGY / DAYCARE CHEMOTHERAPY MODULE
-- ══════════════════════════════════════════════════

-- 1. Chemo Protocols library
CREATE TABLE IF NOT EXISTS chemo_protocols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  protocol_name text NOT NULL,
  protocol_code text NOT NULL,
  cancer_type text NOT NULL,
  total_cycles integer NOT NULL,
  cycle_duration_days integer NOT NULL,
  drugs jsonb NOT NULL DEFAULT '[]',
  reference text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(hospital_id, protocol_code)
);
ALTER TABLE chemo_protocols ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chemo_protocols_hospital" ON chemo_protocols FOR ALL USING (hospital_id = public.get_user_hospital_id());

-- 2. Oncology patients
CREATE TABLE IF NOT EXISTS oncology_patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  patient_id uuid REFERENCES patients(id) NOT NULL,
  primary_diagnosis text NOT NULL,
  icd_code text,
  stage text,
  protocol_id uuid REFERENCES chemo_protocols(id),
  current_cycle integer DEFAULT 1,
  total_cycles_planned integer,
  height_cm numeric(5,1),
  weight_kg numeric(5,1),
  bsa_m2 numeric(4,2),
  performance_status integer,
  treating_oncologist uuid REFERENCES users(id),
  is_active boolean DEFAULT true,
  registered_at timestamptz DEFAULT now(),
  UNIQUE(hospital_id, patient_id)
);
ALTER TABLE oncology_patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "oncology_patients_hospital" ON oncology_patients FOR ALL USING (hospital_id = public.get_user_hospital_id());

-- 3. Chemo orders with 5-step verification
CREATE TABLE IF NOT EXISTS chemo_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  patient_id uuid REFERENCES patients(id) NOT NULL,
  oncology_patient_id uuid REFERENCES oncology_patients(id) NOT NULL,
  protocol_id uuid REFERENCES chemo_protocols(id) NOT NULL,
  cycle_number integer NOT NULL,
  day_of_cycle integer NOT NULL DEFAULT 1,
  order_date date NOT NULL DEFAULT current_date,
  scheduled_date date NOT NULL,
  ordered_by uuid REFERENCES users(id) NOT NULL,
  bsa_used numeric(4,2) NOT NULL,
  weight_at_order numeric(5,1) NOT NULL,
  anc numeric(6,2),
  platelets integer,
  creatinine numeric(5,2),
  bilirubin numeric(5,2),
  lab_date date,
  v1_protocol_confirmed boolean DEFAULT false,
  v2_dose_correct boolean DEFAULT false,
  v3_allergies_checked boolean DEFAULT false,
  v4_labs_reviewed boolean DEFAULT false,
  v5_pharmacist_signoff boolean DEFAULT false,
  v1_by uuid REFERENCES users(id),
  v2_by uuid REFERENCES users(id),
  v3_by uuid REFERENCES users(id),
  v4_by uuid REFERENCES users(id),
  v5_by uuid REFERENCES users(id),
  v1_at timestamptz,
  v2_at timestamptz,
  v3_at timestamptz,
  v4_at timestamptz,
  v5_at timestamptz,
  dispensing_allowed boolean DEFAULT false,
  status text DEFAULT 'pending_verification',
  hold_reason text,
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE chemo_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chemo_orders_hospital" ON chemo_orders FOR ALL USING (hospital_id = public.get_user_hospital_id());

CREATE OR REPLACE FUNCTION public.validate_chemo_order_status()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status NOT IN ('pending_verification','verified','dispensing','administered','completed','held','cancelled') THEN
    RAISE EXCEPTION 'Invalid chemo_orders status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_chemo_order_status
  BEFORE INSERT OR UPDATE ON chemo_orders
  FOR EACH ROW EXECUTE FUNCTION validate_chemo_order_status();

-- 4. Chemo order drugs
CREATE TABLE IF NOT EXISTS chemo_order_drugs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  order_id uuid REFERENCES chemo_orders(id) NOT NULL,
  drug_name text NOT NULL,
  planned_dose_mg_m2 numeric(8,2),
  planned_dose_mg numeric(8,2) NOT NULL,
  route text NOT NULL,
  infusion_time_min integer,
  diluent text,
  administered_dose_mg numeric(8,2),
  administered_at timestamptz,
  administered_by uuid REFERENCES users(id)
);
ALTER TABLE chemo_order_drugs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chemo_order_drugs_hospital" ON chemo_order_drugs FOR ALL USING (hospital_id = public.get_user_hospital_id());

-- 5. Daycare chairs
CREATE TABLE IF NOT EXISTS daycare_chairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  chair_name text NOT NULL,
  chair_type text DEFAULT 'recliner',
  status text DEFAULT 'available',
  current_patient uuid REFERENCES patients(id),
  occupied_since timestamptz,
  estimated_end timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE daycare_chairs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "daycare_chairs_hospital" ON daycare_chairs FOR ALL USING (hospital_id = public.get_user_hospital_id());

CREATE OR REPLACE FUNCTION public.validate_daycare_chair()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.chair_type NOT IN ('recliner','bed','isolation') THEN
    RAISE EXCEPTION 'Invalid chair_type: %', NEW.chair_type;
  END IF;
  IF NEW.status NOT IN ('available','occupied','cleaning','maintenance') THEN
    RAISE EXCEPTION 'Invalid chair status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_daycare_chair
  BEFORE INSERT OR UPDATE ON daycare_chairs
  FOR EACH ROW EXECUTE FUNCTION validate_daycare_chair();

-- 6. Toxicity events
CREATE TABLE IF NOT EXISTS toxicity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  patient_id uuid REFERENCES patients(id) NOT NULL,
  order_id uuid REFERENCES chemo_orders(id) NOT NULL,
  cycle_number integer NOT NULL,
  toxicity_type text NOT NULL,
  ctcae_grade integer NOT NULL,
  onset_date date NOT NULL,
  description text,
  dose_modified boolean DEFAULT false,
  dose_modification_type text,
  hospitalised boolean DEFAULT false,
  resolved boolean DEFAULT false,
  resolved_date date,
  reported_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE toxicity_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "toxicity_events_hospital" ON toxicity_events FOR ALL USING (hospital_id = public.get_user_hospital_id());

CREATE OR REPLACE FUNCTION public.validate_ctcae_grade()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.ctcae_grade < 1 OR NEW.ctcae_grade > 5 THEN
    RAISE EXCEPTION 'ctcae_grade must be between 1 and 5';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_ctcae_grade
  BEFORE INSERT OR UPDATE ON toxicity_events
  FOR EACH ROW EXECUTE FUNCTION validate_ctcae_grade();

-- 7. Vial wastage
CREATE TABLE IF NOT EXISTS vial_wastage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  order_id uuid REFERENCES chemo_orders(id) NOT NULL,
  drug_name text NOT NULL,
  batch_number text,
  ordered_dose_mg numeric(8,2) NOT NULL,
  administered_dose_mg numeric(8,2) NOT NULL,
  wasted_dose_mg numeric(8,2) NOT NULL,
  cost_per_mg numeric(10,2),
  waste_cost numeric(10,2),
  reason text DEFAULT 'single_dose_vial_remainder',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE vial_wastage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vial_wastage_hospital" ON vial_wastage FOR ALL USING (hospital_id = public.get_user_hospital_id());

-- Seed chemo protocols
INSERT INTO chemo_protocols (hospital_id, protocol_name, protocol_code, cancer_type, total_cycles, cycle_duration_days, drugs, reference)
SELECT h.id, p.name, p.code || '-' || LEFT(h.id::text, 8), p.cancer, p.cycles, p.days, p.drugs::jsonb, p.ref
FROM hospitals h
CROSS JOIN (VALUES
  ('AC', 'AC', 'Breast Ca (Adjuvant)', 4, 21,
   '[{"drug_name":"Doxorubicin","dose_mg_m2":60,"route":"IV","day_of_cycle":1,"infusion_time_min":15},{"drug_name":"Cyclophosphamide","dose_mg_m2":600,"route":"IV","day_of_cycle":1,"infusion_time_min":60}]',
   'NCRP 2022'),
  ('FOLFOX-6', 'FOLFOX', 'Colorectal Ca', 12, 14,
   '[{"drug_name":"Oxaliplatin","dose_mg_m2":85,"route":"IV","day_of_cycle":1,"infusion_time_min":120},{"drug_name":"Leucovorin","dose_mg_m2":400,"route":"IV","day_of_cycle":1,"infusion_time_min":120},{"drug_name":"5-Fluorouracil","dose_mg_m2":400,"route":"IV bolus","day_of_cycle":1,"infusion_time_min":5},{"drug_name":"5-Fluorouracil","dose_mg_m2":2400,"route":"IV infusion","day_of_cycle":1,"infusion_time_min":2880}]',
   'NCRP 2022'),
  ('CHOP', 'CHOP', 'NHL (Aggressive)', 6, 21,
   '[{"drug_name":"Cyclophosphamide","dose_mg_m2":750,"route":"IV","day_of_cycle":1,"infusion_time_min":60},{"drug_name":"Doxorubicin","dose_mg_m2":50,"route":"IV","day_of_cycle":1,"infusion_time_min":15},{"drug_name":"Vincristine","dose_mg_m2":1.4,"route":"IV","day_of_cycle":1,"infusion_time_min":10},{"drug_name":"Prednisolone","dose_mg_m2":100,"route":"Oral","day_of_cycle":1,"infusion_time_min":0}]',
   'WHO 2023'),
  ('Gemcitabine-Cisplatin', 'GC', 'NSCLC / Bladder Ca', 6, 21,
   '[{"drug_name":"Gemcitabine","dose_mg_m2":1250,"route":"IV","day_of_cycle":1,"infusion_time_min":30},{"drug_name":"Cisplatin","dose_mg_m2":75,"route":"IV","day_of_cycle":1,"infusion_time_min":180}]',
   'NCRP 2022'),
  ('Carboplatin-Paclitaxel', 'CP', 'Ovarian Ca / NSCLC', 6, 21,
   '[{"drug_name":"Carboplatin","dose_mg_m2":0,"route":"IV","day_of_cycle":1,"infusion_time_min":60},{"drug_name":"Paclitaxel","dose_mg_m2":175,"route":"IV","day_of_cycle":1,"infusion_time_min":180}]',
   'NCRP 2022')
) AS p(name, code, cancer, cycles, days, drugs, ref)
WHERE NOT EXISTS (SELECT 1 FROM chemo_protocols cp WHERE cp.hospital_id = h.id);

-- Seed daycare chairs
INSERT INTO daycare_chairs (hospital_id, chair_name, chair_type)
SELECT h.id, c.name, c.type
FROM hospitals h
CROSS JOIN (VALUES
  ('Chair 1','recliner'),('Chair 2','recliner'),('Chair 3','recliner'),
  ('Chair 4','recliner'),('Chair 5','recliner'),('Bed A','bed'),
  ('Isolation Chair','isolation')
) AS c(name, type)
WHERE NOT EXISTS (SELECT 1 FROM daycare_chairs dc WHERE dc.hospital_id = h.id);

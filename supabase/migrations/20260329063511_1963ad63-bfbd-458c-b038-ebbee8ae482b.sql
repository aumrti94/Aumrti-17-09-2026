
-- Table: govt_schemes
CREATE TABLE govt_schemes (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) not null,
  scheme_name text not null,
  scheme_code text not null,
  scheme_type text not null,
  facility_id text,
  facility_code text,
  state text,
  is_active boolean default true,
  config jsonb default '{}',
  created_at timestamptz default now()
);

-- Table: pmjay_packages
CREATE TABLE pmjay_packages (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) not null,
  package_code text not null,
  package_name text not null,
  specialty text not null,
  procedure_group text,
  rate_inr numeric(10,2) not null,
  includes text[],
  pre_auth_required boolean default true,
  max_days integer,
  scheme_id uuid references govt_schemes(id),
  is_active boolean default true,
  created_at timestamptz default now(),
  UNIQUE(hospital_id, package_code)
);

-- Table: scheme_beneficiaries
CREATE TABLE scheme_beneficiaries (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) not null,
  patient_id uuid references patients(id) not null,
  scheme_id uuid references govt_schemes(id) not null,
  beneficiary_id text not null,
  card_number text,
  family_id text,
  beneficiary_name text,
  verified_at timestamptz,
  verification_status text default 'pending',
  expiry_date date,
  created_at timestamptz default now()
);

-- Table: pre_auth_requests
CREATE TABLE pre_auth_requests (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) not null,
  patient_id uuid references patients(id) not null,
  admission_id uuid references admissions(id),
  scheme_id uuid references govt_schemes(id) not null,
  package_id uuid references pmjay_packages(id),
  beneficiary_id uuid references scheme_beneficiaries(id) not null,
  package_code text not null,
  package_name text not null,
  requested_amount numeric(10,2) not null,
  approved_amount numeric(10,2),
  clinical_summary text,
  justification text,
  ai_approval_score integer,
  submitted_at timestamptz,
  submission_method text default 'manual',
  portal_claim_id text,
  auth_number text,
  status text default 'draft',
  rejection_reason text,
  rejection_code text,
  response_at timestamptz,
  followup_count integer default 0,
  last_followup_at timestamptz,
  created_at timestamptz default now()
);

-- Table: pmjay_claims
CREATE TABLE pmjay_claims (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) not null,
  patient_id uuid references patients(id) not null,
  admission_id uuid references admissions(id) not null,
  pre_auth_id uuid references pre_auth_requests(id),
  bill_id uuid references bills(id),
  scheme_id uuid references govt_schemes(id) not null,
  claim_number text unique,
  package_code text not null,
  package_name text not null,
  claimed_amount numeric(10,2) not null,
  approved_amount numeric(10,2),
  settled_amount numeric(10,2),
  status text default 'draft',
  denial_reason text,
  denial_code text,
  is_resubmitted boolean default false,
  appeal_letter text,
  appeal_submitted_at timestamptz,
  submitted_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz default now()
);

-- Table: denial_logs
CREATE TABLE denial_logs (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references hospitals(id) not null,
  claim_id uuid references pmjay_claims(id) not null,
  denial_code text,
  denial_reason text not null,
  category text,
  recovery_action text,
  recovered_amount numeric(10,2),
  resolved boolean default false,
  created_at timestamptz default now()
);

-- Validation triggers
CREATE OR REPLACE FUNCTION validate_govt_scheme_type() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.scheme_type NOT IN ('central_govt','state_scheme','cghs','echs','esi','other') THEN
    RAISE EXCEPTION 'Invalid scheme_type: %', NEW.scheme_type;
  END IF;
  RETURN NEW;
END;$$;
CREATE TRIGGER trg_validate_govt_scheme BEFORE INSERT OR UPDATE ON govt_schemes FOR EACH ROW EXECUTE FUNCTION validate_govt_scheme_type();

CREATE OR REPLACE FUNCTION validate_beneficiary_status() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.verification_status NOT IN ('pending','verified','failed','expired') THEN
    RAISE EXCEPTION 'Invalid verification_status: %', NEW.verification_status;
  END IF;
  RETURN NEW;
END;$$;
CREATE TRIGGER trg_validate_beneficiary BEFORE INSERT OR UPDATE ON scheme_beneficiaries FOR EACH ROW EXECUTE FUNCTION validate_beneficiary_status();

CREATE OR REPLACE FUNCTION validate_pre_auth_request() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.submission_method NOT IN ('manual','portal','hcx_api','email') THEN
    RAISE EXCEPTION 'Invalid submission_method: %', NEW.submission_method;
  END IF;
  IF NEW.status NOT IN ('draft','submitted','under_review','approved','partially_approved','rejected','expired','cancelled') THEN
    RAISE EXCEPTION 'Invalid pre_auth status: %', NEW.status;
  END IF;
  RETURN NEW;
END;$$;
CREATE TRIGGER trg_validate_pre_auth BEFORE INSERT OR UPDATE ON pre_auth_requests FOR EACH ROW EXECUTE FUNCTION validate_pre_auth_request();

CREATE OR REPLACE FUNCTION validate_pmjay_claim() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status NOT IN ('draft','submitted','under_review','approved','partially_approved','rejected','settled','appealed') THEN
    RAISE EXCEPTION 'Invalid claim status: %', NEW.status;
  END IF;
  RETURN NEW;
END;$$;
CREATE TRIGGER trg_validate_pmjay_claim BEFORE INSERT OR UPDATE ON pmjay_claims FOR EACH ROW EXECUTE FUNCTION validate_pmjay_claim();

CREATE OR REPLACE FUNCTION validate_denial_category() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.category IS NOT NULL AND NEW.category NOT IN ('documentation_missing','clinical_not_justified','package_mismatch','duplicate_claim','pre_auth_expired','technical_error','other') THEN
    RAISE EXCEPTION 'Invalid denial category: %', NEW.category;
  END IF;
  RETURN NEW;
END;$$;
CREATE TRIGGER trg_validate_denial BEFORE INSERT OR UPDATE ON denial_logs FOR EACH ROW EXECUTE FUNCTION validate_denial_category();

-- RLS policies
ALTER TABLE govt_schemes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmjay_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheme_beneficiaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE pre_auth_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmjay_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE denial_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital isolation" ON govt_schemes FOR ALL USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));
CREATE POLICY "Hospital isolation" ON pmjay_packages FOR ALL USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));
CREATE POLICY "Hospital isolation" ON scheme_beneficiaries FOR ALL USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));
CREATE POLICY "Hospital isolation" ON pre_auth_requests FOR ALL USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));
CREATE POLICY "Hospital isolation" ON pmjay_claims FOR ALL USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));
CREATE POLICY "Hospital isolation" ON denial_logs FOR ALL USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));

-- Indexes
CREATE INDEX idx_pmjay_packages_hospital ON pmjay_packages(hospital_id);
CREATE INDEX idx_scheme_beneficiaries_patient ON scheme_beneficiaries(patient_id);
CREATE INDEX idx_pre_auth_requests_status ON pre_auth_requests(hospital_id, status);
CREATE INDEX idx_pmjay_claims_status ON pmjay_claims(hospital_id, status);
CREATE INDEX idx_denial_logs_claim ON denial_logs(claim_id);

-- Seed 50 PMJAY packages
INSERT INTO pmjay_packages (hospital_id, package_code, package_name, specialty, procedure_group, rate_inr, pre_auth_required, is_active)
SELECT h.id, p.code, p.name, p.specialty, p.grp, p.rate, true, true
FROM hospitals h
CROSS JOIN (VALUES
  ('HBP_CARD_02','Coronary Artery Bypass Grafting (CABG)','Cardiothoracic Surgery','Heart Surgery',95000.00),
  ('HBP_CARD_03','Coronary Angioplasty with Stenting','Cardiology','Heart',55000.00),
  ('HBP_CARD_04','Coronary Angiography','Cardiology','Diagnostics',12000.00),
  ('HBP_CARD_05','Pacemaker Implantation (Single Chamber)','Cardiology','Heart',55000.00),
  ('HBP_NURO_01','Neurosurgery - Craniotomy','Neurosurgery','Brain Surgery',80000.00),
  ('HBP_NURO_03','Spinal Surgery - Laminectomy','Neurosurgery','Spine',45000.00),
  ('HBP_ONCO_01','Mastectomy (Radical)','Surgical Oncology','Breast Cancer',25000.00),
  ('HBP_ONCO_05','Chemotherapy Session (Per Cycle)','Medical Oncology','Cancer',7500.00),
  ('HBP_ONCO_06','Radiation Therapy (Per Session)','Radiation Oncology','Cancer',3500.00),
  ('HBP_ORTH_01','Total Knee Replacement (Unilateral)','Orthopaedics','Joint Replacement',80000.00),
  ('HBP_ORTH_02','Total Hip Replacement (Unilateral)','Orthopaedics','Joint Replacement',80000.00),
  ('HBP_ORTH_05','Fracture Treatment - Femur with Internal Fixation','Orthopaedics','Trauma',25000.00),
  ('HBP_ORTH_08','Arthroscopy - Knee','Orthopaedics','Knee',18000.00),
  ('HBP_OBGY_01','Normal Delivery','Obstetrics','Maternity',9000.00),
  ('HBP_OBGY_02','Caesarean Section','Obstetrics','Maternity',9000.00),
  ('HBP_OBGY_03','Hysterectomy (Abdominal)','Gynaecology','Uterus',25000.00),
  ('HBP_OBGY_04','Laparoscopic Hysterectomy','Gynaecology','Uterus',30000.00),
  ('HBP_OBGY_06','Ectopic Pregnancy - Surgery','Gynaecology','Emergency',12000.00),
  ('HBP_GAST_01','Laparoscopic Cholecystectomy','General Surgery','Gallbladder',18000.00),
  ('HBP_GAST_02','Open Cholecystectomy','General Surgery','Gallbladder',15000.00),
  ('HBP_GAST_03','Appendicectomy (Laparoscopic)','General Surgery','Appendix',12000.00),
  ('HBP_GAST_04','Appendicectomy (Open)','General Surgery','Appendix',9000.00),
  ('HBP_GAST_06','Hernia Repair (Inguinal - Mesh)','General Surgery','Hernia',12000.00),
  ('HBP_GAST_07','Hernia Repair (Open - Mesh)','General Surgery','Hernia',9000.00),
  ('HBP_GAST_08','Liver Resection','Hepatobiliary Surgery','Liver',65000.00),
  ('HBP_RENAL_01','Kidney Transplantation','Nephrology/Transplant','Kidney',250000.00),
  ('HBP_RENAL_02','Haemodialysis Session','Nephrology','Dialysis',1500.00),
  ('HBP_RENAL_03','Peritoneal Dialysis (Per Month)','Nephrology','Dialysis',9000.00),
  ('HBP_RENAL_04','Urinary Calculus - PCNL','Urology','Kidney Stone',20000.00),
  ('HBP_RENAL_05','Urinary Calculus - ESWL','Urology','Kidney Stone',8000.00),
  ('HBP_RENAL_06','Prostatectomy (TURP)','Urology','Prostate',18000.00),
  ('HBP_OPTH_01','Cataract Surgery with IOL (Phaco)','Ophthalmology','Eye',8000.00),
  ('HBP_OPTH_02','Cataract Surgery with IOL (SICS)','Ophthalmology','Eye',6000.00),
  ('HBP_OPTH_03','Glaucoma Surgery (Trabeculectomy)','Ophthalmology','Eye',12000.00),
  ('HBP_OPTH_04','Retinal Detachment Surgery','Ophthalmology','Eye',20000.00),
  ('HBP_ENT_01','Tonsillectomy','ENT','Throat',8000.00),
  ('HBP_ENT_02','Myringoplasty','ENT','Ear',12000.00),
  ('HBP_ENT_03','Functional Endoscopic Sinus Surgery','ENT','Nose',15000.00),
  ('HBP_PULM_01','Pneumonia - Medical Management (5-7 days)','Pulmonology','Respiratory',7500.00),
  ('HBP_PULM_02','COPD Exacerbation - Medical Management','Pulmonology','Respiratory',5500.00),
  ('HBP_PULM_04','Pleural Effusion - Thoracocentesis','Pulmonology','Respiratory',6000.00),
  ('HBP_NEURO_01','Stroke - Medical Management (Ischaemic)','Neurology','Brain',12000.00),
  ('HBP_NEURO_02','Meningitis/Encephalitis - Medical','Neurology','Brain',12000.00),
  ('HBP_PEDS_01','Neonatal Care - Low Birth Weight','Paediatrics','Newborn',9000.00),
  ('HBP_PEDS_02','Neonatal Care - NICU Level II','Paediatrics','NICU',15000.00),
  ('HBP_PEDS_03','Neonatal Jaundice - Phototherapy','Paediatrics','Newborn',4500.00),
  ('HBP_ENDO_01','Gastrointestinal Endoscopy (Diagnostic)','Gastroenterology','GI',3500.00),
  ('HBP_ENDO_02','Colonoscopy (Diagnostic)','Gastroenterology','GI',4500.00),
  ('HBP_ENDO_03','ERCP - Diagnostic','Gastroenterology','GI',12000.00),
  ('HBP_TRNS_01','Blood Transfusion - Packed RBC (Per Unit)','Haematology','Blood',1500.00)
) AS p(code, name, specialty, grp, rate)
WHERE NOT EXISTS (
  SELECT 1 FROM pmjay_packages pp WHERE pp.hospital_id = h.id AND pp.package_code = p.code
);


-- MRD Module Tables (M17)

CREATE TABLE public.medical_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  visit_id uuid,
  record_type text NOT NULL,
  physical_location text,
  barcode text UNIQUE,
  digital_ref text,
  status text DEFAULT 'active',
  archived_at date,
  destroy_after date,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.icd_codings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  visit_id uuid NOT NULL,
  visit_type text,
  primary_icd_code text,
  primary_icd_desc text,
  secondary_codes jsonb DEFAULT '[]',
  pcs_code text,
  ai_suggestion text,
  ai_confidence numeric(4,2),
  coded_by uuid REFERENCES public.users(id),
  validated_by uuid REFERENCES public.users(id),
  coded_at timestamptz,
  validated_at timestamptz,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.record_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  record_id uuid REFERENCES public.medical_records(id),
  requester_type text NOT NULL,
  requester_name text NOT NULL,
  requester_contact text,
  purpose text NOT NULL,
  documents_requested text[],
  status text DEFAULT 'pending',
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  fulfilled_at timestamptz,
  rejection_reason text,
  documents_provided text[],
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.death_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  admission_id uuid REFERENCES public.admissions(id),
  time_of_death timestamptz NOT NULL,
  cause_1a text NOT NULL,
  cause_1b text,
  cause_1c text,
  cause_2 text,
  icd_code text,
  manner_of_death text DEFAULT 'natural',
  is_mlc boolean DEFAULT false,
  certified_by uuid REFERENCES public.users(id) NOT NULL,
  mccd_form_number text UNIQUE,
  issued_at timestamptz,
  civil_reg_submitted boolean DEFAULT false,
  digital_signed boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.retention_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  record_type text NOT NULL,
  record_date date NOT NULL,
  retain_until date NOT NULL,
  retention_basis text NOT NULL,
  destruction_authorized_by uuid REFERENCES public.users(id),
  destruction_date date,
  is_destroyed boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.coding_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  coding_id uuid REFERENCES public.icd_codings(id) NOT NULL,
  original_code text NOT NULL,
  corrected_code text NOT NULL,
  correction_reason text,
  revenue_impact numeric(10,2),
  audited_by uuid REFERENCES public.users(id) NOT NULL,
  audit_date date DEFAULT current_date
);

-- Validation triggers

CREATE OR REPLACE FUNCTION public.validate_medical_records()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.record_type NOT IN ('ipd','opd','emergency','day_care') THEN
    RAISE EXCEPTION 'Invalid record_type: %', NEW.record_type;
  END IF;
  IF NEW.status NOT IN ('active','archived','destroyed','transferred') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;$$;

CREATE TRIGGER trg_validate_medical_records
  BEFORE INSERT OR UPDATE ON public.medical_records
  FOR EACH ROW EXECUTE FUNCTION public.validate_medical_records();

CREATE OR REPLACE FUNCTION public.validate_icd_codings()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.visit_type IS NOT NULL AND NEW.visit_type NOT IN ('opd','ipd','emergency') THEN
    RAISE EXCEPTION 'Invalid visit_type: %', NEW.visit_type;
  END IF;
  IF NEW.status NOT IN ('pending','coded','validated','billed') THEN
    RAISE EXCEPTION 'Invalid icd_codings status: %', NEW.status;
  END IF;
  RETURN NEW;
END;$$;

CREATE TRIGGER trg_validate_icd_codings
  BEFORE INSERT OR UPDATE ON public.icd_codings
  FOR EACH ROW EXECUTE FUNCTION public.validate_icd_codings();

CREATE OR REPLACE FUNCTION public.validate_record_requests()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.requester_type NOT IN ('patient','legal_guardian','lawyer','insurance','police','court','government','treating_doctor') THEN
    RAISE EXCEPTION 'Invalid requester_type: %', NEW.requester_type;
  END IF;
  IF NEW.status NOT IN ('pending','approved','rejected','fulfilled','partial') THEN
    RAISE EXCEPTION 'Invalid record_requests status: %', NEW.status;
  END IF;
  RETURN NEW;
END;$$;

CREATE TRIGGER trg_validate_record_requests
  BEFORE INSERT OR UPDATE ON public.record_requests
  FOR EACH ROW EXECUTE FUNCTION public.validate_record_requests();

CREATE OR REPLACE FUNCTION public.validate_death_certificates()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.manner_of_death NOT IN ('natural','accident','suicide','homicide','undetermined') THEN
    RAISE EXCEPTION 'Invalid manner_of_death: %', NEW.manner_of_death;
  END IF;
  RETURN NEW;
END;$$;

CREATE TRIGGER trg_validate_death_certificates
  BEFORE INSERT OR UPDATE ON public.death_certificates
  FOR EACH ROW EXECUTE FUNCTION public.validate_death_certificates();

-- RLS policies

ALTER TABLE public.medical_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.icd_codings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.record_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.death_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coding_audits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation" ON public.medical_records FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id()) WITH CHECK (hospital_id = public.get_user_hospital_id());
CREATE POLICY "hospital_isolation" ON public.icd_codings FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id()) WITH CHECK (hospital_id = public.get_user_hospital_id());
CREATE POLICY "hospital_isolation" ON public.record_requests FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id()) WITH CHECK (hospital_id = public.get_user_hospital_id());
CREATE POLICY "hospital_isolation" ON public.death_certificates FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id()) WITH CHECK (hospital_id = public.get_user_hospital_id());
CREATE POLICY "hospital_isolation" ON public.retention_schedules FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id()) WITH CHECK (hospital_id = public.get_user_hospital_id());
CREATE POLICY "hospital_isolation" ON public.coding_audits FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id()) WITH CHECK (hospital_id = public.get_user_hospital_id());

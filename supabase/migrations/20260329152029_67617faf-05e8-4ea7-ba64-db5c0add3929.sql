
-- Patient Relations / PRO Module (M20) Tables

CREATE TABLE public.grievances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id),
  patient_name text NOT NULL,
  patient_phone text,
  category text NOT NULL,
  severity text DEFAULT 'medium',
  description text NOT NULL,
  channel text DEFAULT 'counter',
  assigned_to uuid REFERENCES public.users(id),
  department_id uuid REFERENCES public.departments(id),
  status text DEFAULT 'open',
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolution text,
  root_cause text,
  capa_raised boolean DEFAULT false,
  patient_satisfied boolean,
  tat_hours numeric(6,1),
  sla_breached boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.patient_rights_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  admission_id uuid REFERENCES public.admissions(id),
  acknowledged_at timestamptz DEFAULT now(),
  language text DEFAULT 'english',
  rights_version text DEFAULT '2024',
  digital_signature text,
  acknowledged_by_name text,
  witness_name text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.visitor_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  visitor_name text NOT NULL,
  visitor_phone text,
  relation text NOT NULL,
  purpose text,
  issued_at timestamptz DEFAULT now(),
  valid_until timestamptz NOT NULL,
  pass_number text UNIQUE NOT NULL,
  scanned_entry_at timestamptz,
  scanned_exit_at timestamptz,
  issued_by uuid REFERENCES public.users(id),
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.feedback_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id),
  visit_id uuid,
  channel text DEFAULT 'portal',
  overall_csat integer,
  nps_score integer,
  department_ratings jsonb DEFAULT '{}',
  comment text,
  sentiment text,
  auto_escalated boolean DEFAULT false,
  escalated_to uuid REFERENCES public.users(id),
  responded boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_grievances_hospital ON public.grievances(hospital_id);
CREATE INDEX idx_grievances_status ON public.grievances(hospital_id, status);
CREATE INDEX idx_grievances_patient ON public.grievances(patient_id);
CREATE INDEX idx_patient_rights_hospital ON public.patient_rights_acknowledgements(hospital_id);
CREATE INDEX idx_patient_rights_patient ON public.patient_rights_acknowledgements(patient_id);
CREATE INDEX idx_visitor_passes_hospital ON public.visitor_passes(hospital_id);
CREATE INDEX idx_visitor_passes_patient ON public.visitor_passes(patient_id);
CREATE INDEX idx_feedback_records_hospital ON public.feedback_records(hospital_id);

-- Validation Triggers
CREATE OR REPLACE FUNCTION public.validate_grievance()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.category NOT IN ('clinical_care','billing','staff_behaviour','facility_cleanliness','food','waiting_time','communication','privacy','other') THEN
    RAISE EXCEPTION 'Invalid category: %', NEW.category;
  END IF;
  IF NEW.severity NOT IN ('low','medium','high','critical') THEN
    RAISE EXCEPTION 'Invalid severity: %', NEW.severity;
  END IF;
  IF NEW.channel NOT IN ('counter','portal','whatsapp','phone','email','written') THEN
    RAISE EXCEPTION 'Invalid channel: %', NEW.channel;
  END IF;
  IF NEW.status NOT IN ('open','acknowledged','in_progress','resolved','closed','escalated') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_validate_grievance BEFORE INSERT OR UPDATE ON public.grievances FOR EACH ROW EXECUTE FUNCTION public.validate_grievance();

CREATE OR REPLACE FUNCTION public.validate_visitor_pass()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status NOT IN ('active','expired','cancelled') THEN
    RAISE EXCEPTION 'Invalid visitor pass status: %', NEW.status;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_validate_visitor_pass BEFORE INSERT OR UPDATE ON public.visitor_passes FOR EACH ROW EXECUTE FUNCTION public.validate_visitor_pass();

CREATE OR REPLACE FUNCTION public.validate_feedback_record()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.channel NOT IN ('portal','whatsapp','kiosk','sms','manual') THEN
    RAISE EXCEPTION 'Invalid feedback channel: %', NEW.channel;
  END IF;
  IF NEW.overall_csat IS NOT NULL AND (NEW.overall_csat < 1 OR NEW.overall_csat > 5) THEN
    RAISE EXCEPTION 'overall_csat must be 1-5';
  END IF;
  IF NEW.nps_score IS NOT NULL AND (NEW.nps_score < 0 OR NEW.nps_score > 10) THEN
    RAISE EXCEPTION 'nps_score must be 0-10';
  END IF;
  IF NEW.sentiment IS NOT NULL AND NEW.sentiment NOT IN ('positive','neutral','negative') THEN
    RAISE EXCEPTION 'Invalid sentiment: %', NEW.sentiment;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_validate_feedback_record BEFORE INSERT OR UPDATE ON public.feedback_records FOR EACH ROW EXECUTE FUNCTION public.validate_feedback_record();

-- RLS
ALTER TABLE public.grievances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_rights_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitor_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital isolation" ON public.grievances FOR ALL USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "Hospital isolation" ON public.patient_rights_acknowledgements FOR ALL USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "Hospital isolation" ON public.visitor_passes FOR ALL USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "Hospital isolation" ON public.feedback_records FOR ALL USING (hospital_id = public.get_user_hospital_id());

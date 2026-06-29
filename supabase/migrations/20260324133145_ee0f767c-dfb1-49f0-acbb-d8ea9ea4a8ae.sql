
-- NABH Criteria table
CREATE TABLE public.nabh_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  chapter_code text NOT NULL,
  chapter_name text NOT NULL,
  criterion_number text NOT NULL,
  criterion_text text NOT NULL,
  objective_elements text[] DEFAULT '{}',
  compliance_status text DEFAULT 'not_assessed',
  compliance_score integer DEFAULT 0,
  evidence_notes text,
  last_assessed date,
  next_review date,
  auto_collected boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Validation trigger for compliance_status
CREATE OR REPLACE FUNCTION public.validate_nabh_compliance_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.compliance_status NOT IN ('compliant','partially_compliant','non_compliant','not_applicable','not_assessed') THEN
    RAISE EXCEPTION 'Invalid compliance_status: %', NEW.compliance_status;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_nabh_compliance_status
  BEFORE INSERT OR UPDATE ON public.nabh_criteria
  FOR EACH ROW EXECUTE FUNCTION public.validate_nabh_compliance_status();

ALTER TABLE public.nabh_criteria ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own hospital nabh_criteria" ON public.nabh_criteria FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital nabh_criteria" ON public.nabh_criteria FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

-- Quality Indicators table
CREATE TABLE public.quality_indicators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  indicator_name text NOT NULL,
  category text DEFAULT 'clinical',
  numerator numeric(12,4) DEFAULT 0,
  denominator numeric(12,4) DEFAULT 1,
  value numeric(8,4) DEFAULT 0,
  unit text DEFAULT '%',
  target numeric(8,4),
  benchmark numeric(8,4),
  period text DEFAULT 'monthly',
  period_start date DEFAULT date_trunc('month', current_date),
  data_source text,
  auto_calculated boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.validate_qi_category()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.category NOT IN ('clinical','operational','patient_safety','infection_control','financial','nabh') THEN
    RAISE EXCEPTION 'Invalid category: %', NEW.category;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_qi_category
  BEFORE INSERT OR UPDATE ON public.quality_indicators
  FOR EACH ROW EXECUTE FUNCTION public.validate_qi_category();

ALTER TABLE public.quality_indicators ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own hospital quality_indicators" ON public.quality_indicators FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital quality_indicators" ON public.quality_indicators FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

-- Audit Records table
CREATE TABLE public.audit_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  audit_title text NOT NULL,
  audit_type text DEFAULT 'internal',
  scheduled_date date NOT NULL,
  conducted_date date,
  auditor_name text,
  department_ids uuid[] DEFAULT '{}',
  chapters_covered text[] DEFAULT '{}',
  findings text,
  score_obtained numeric(5,2),
  score_maximum numeric(5,2),
  status text DEFAULT 'scheduled',
  report_url text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.validate_audit_type()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.audit_type NOT IN ('internal','external','nabh_surveillance','nabh_accreditation','peer','unannounced') THEN
    RAISE EXCEPTION 'Invalid audit_type: %', NEW.audit_type;
  END IF;
  IF NEW.status NOT IN ('scheduled','in_progress','completed','cancelled') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_audit_type
  BEFORE INSERT OR UPDATE ON public.audit_records
  FOR EACH ROW EXECUTE FUNCTION public.validate_audit_type();

ALTER TABLE public.audit_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own hospital audit_records" ON public.audit_records FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital audit_records" ON public.audit_records FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

-- Incident Reports table
CREATE TABLE public.incident_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  incident_number text UNIQUE NOT NULL,
  incident_date date NOT NULL,
  incident_time time,
  department_id uuid REFERENCES public.departments(id),
  incident_type text NOT NULL,
  severity text DEFAULT 'minor',
  description text NOT NULL,
  patient_id uuid REFERENCES public.patients(id),
  immediate_action text,
  reported_by uuid REFERENCES public.users(id) NOT NULL,
  capa_id uuid,
  status text DEFAULT 'open',
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.validate_incident()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.incident_type NOT IN ('fall','medication_error','near_miss','adverse_event','procedure_complication','equipment_failure','infection','complaint','other') THEN
    RAISE EXCEPTION 'Invalid incident_type: %', NEW.incident_type;
  END IF;
  IF NEW.severity NOT IN ('minor','moderate','major','sentinel') THEN
    RAISE EXCEPTION 'Invalid severity: %', NEW.severity;
  END IF;
  IF NEW.status NOT IN ('open','under_review','capa_raised','closed') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_incident
  BEFORE INSERT OR UPDATE ON public.incident_reports
  FOR EACH ROW EXECUTE FUNCTION public.validate_incident();

ALTER TABLE public.incident_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own hospital incident_reports" ON public.incident_reports FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital incident_reports" ON public.incident_reports FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

-- CAPA Records table
CREATE TABLE public.capa_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  capa_number text UNIQUE NOT NULL,
  trigger_type text NOT NULL,
  trigger_ref_id uuid,
  problem_statement text NOT NULL,
  why_1 text,
  why_2 text,
  why_3 text,
  why_4 text,
  why_5 text,
  root_cause text,
  corrective_action text,
  preventive_action text,
  responsible_person uuid REFERENCES public.users(id),
  due_date date,
  completed_date date,
  verification_by uuid REFERENCES public.users(id),
  verified_date date,
  effectiveness_check text,
  status text DEFAULT 'open',
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.validate_capa()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.trigger_type NOT IN ('incident','audit_finding','complaint','near_miss','nabh_gap','other') THEN
    RAISE EXCEPTION 'Invalid trigger_type: %', NEW.trigger_type;
  END IF;
  IF NEW.status NOT IN ('open','in_progress','completed','verified','closed') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_capa
  BEFORE INSERT OR UPDATE ON public.capa_records
  FOR EACH ROW EXECUTE FUNCTION public.validate_capa();

ALTER TABLE public.capa_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own hospital capa_records" ON public.capa_records FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital capa_records" ON public.capa_records FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

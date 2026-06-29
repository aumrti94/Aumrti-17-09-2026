
CREATE TABLE public.dental_charts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  encounter_id uuid,
  chart_date date NOT NULL DEFAULT current_date,
  chart_data jsonb NOT NULL DEFAULT '{}',
  soft_tissue_notes text,
  oral_hygiene text,
  calculus text,
  created_by uuid REFERENCES public.users(id) NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.periodontal_charts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  chart_date date NOT NULL DEFAULT current_date,
  perio_data jsonb NOT NULL DEFAULT '{}',
  plaque_index numeric(4,2),
  bleeding_index numeric(4,2),
  diagnosis text,
  created_by uuid REFERENCES public.users(id) NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.dental_treatment_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  chart_id uuid REFERENCES public.dental_charts(id),
  created_by uuid REFERENCES public.users(id) NOT NULL,
  plan_items jsonb NOT NULL DEFAULT '[]',
  total_cost numeric(10,2) DEFAULT 0,
  patient_consent boolean DEFAULT false,
  consent_date date,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.dental_lab_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  ordered_by uuid REFERENCES public.users(id) NOT NULL,
  lab_name text,
  work_type text NOT NULL,
  tooth_numbers text NOT NULL,
  shade text,
  material text,
  special_instructions text,
  order_date date NOT NULL DEFAULT current_date,
  expected_date date,
  received_date date,
  cost numeric(8,2),
  status text DEFAULT 'ordered',
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Validation triggers
CREATE OR REPLACE FUNCTION public.validate_dental_chart()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.oral_hygiene IS NOT NULL AND NEW.oral_hygiene NOT IN ('good','fair','poor') THEN
    RAISE EXCEPTION 'Invalid oral_hygiene: %', NEW.oral_hygiene;
  END IF;
  IF NEW.calculus IS NOT NULL AND NEW.calculus NOT IN ('none','mild','moderate','heavy') THEN
    RAISE EXCEPTION 'Invalid calculus: %', NEW.calculus;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_dental_chart
  BEFORE INSERT OR UPDATE ON public.dental_charts
  FOR EACH ROW EXECUTE FUNCTION public.validate_dental_chart();

CREATE OR REPLACE FUNCTION public.validate_periodontal_chart()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.diagnosis IS NOT NULL AND NEW.diagnosis NOT IN (
    'healthy','gingivitis','stage1_perio','stage2_perio',
    'stage3_perio','stage4_perio','peri_implantitis'
  ) THEN
    RAISE EXCEPTION 'Invalid diagnosis: %', NEW.diagnosis;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_periodontal_chart
  BEFORE INSERT OR UPDATE ON public.periodontal_charts
  FOR EACH ROW EXECUTE FUNCTION public.validate_periodontal_chart();

CREATE OR REPLACE FUNCTION public.validate_dental_treatment_plan()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status NOT IN ('active','partially_done','completed','abandoned') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_dental_treatment_plan
  BEFORE INSERT OR UPDATE ON public.dental_treatment_plans
  FOR EACH ROW EXECUTE FUNCTION public.validate_dental_treatment_plan();

CREATE OR REPLACE FUNCTION public.validate_dental_lab_order()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.work_type NOT IN (
    'crown','bridge','rpd','fpd','complete_denture',
    'orthodontic_appliance','night_guard','bleaching_tray',
    'implant_crown','inlay_onlay'
  ) THEN
    RAISE EXCEPTION 'Invalid work_type: %', NEW.work_type;
  END IF;
  IF NEW.status NOT IN (
    'ordered','in_lab','ready','delivered',
    'returned_for_correction','cancelled'
  ) THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_dental_lab_order
  BEFORE INSERT OR UPDATE ON public.dental_lab_orders
  FOR EACH ROW EXECUTE FUNCTION public.validate_dental_lab_order();

-- Indexes
CREATE INDEX idx_dental_charts_patient ON public.dental_charts(patient_id);
CREATE INDEX idx_dental_charts_hospital ON public.dental_charts(hospital_id);
CREATE INDEX idx_periodontal_charts_patient ON public.periodontal_charts(patient_id);
CREATE INDEX idx_dental_treatment_plans_patient ON public.dental_treatment_plans(patient_id);
CREATE INDEX idx_dental_lab_orders_patient ON public.dental_lab_orders(patient_id);
CREATE INDEX idx_dental_lab_orders_status ON public.dental_lab_orders(hospital_id, status);

-- RLS policies
CREATE POLICY "Hospital isolation" ON public.dental_charts
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Hospital isolation" ON public.periodontal_charts
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Hospital isolation" ON public.dental_treatment_plans
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Hospital isolation" ON public.dental_lab_orders
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());


-- Dietetics Module (M26) tables

CREATE TABLE public.nutritional_screenings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  admission_id uuid REFERENCES public.admissions(id) NOT NULL,
  screening_tool text NOT NULL,
  screened_by uuid REFERENCES public.users(id) NOT NULL,
  screened_at timestamptz DEFAULT now(),
  nrs_disease_severity integer,
  nrs_nutritional_status integer,
  nrs_age_adjustment integer,
  nrs_total_score integer,
  bmi numeric(5,2),
  weight_kg numeric(5,1),
  height_cm numeric(5,1),
  risk_level text NOT NULL,
  dietitian_referral boolean DEFAULT false,
  referral_at timestamptz,
  notes text
);

CREATE TABLE public.diet_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  admission_id uuid REFERENCES public.admissions(id) NOT NULL,
  ordered_by uuid REFERENCES public.users(id) NOT NULL,
  order_date date NOT NULL DEFAULT current_date,
  diet_type text NOT NULL,
  texture text DEFAULT 'normal',
  calories_target integer,
  protein_target numeric(5,1),
  fluid_restriction_ml integer,
  food_allergies text[] DEFAULT '{}',
  specific_instructions text,
  valid_from date NOT NULL DEFAULT current_date,
  valid_until date,
  status text DEFAULT 'active',
  ai_generated boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.meal_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  diet_order_id uuid REFERENCES public.diet_orders(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  admission_id uuid REFERENCES public.admissions(id) NOT NULL,
  meal_date date NOT NULL DEFAULT current_date,
  meal_type text NOT NULL,
  delivered_at timestamptz,
  consumed_percent integer,
  waste_reason text,
  delivered_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.diet_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  admission_id uuid REFERENCES public.admissions(id) NOT NULL,
  created_by uuid REFERENCES public.users(id) NOT NULL,
  plan_for_days integer DEFAULT 7,
  diagnosis text,
  plan_content text NOT NULL,
  ai_generated boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Validation triggers
CREATE OR REPLACE FUNCTION public.validate_nutritional_screening()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.screening_tool NOT IN ('nrs_2002','mna','must','pediatric_str') THEN
    RAISE EXCEPTION 'Invalid screening_tool: %', NEW.screening_tool;
  END IF;
  IF NEW.risk_level NOT IN ('low','moderate','high','very_high') THEN
    RAISE EXCEPTION 'Invalid risk_level: %', NEW.risk_level;
  END IF;
  IF NEW.nrs_disease_severity IS NOT NULL AND (NEW.nrs_disease_severity < 0 OR NEW.nrs_disease_severity > 3) THEN
    RAISE EXCEPTION 'nrs_disease_severity must be 0-3';
  END IF;
  IF NEW.nrs_nutritional_status IS NOT NULL AND (NEW.nrs_nutritional_status < 0 OR NEW.nrs_nutritional_status > 3) THEN
    RAISE EXCEPTION 'nrs_nutritional_status must be 0-3';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_nutritional_screening
  BEFORE INSERT OR UPDATE ON public.nutritional_screenings
  FOR EACH ROW EXECUTE FUNCTION public.validate_nutritional_screening();

CREATE OR REPLACE FUNCTION public.validate_diet_order()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.diet_type NOT IN ('normal','soft','semi_liquid','liquid','ngt_feed','npo','diabetic','renal','cardiac','low_sodium','high_protein','other') THEN
    RAISE EXCEPTION 'Invalid diet_type: %', NEW.diet_type;
  END IF;
  IF NEW.texture NOT IN ('normal','minced','pureed','liquid') THEN
    RAISE EXCEPTION 'Invalid texture: %', NEW.texture;
  END IF;
  IF NEW.status NOT IN ('active','modified','cancelled') THEN
    RAISE EXCEPTION 'Invalid diet_order status: %', NEW.status;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_diet_order
  BEFORE INSERT OR UPDATE ON public.diet_orders
  FOR EACH ROW EXECUTE FUNCTION public.validate_diet_order();

CREATE OR REPLACE FUNCTION public.validate_meal_delivery()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.meal_type NOT IN ('breakfast','mid_morning','lunch','evening','dinner','night') THEN
    RAISE EXCEPTION 'Invalid meal_type: %', NEW.meal_type;
  END IF;
  IF NEW.consumed_percent IS NOT NULL AND (NEW.consumed_percent < 0 OR NEW.consumed_percent > 100) THEN
    RAISE EXCEPTION 'consumed_percent must be 0-100';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_meal_delivery
  BEFORE INSERT OR UPDATE ON public.meal_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.validate_meal_delivery();

-- RLS policies
ALTER TABLE public.nutritional_screenings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diet_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diet_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital isolation" ON public.nutritional_screenings FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id()) WITH CHECK (hospital_id = public.get_user_hospital_id());
CREATE POLICY "Hospital isolation" ON public.diet_orders FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id()) WITH CHECK (hospital_id = public.get_user_hospital_id());
CREATE POLICY "Hospital isolation" ON public.meal_deliveries FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id()) WITH CHECK (hospital_id = public.get_user_hospital_id());
CREATE POLICY "Hospital isolation" ON public.diet_plans FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id()) WITH CHECK (hospital_id = public.get_user_hospital_id());

-- Indexes
CREATE INDEX idx_nutritional_screenings_hospital ON public.nutritional_screenings(hospital_id);
CREATE INDEX idx_nutritional_screenings_admission ON public.nutritional_screenings(admission_id);
CREATE INDEX idx_diet_orders_hospital ON public.diet_orders(hospital_id);
CREATE INDEX idx_diet_orders_admission ON public.diet_orders(admission_id);
CREATE INDEX idx_diet_orders_status ON public.diet_orders(status);
CREATE INDEX idx_meal_deliveries_hospital ON public.meal_deliveries(hospital_id);
CREATE INDEX idx_meal_deliveries_date ON public.meal_deliveries(meal_date);
CREATE INDEX idx_diet_plans_hospital ON public.diet_plans(hospital_id);
CREATE INDEX idx_diet_plans_admission ON public.diet_plans(admission_id);

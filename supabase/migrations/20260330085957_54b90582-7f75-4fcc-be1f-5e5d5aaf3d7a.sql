
-- =============================================
-- M34: Health Packages Module — Tables
-- =============================================

-- 1. health_packages
CREATE TABLE public.health_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  package_name text NOT NULL,
  package_code text NOT NULL,
  package_type text NOT NULL DEFAULT 'basic',
  description text,
  target_gender text DEFAULT 'both',
  min_age integer,
  max_age integer,
  price numeric(10,2) NOT NULL,
  validity_days integer DEFAULT 30,
  components jsonb NOT NULL DEFAULT '[]',
  total_components integer DEFAULT 0,
  estimated_hours numeric(4,1),
  includes_meal boolean DEFAULT false,
  is_active boolean DEFAULT true,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT health_packages_hospital_code_key UNIQUE (hospital_id, package_code)
);

-- 2. corporate_accounts
CREATE TABLE public.corporate_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  company_name text NOT NULL,
  contact_person text,
  contact_phone text,
  contact_email text,
  address text,
  gstin text,
  credit_days integer DEFAULT 30,
  negotiated_rate_percent numeric(4,1) DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 3. package_bookings
CREATE TABLE public.package_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  package_id uuid REFERENCES public.health_packages(id) NOT NULL,
  booking_date date NOT NULL DEFAULT current_date,
  scheduled_date date NOT NULL,
  scheduled_time time,
  bill_id uuid REFERENCES public.bills(id),
  corporate_account_id uuid REFERENCES public.corporate_accounts(id),
  employee_id text,
  components_done jsonb DEFAULT '{}',
  current_station text,
  status text DEFAULT 'booked',
  report_url text,
  completed_at timestamptz,
  coordinator uuid REFERENCES public.users(id),
  notes text,
  created_at timestamptz DEFAULT now()
);

-- =============================================
-- Validation triggers
-- =============================================

CREATE OR REPLACE FUNCTION public.validate_health_package()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.package_type NOT IN ('basic','essential','comprehensive','executive','senior_citizen','pre_marital','corporate','custom') THEN
    RAISE EXCEPTION 'Invalid package_type: %', NEW.package_type;
  END IF;
  IF NEW.target_gender NOT IN ('male','female','both') THEN
    RAISE EXCEPTION 'Invalid target_gender: %', NEW.target_gender;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_health_package
  BEFORE INSERT OR UPDATE ON public.health_packages
  FOR EACH ROW EXECUTE FUNCTION public.validate_health_package();

CREATE OR REPLACE FUNCTION public.validate_package_booking()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status NOT IN ('booked','checked_in','in_progress','awaiting_report','completed','cancelled') THEN
    RAISE EXCEPTION 'Invalid booking status: %', NEW.status;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_package_booking
  BEFORE INSERT OR UPDATE ON public.package_bookings
  FOR EACH ROW EXECUTE FUNCTION public.validate_package_booking();

-- =============================================
-- Indexes
-- =============================================

CREATE INDEX idx_health_packages_hospital ON public.health_packages(hospital_id);
CREATE INDEX idx_package_bookings_hospital ON public.package_bookings(hospital_id);
CREATE INDEX idx_package_bookings_patient ON public.package_bookings(patient_id);
CREATE INDEX idx_package_bookings_scheduled ON public.package_bookings(hospital_id, scheduled_date);
CREATE INDEX idx_package_bookings_status ON public.package_bookings(hospital_id, status);
CREATE INDEX idx_corporate_accounts_hospital ON public.corporate_accounts(hospital_id);

-- =============================================
-- RLS Policies
-- =============================================

ALTER TABLE public.health_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital isolation" ON public.health_packages
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Hospital isolation" ON public.package_bookings
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Hospital isolation" ON public.corporate_accounts
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- =============================================
-- Seed 5 standard packages
-- =============================================

INSERT INTO public.health_packages
  (hospital_id, package_name, package_code, package_type,
   description, price, estimated_hours, is_active, display_order)
SELECT h.id, p.name, p.code, p.type, p.descr, p.price, p.hrs, true, p.ord
FROM public.hospitals h
CROSS JOIN (VALUES
  ('Basic Health Check', 'PKG-BASIC', 'basic',
   'Essential tests for annual preventive health screening',
   999.00, 2.0, 1),
  ('Essential Health Check', 'PKG-ESSENTIAL', 'essential',
   'Complete blood profile with ECG and doctor consultation',
   1999.00, 3.0, 2),
  ('Comprehensive Health Check', 'PKG-COMP', 'comprehensive',
   'Full body checkup with all major organ function tests',
   3999.00, 4.5, 3),
  ('Executive Health Check', 'PKG-EXEC', 'executive',
   'Premium checkup with specialist consultations and advanced tests',
   7999.00, 6.0, 4),
  ('Senior Citizen Package', 'PKG-SENIOR', 'senior_citizen',
   'Specialised checkup for ages 60+ with bone density and cardiac profile',
   4999.00, 5.0, 5)
) AS p(name, code, type, descr, price, hrs, ord)
WHERE NOT EXISTS (
  SELECT 1 FROM public.health_packages hp WHERE hp.hospital_id = h.id
);

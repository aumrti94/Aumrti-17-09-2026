-- ══════════════════════════════════════════════════
-- HMIS Reports & IDSP Alerts tables
-- ══════════════════════════════════════════════════

CREATE TABLE public.hmis_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  report_type text NOT NULL,
  period_month integer,
  period_week integer,
  period_year integer NOT NULL,
  status text DEFAULT 'draft',
  generated_at timestamptz,
  submitted_at timestamptz,
  report_data jsonb DEFAULT '{}',
  file_url text,
  submitted_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.idsp_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  alert_date date NOT NULL,
  disease text NOT NULL,
  syndrome text,
  cases_opd integer DEFAULT 0,
  cases_ipd integer DEFAULT 0,
  deaths integer DEFAULT 0,
  week_number integer NOT NULL,
  year integer NOT NULL,
  is_outbreak boolean DEFAULT false,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Validation triggers
CREATE OR REPLACE FUNCTION public.validate_hmis_report()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.report_type NOT IN ('monthly_hmis','weekly_idsp_p','weekly_idsp_l','rmncha_monthly','facility_survey','custom') THEN
    RAISE EXCEPTION 'Invalid report_type: %', NEW.report_type;
  END IF;
  IF NEW.status NOT IN ('draft','generated','submitted','accepted') THEN
    RAISE EXCEPTION 'Invalid hmis_reports status: %', NEW.status;
  END IF;
  IF NEW.period_month IS NOT NULL AND (NEW.period_month < 1 OR NEW.period_month > 12) THEN
    RAISE EXCEPTION 'period_month must be 1-12';
  END IF;
  IF NEW.period_week IS NOT NULL AND (NEW.period_week < 1 OR NEW.period_week > 53) THEN
    RAISE EXCEPTION 'period_week must be 1-53';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_hmis_report
  BEFORE INSERT OR UPDATE ON public.hmis_reports
  FOR EACH ROW EXECUTE FUNCTION public.validate_hmis_report();

CREATE OR REPLACE FUNCTION public.validate_idsp_alert()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.week_number < 1 OR NEW.week_number > 53 THEN
    RAISE EXCEPTION 'week_number must be 1-53';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_idsp_alert
  BEFORE INSERT OR UPDATE ON public.idsp_alerts
  FOR EACH ROW EXECUTE FUNCTION public.validate_idsp_alert();

-- RLS
ALTER TABLE public.hmis_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idsp_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital isolation" ON public.hmis_reports
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Hospital isolation" ON public.idsp_alerts
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- Indexes
CREATE INDEX idx_hmis_reports_hospital ON public.hmis_reports(hospital_id);
CREATE INDEX idx_hmis_reports_type_year ON public.hmis_reports(hospital_id, report_type, period_year);
CREATE INDEX idx_idsp_alerts_hospital ON public.idsp_alerts(hospital_id);
CREATE INDEX idx_idsp_alerts_week ON public.idsp_alerts(hospital_id, year, week_number);
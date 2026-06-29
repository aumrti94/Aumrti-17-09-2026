CREATE TABLE IF NOT EXISTS public.report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) ON DELETE CASCADE NOT NULL,
  report_name text NOT NULL,
  report_type text NOT NULL,
  frequency text NOT NULL,
  send_time time DEFAULT '08:00',
  day_of_week integer,
  day_of_month integer,
  recipient_emails text[] DEFAULT '{}',
  recipient_roles text[] DEFAULT '{}',
  format text DEFAULT 'pdf',
  config jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  last_sent_at timestamptz,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.report_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hospital isolation report_schedules" ON public.report_schedules;
CREATE POLICY "Hospital isolation report_schedules" ON public.report_schedules
  FOR ALL USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE INDEX IF NOT EXISTS idx_report_schedules_hospital ON public.report_schedules(hospital_id, is_active);

CREATE OR REPLACE FUNCTION public.validate_report_schedule()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.frequency NOT IN ('daily','weekly','monthly') THEN
    RAISE EXCEPTION 'Invalid frequency: %', NEW.frequency;
  END IF;
  IF NEW.report_type NOT IN ('daily_summary','weekly_opd','monthly_revenue','monthly_quality','custom') THEN
    RAISE EXCEPTION 'Invalid report_type: %', NEW.report_type;
  END IF;
  IF NEW.format NOT IN ('pdf','excel','both','html') THEN
    RAISE EXCEPTION 'Invalid format: %', NEW.format;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_validate_report_schedule ON public.report_schedules;
CREATE TRIGGER trg_validate_report_schedule
  BEFORE INSERT OR UPDATE ON public.report_schedules
  FOR EACH ROW EXECUTE FUNCTION public.validate_report_schedule();
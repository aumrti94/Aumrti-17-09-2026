
-- revenue_alerts table for AI revenue intelligence
CREATE TABLE IF NOT EXISTS public.revenue_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
  bill_id UUID REFERENCES public.bills(id),
  patient_id UUID REFERENCES public.patients(id),
  alert_type TEXT NOT NULL DEFAULT 'unbilled_procedure',
  description TEXT NOT NULL,
  estimated_amount NUMERIC DEFAULT 0,
  severity TEXT NOT NULL DEFAULT 'medium',
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id),
  dismissed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_revenue_alerts_hospital ON public.revenue_alerts(hospital_id, created_at DESC);
CREATE INDEX idx_revenue_alerts_bill ON public.revenue_alerts(bill_id);

-- RLS
ALTER TABLE public.revenue_alerts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'revenue_alerts' AND policyname = 'Hospital isolation for revenue_alerts') THEN
    EXECUTE $policy$
      CREATE POLICY "Hospital isolation for revenue_alerts"
        ON public.revenue_alerts
        FOR ALL
        TO authenticated
        USING (hospital_id IN (SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()))
        WITH CHECK (hospital_id IN (SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()))
    $policy$;
  END IF;
END $$;

-- Validation trigger
CREATE OR REPLACE FUNCTION public.validate_revenue_alert()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.severity NOT IN ('low','medium','high') THEN
    RAISE EXCEPTION 'Invalid severity: %', NEW.severity;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_validate_revenue_alert ON public.revenue_alerts;
CREATE TRIGGER trg_validate_revenue_alert
  BEFORE INSERT OR UPDATE ON public.revenue_alerts
  FOR EACH ROW EXECUTE FUNCTION public.validate_revenue_alert();

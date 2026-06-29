-- Create whatsapp_templates table
CREATE TABLE public.whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  template_name text NOT NULL,
  trigger_event text NOT NULL,
  message_template text NOT NULL,
  is_active boolean DEFAULT true,
  auto_send boolean DEFAULT false,
  send_delay_hours integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Validation trigger for trigger_event
CREATE OR REPLACE FUNCTION public.validate_whatsapp_template_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.trigger_event NOT IN (
    'appointment_confirmed','appointment_reminder_24h',
    'appointment_reminder_2h','lab_result_ready',
    'bill_generated','payment_received','discharge_summary',
    'prescription_ready','follow_up_reminder',
    'feedback_request','critical_alert','custom'
  ) THEN
    RAISE EXCEPTION 'Invalid trigger_event: %', NEW.trigger_event;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_whatsapp_template
  BEFORE INSERT OR UPDATE ON public.whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION public.validate_whatsapp_template_trigger();

-- RLS
ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own hospital templates"
  ON public.whatsapp_templates FOR SELECT
  TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Users can manage own hospital templates"
  ON public.whatsapp_templates FOR ALL
  TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- Add wati_key column to hospitals (wati_api_url already exists)
ALTER TABLE public.hospitals ADD COLUMN IF NOT EXISTS wati_api_key text;

-- Patient Portal Sessions (OTP auth)
CREATE TABLE public.patient_portal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE NOT NULL,
  hospital_id uuid REFERENCES public.hospitals(id) ON DELETE CASCADE NOT NULL,
  phone text NOT NULL,
  otp_code text,
  otp_expires_at timestamptz,
  otp_verified boolean DEFAULT false,
  session_token text UNIQUE,
  last_active timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.patient_portal_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon can insert portal sessions" ON public.patient_portal_sessions
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anon can select portal sessions by token" ON public.patient_portal_sessions
  FOR SELECT TO anon USING (true);

CREATE POLICY "Anon can update portal sessions" ON public.patient_portal_sessions
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Auth users manage own hospital portal sessions" ON public.patient_portal_sessions
  FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

-- Patient Feedback
CREATE TABLE public.patient_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) ON DELETE CASCADE NOT NULL,
  patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE NOT NULL,
  admission_id uuid REFERENCES public.admissions(id),
  encounter_id uuid REFERENCES public.opd_encounters(id),
  overall_rating integer NOT NULL,
  doctor_rating integer,
  nursing_rating integer,
  facility_rating integer,
  comments text,
  would_recommend boolean,
  submitted_at timestamptz DEFAULT now()
);

ALTER TABLE public.patient_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon can insert feedback" ON public.patient_feedback
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Auth users view own hospital feedback" ON public.patient_feedback
  FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

CREATE POLICY "Auth users manage own hospital feedback" ON public.patient_feedback
  FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

-- Validation trigger for feedback ratings
CREATE OR REPLACE FUNCTION public.validate_patient_feedback()
  RETURNS trigger LANGUAGE plpgsql SET search_path = 'public' AS $$
BEGIN
  IF NEW.overall_rating < 1 OR NEW.overall_rating > 5 THEN
    RAISE EXCEPTION 'overall_rating must be between 1 and 5';
  END IF;
  IF NEW.doctor_rating IS NOT NULL AND (NEW.doctor_rating < 1 OR NEW.doctor_rating > 5) THEN
    RAISE EXCEPTION 'doctor_rating must be between 1 and 5';
  END IF;
  IF NEW.nursing_rating IS NOT NULL AND (NEW.nursing_rating < 1 OR NEW.nursing_rating > 5) THEN
    RAISE EXCEPTION 'nursing_rating must be between 1 and 5';
  END IF;
  IF NEW.facility_rating IS NOT NULL AND (NEW.facility_rating < 1 OR NEW.facility_rating > 5) THEN
    RAISE EXCEPTION 'facility_rating must be between 1 and 5';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_patient_feedback
  BEFORE INSERT OR UPDATE ON public.patient_feedback
  FOR EACH ROW EXECUTE FUNCTION public.validate_patient_feedback();

-- WhatsApp Notifications log
CREATE TABLE public.whatsapp_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) ON DELETE CASCADE NOT NULL,
  patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE NOT NULL,
  notification_type text NOT NULL,
  message_text text NOT NULL,
  phone_number text NOT NULL,
  whatsapp_url text NOT NULL,
  sent_at timestamptz,
  opened boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.whatsapp_notifications ENABLE ROW LEVEL SECURITY;

-- Validation trigger for notification_type
CREATE OR REPLACE FUNCTION public.validate_whatsapp_notification_type()
  RETURNS trigger LANGUAGE plpgsql SET search_path = 'public' AS $$
BEGIN
  IF NEW.notification_type NOT IN (
    'appointment_confirmation','appointment_reminder',
    'lab_result_ready','bill_generated','payment_received',
    'discharge_summary','prescription_ready',
    'follow_up_reminder','feedback_request','custom'
  ) THEN
    RAISE EXCEPTION 'Invalid notification_type: %', NEW.notification_type;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_whatsapp_notification_type
  BEFORE INSERT OR UPDATE ON public.whatsapp_notifications
  FOR EACH ROW EXECUTE FUNCTION public.validate_whatsapp_notification_type();

CREATE POLICY "Anon can insert notifications" ON public.whatsapp_notifications
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Auth users manage own hospital notifications" ON public.whatsapp_notifications
  FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

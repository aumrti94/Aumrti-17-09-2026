CREATE TABLE IF NOT EXISTS public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  appointment_date date NOT NULL,
  slot_time time NOT NULL,
  slot_end_time time NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  visit_type text NOT NULL DEFAULT 'new',
  chief_complaint text,
  consultation_fee numeric(10,2) DEFAULT 0,
  booked_by uuid REFERENCES public.users(id),
  booked_via text NOT NULL DEFAULT 'reception',
  whatsapp_reminder_sent boolean NOT NULL DEFAULT false,
  appointment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointments_unique_slot UNIQUE (hospital_id, doctor_id, appointment_date, slot_time)
);

CREATE INDEX IF NOT EXISTS idx_appointments_hospital_date ON public.appointments(hospital_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor_date ON public.appointments(doctor_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON public.appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON public.appointments(status);

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

-- Validation trigger for status / visit_type / booked_via
CREATE OR REPLACE FUNCTION public.validate_appointment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status NOT IN ('scheduled','confirmed','arrived','in_consultation','completed','cancelled','no_show') THEN
    RAISE EXCEPTION 'Invalid appointment status: %', NEW.status;
  END IF;
  IF NEW.visit_type NOT IN ('new','follow_up','review') THEN
    RAISE EXCEPTION 'Invalid visit_type: %', NEW.visit_type;
  END IF;
  IF NEW.booked_via NOT IN ('reception','portal','phone') THEN
    RAISE EXCEPTION 'Invalid booked_via: %', NEW.booked_via;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_appointment ON public.appointments;
CREATE TRIGGER trg_validate_appointment
BEFORE INSERT OR UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.validate_appointment();

-- RLS policy: hospital isolation using existing helper
CREATE POLICY "Hospital isolation - select" ON public.appointments
  FOR SELECT USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "Hospital isolation - insert" ON public.appointments
  FOR INSERT WITH CHECK (hospital_id = public.get_user_hospital_id());
CREATE POLICY "Hospital isolation - update" ON public.appointments
  FOR UPDATE USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "Hospital isolation - delete" ON public.appointments
  FOR DELETE USING (hospital_id = public.get_user_hospital_id());
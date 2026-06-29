CREATE TABLE IF NOT EXISTS public.doctor_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  day_of_week text NOT NULL,
  session_start time NOT NULL,
  session_end time NOT NULL,
  max_patients integer DEFAULT 30,
  slot_duration_minutes integer DEFAULT 15,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT doctor_schedules_unique UNIQUE (hospital_id, doctor_id, day_of_week, session_start)
);

CREATE INDEX IF NOT EXISTS idx_doctor_schedules_doctor ON public.doctor_schedules(hospital_id, doctor_id);

ALTER TABLE public.doctor_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital isolation" ON public.doctor_schedules
  FOR ALL
  TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

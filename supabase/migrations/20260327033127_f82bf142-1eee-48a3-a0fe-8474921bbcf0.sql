
CREATE TABLE public.teleconsult_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  doctor_id uuid REFERENCES auth.users(id) NOT NULL,
  encounter_id uuid REFERENCES public.opd_encounters(id),
  room_id text UNIQUE NOT NULL,
  scheduled_at timestamptz NOT NULL,
  duration_minutes integer DEFAULT 15,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','waiting','in_progress','completed','missed','cancelled')),
  patient_joined_at timestamptz,
  doctor_joined_at timestamptz,
  ended_at timestamptz,
  actual_duration integer,
  prescription_sent boolean DEFAULT false,
  bill_generated boolean DEFAULT false,
  patient_phone text,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.teleconsult_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own hospital teleconsult_sessions"
  ON public.teleconsult_sessions FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can manage own hospital teleconsult_sessions"
  ON public.teleconsult_sessions FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

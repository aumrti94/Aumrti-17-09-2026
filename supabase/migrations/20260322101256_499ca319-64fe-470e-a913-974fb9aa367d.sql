
-- Create ed_visits table for emergency department
CREATE TABLE IF NOT EXISTS public.ed_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  doctor_id uuid REFERENCES public.users(id),
  arrival_mode text NOT NULL DEFAULT 'walkin',
  triage_category text NOT NULL DEFAULT 'P3',
  chief_complaint text,
  vitals_snapshot jsonb DEFAULT '{}',
  mlc boolean DEFAULT false,
  mlc_details jsonb DEFAULT '{}',
  ample_history jsonb DEFAULT '{}',
  working_diagnosis text,
  gcs_score integer,
  disposition text DEFAULT 'awaiting',
  disposition_time timestamptz,
  arrival_time timestamptz NOT NULL DEFAULT now(),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.ed_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own hospital ed_visits"
  ON public.ed_visits FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can manage own hospital ed_visits"
  ON public.ed_visits FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.ed_visits;

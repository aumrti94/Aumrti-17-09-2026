
-- Nursing MAR (Medication Administration Record)
CREATE TABLE public.nursing_mar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  admission_id uuid REFERENCES public.admissions(id) NOT NULL,
  medication_id uuid REFERENCES public.ipd_medications(id) NOT NULL,
  scheduled_date date NOT NULL DEFAULT CURRENT_DATE,
  scheduled_time time NOT NULL,
  administered_at timestamptz,
  administered_by uuid REFERENCES auth.users(id),
  outcome text NOT NULL DEFAULT 'pending',
  omission_reason text,
  five_rights_verified boolean DEFAULT false,
  second_nurse_id uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.nursing_mar ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own hospital nursing_mar"
  ON public.nursing_mar FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can manage own hospital nursing_mar"
  ON public.nursing_mar FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

-- Nursing Handovers
CREATE TABLE public.nursing_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  ward_id uuid REFERENCES public.wards(id) NOT NULL,
  shift_type text NOT NULL,
  outgoing_nurse_id uuid REFERENCES auth.users(id) NOT NULL,
  incoming_nurse_id uuid REFERENCES auth.users(id),
  sbar_data jsonb DEFAULT '[]'::jsonb,
  flags jsonb DEFAULT '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.nursing_handovers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own hospital nursing_handovers"
  ON public.nursing_handovers FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can manage own hospital nursing_handovers"
  ON public.nursing_handovers FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.nursing_mar;
ALTER PUBLICATION supabase_realtime ADD TABLE public.nursing_handovers;

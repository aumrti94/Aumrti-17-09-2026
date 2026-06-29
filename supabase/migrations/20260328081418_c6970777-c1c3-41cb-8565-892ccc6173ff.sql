-- Dialysis Patients
CREATE TABLE public.dialysis_patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  diagnosis text NOT NULL DEFAULT 'esrd',
  access_type text NOT NULL DEFAULT 'av_fistula',
  access_site text,
  hbv_status text NOT NULL DEFAULT 'negative',
  hcv_status text NOT NULL DEFAULT 'negative',
  hiv_status text NOT NULL DEFAULT 'negative',
  machine_type_required text NOT NULL DEFAULT 'clean',
  dry_weight_kg numeric,
  dialysis_frequency text NOT NULL DEFAULT '3_per_week',
  session_duration_hrs numeric NOT NULL DEFAULT 4,
  treating_doctor uuid REFERENCES public.users(id),
  is_active boolean NOT NULL DEFAULT true,
  registered_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(hospital_id, patient_id)
);

CREATE POLICY "Users can view dialysis patients in their hospital"
  ON public.dialysis_patients FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Users can insert dialysis patients in their hospital"
  ON public.dialysis_patients FOR INSERT TO authenticated
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Users can update dialysis patients in their hospital"
  ON public.dialysis_patients FOR UPDATE TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

-- Dialysis Machines
CREATE TABLE public.dialysis_machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  machine_name text NOT NULL,
  machine_type text NOT NULL DEFAULT 'clean',
  model text,
  serial_number text,
  status text NOT NULL DEFAULT 'available',
  current_patient_id uuid REFERENCES public.patients(id),
  last_disinfected_at timestamptz,
  disinfection_due_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE POLICY "Users can view dialysis machines in their hospital"
  ON public.dialysis_machines FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Users can insert dialysis machines in their hospital"
  ON public.dialysis_machines FOR INSERT TO authenticated
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Users can update dialysis machines in their hospital"
  ON public.dialysis_machines FOR UPDATE TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

-- Dialysis Sessions
CREATE TABLE public.dialysis_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  dialysis_patient_id uuid NOT NULL REFERENCES public.dialysis_patients(id),
  machine_id uuid REFERENCES public.dialysis_machines(id),
  session_date date NOT NULL DEFAULT CURRENT_DATE,
  shift text DEFAULT 'morning',
  status text NOT NULL DEFAULT 'scheduled',
  pre_weight_kg numeric,
  post_weight_kg numeric,
  uf_goal_ml numeric,
  uf_achieved_ml numeric,
  kt_v numeric,
  pre_bp_systolic integer,
  pre_bp_diastolic integer,
  post_bp_systolic integer,
  post_bp_diastolic integer,
  heparin_dose text,
  access_used text,
  complications text,
  notes text,
  started_at timestamptz,
  ended_at timestamptz,
  performed_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE POLICY "Users can view dialysis sessions in their hospital"
  ON public.dialysis_sessions FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Users can insert dialysis sessions in their hospital"
  ON public.dialysis_sessions FOR INSERT TO authenticated
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Users can update dialysis sessions in their hospital"
  ON public.dialysis_sessions FOR UPDATE TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

-- Dialyzer Reuse tracking
CREATE TABLE public.dialyzer_reuse (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  dialysis_patient_id uuid NOT NULL REFERENCES public.dialysis_patients(id),
  dialyzer_model text NOT NULL,
  max_reuse_count integer NOT NULL DEFAULT 20,
  current_use_count integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE POLICY "Users can view dialyzer reuse in their hospital"
  ON public.dialyzer_reuse FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Users can insert dialyzer reuse in their hospital"
  ON public.dialyzer_reuse FOR INSERT TO authenticated
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Users can update dialyzer reuse in their hospital"
  ON public.dialyzer_reuse FOR UPDATE TO authenticated
  USING (hospital_id = public.get_user_hospital_id());
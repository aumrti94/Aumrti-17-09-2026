
-- OT Rooms
CREATE TABLE public.ot_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'major',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ot_rooms_type_check CHECK (type IN ('major','minor','emergency','day_care','endoscopy'))
);

ALTER TABLE public.ot_rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own hospital ot_rooms" ON public.ot_rooms FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Admins can manage ot_rooms" ON public.ot_rooms FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

-- OT Schedules
CREATE TABLE public.ot_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  ot_room_id uuid REFERENCES public.ot_rooms(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  admission_id uuid REFERENCES public.admissions(id),
  surgeon_id uuid NOT NULL,
  anaesthetist_id uuid,
  scrub_nurse_id uuid,
  surgery_name text NOT NULL,
  surgery_category text NOT NULL DEFAULT 'general',
  scheduled_date date NOT NULL,
  scheduled_start_time time NOT NULL,
  scheduled_end_time time NOT NULL,
  estimated_duration_minutes integer NOT NULL DEFAULT 60,
  status text NOT NULL DEFAULT 'scheduled',
  anaesthesia_type text NOT NULL DEFAULT 'general',
  booking_notes text,
  cancellation_reason text,
  post_op_diagnosis text,
  actual_start_time timestamptz,
  actual_end_time timestamptz,
  implants_consumables jsonb DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ot_schedules_category_check CHECK (surgery_category IN ('general','orthopaedic','gynaecology','urology','cardiothoracic','neurosurgery','ent','ophthalmology','paediatric','plastic','emergency','endoscopy','other')),
  CONSTRAINT ot_schedules_status_check CHECK (status IN ('scheduled','confirmed','in_progress','completed','cancelled','postponed')),
  CONSTRAINT ot_schedules_anaesthesia_check CHECK (anaesthesia_type IN ('general','spinal','epidural','regional','local','sedation','none'))
);

ALTER TABLE public.ot_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own hospital ot_schedules" ON public.ot_schedules FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital ot_schedules" ON public.ot_schedules FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

-- OT Checklists (WHO Surgical Safety)
CREATE TABLE public.ot_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  ot_schedule_id uuid REFERENCES public.ot_schedules(id) NOT NULL,
  signin_patient_identity boolean NOT NULL DEFAULT false,
  signin_site_marked boolean NOT NULL DEFAULT false,
  signin_consent_signed boolean NOT NULL DEFAULT false,
  signin_anaesthesia_checked boolean NOT NULL DEFAULT false,
  signin_pulse_oximeter boolean NOT NULL DEFAULT false,
  signin_allergies_known boolean NOT NULL DEFAULT false,
  signin_difficult_airway boolean NOT NULL DEFAULT false,
  signin_blood_loss_risk boolean NOT NULL DEFAULT false,
  signin_completed_at timestamptz,
  signin_completed_by uuid,
  timeout_team_introduced boolean NOT NULL DEFAULT false,
  timeout_patient_confirmed boolean NOT NULL DEFAULT false,
  timeout_procedure_confirmed boolean NOT NULL DEFAULT false,
  timeout_site_confirmed boolean NOT NULL DEFAULT false,
  timeout_imaging_displayed boolean NOT NULL DEFAULT false,
  timeout_antibiotics_given boolean NOT NULL DEFAULT false,
  timeout_anticoagulation boolean NOT NULL DEFAULT false,
  timeout_equipment_issues boolean NOT NULL DEFAULT false,
  timeout_completed_at timestamptz,
  timeout_completed_by uuid,
  signout_procedure_recorded boolean NOT NULL DEFAULT false,
  signout_instrument_count boolean NOT NULL DEFAULT false,
  signout_swab_count boolean NOT NULL DEFAULT false,
  signout_specimen_labelled boolean NOT NULL DEFAULT false,
  signout_equipment_issues boolean NOT NULL DEFAULT false,
  signout_recovery_handover boolean NOT NULL DEFAULT false,
  signout_completed_at timestamptz,
  signout_completed_by uuid,
  compliance_percentage integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ot_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own hospital ot_checklists" ON public.ot_checklists FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital ot_checklists" ON public.ot_checklists FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

-- OT Team Members
CREATE TABLE public.ot_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ot_schedule_id uuid REFERENCES public.ot_schedules(id) NOT NULL,
  user_id uuid NOT NULL,
  role_in_ot text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  CONSTRAINT ot_team_role_check CHECK (role_in_ot IN ('primary_surgeon','assistant_surgeon','anaesthetist','scrub_nurse','circulating_nurse','ot_technician','other'))
);

ALTER TABLE public.ot_team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view ot_team_members" ON public.ot_team_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can manage ot_team_members" ON public.ot_team_members FOR ALL TO authenticated USING (true) WITH CHECK (true);

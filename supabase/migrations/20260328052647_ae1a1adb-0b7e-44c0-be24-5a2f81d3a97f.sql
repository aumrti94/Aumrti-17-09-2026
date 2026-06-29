
-- Blood Bank Module: 5 tables

CREATE TABLE public.donors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  donor_code text UNIQUE NOT NULL,
  full_name text NOT NULL,
  dob date,
  age integer,
  gender text CHECK (gender IN ('male','female','other')),
  blood_group text NOT NULL CHECK (blood_group IN ('A','B','AB','O')),
  rh_factor text NOT NULL CHECK (rh_factor IN ('positive','negative')),
  phone text,
  address text,
  donation_count integer DEFAULT 0,
  last_donation date,
  next_eligible date,
  is_eligible boolean DEFAULT true,
  hiv_status text DEFAULT 'not_tested' CHECK (hiv_status IN ('reactive','non_reactive','not_tested')),
  hbsag_status text DEFAULT 'not_tested' CHECK (hbsag_status IN ('reactive','non_reactive','not_tested')),
  hcv_status text DEFAULT 'not_tested' CHECK (hcv_status IN ('reactive','non_reactive','not_tested')),
  vdrl_status text DEFAULT 'not_tested' CHECK (vdrl_status IN ('reactive','non_reactive','not_tested')),
  malaria_status text DEFAULT 'not_tested' CHECK (malaria_status IN ('reactive','non_reactive','not_tested')),
  hb_at_donation numeric(4,1),
  weight_kg numeric(5,1),
  bp_systolic integer,
  bp_diastolic integer,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.donors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "donors_hospital_isolation" ON public.donors FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

CREATE TABLE public.blood_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  unit_number text UNIQUE NOT NULL,
  donor_id uuid REFERENCES public.donors(id),
  component text NOT NULL CHECK (component IN ('whole_blood','rbc','ffp','platelets','cryoprecipitate')),
  blood_group text NOT NULL CHECK (blood_group IN ('A','B','AB','O')),
  rh_factor text NOT NULL CHECK (rh_factor IN ('positive','negative')),
  volume_ml integer,
  collected_at timestamptz NOT NULL,
  expiry_at timestamptz NOT NULL,
  bag_number text,
  storage_location text,
  status text DEFAULT 'available' CHECK (status IN ('available','reserved','issued','discarded','quarantine','returned','expired')),
  reserved_for uuid REFERENCES public.patients(id),
  reserved_for_ot uuid,
  issued_to uuid REFERENCES public.patients(id),
  discarded_reason text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.blood_units ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blood_units_hospital_isolation" ON public.blood_units FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

CREATE TABLE public.cross_match_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  unit_id uuid REFERENCES public.blood_units(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  admission_id uuid REFERENCES public.admissions(id),
  ot_id uuid,
  technique text NOT NULL CHECK (technique IN ('immediate_spin','albumin','antiglobulin','electronic')),
  result text NOT NULL CHECK (result IN ('compatible','incompatible','minor_incompatible')),
  performed_by uuid REFERENCES public.users(id) NOT NULL,
  performed_at timestamptz DEFAULT now(),
  notes text
);
ALTER TABLE public.cross_match_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cross_match_hospital_isolation" ON public.cross_match_records FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

CREATE TABLE public.blood_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  unit_id uuid REFERENCES public.blood_units(id) NOT NULL,
  cross_match_id uuid REFERENCES public.cross_match_records(id),
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  admission_id uuid REFERENCES public.admissions(id),
  ot_id uuid,
  issued_by uuid REFERENCES public.users(id) NOT NULL,
  issued_at timestamptz DEFAULT now(),
  transfusion_start timestamptz,
  transfusion_end timestamptz,
  returned boolean DEFAULT false,
  return_reason text,
  adverse_event boolean DEFAULT false,
  adverse_event_type text,
  transfusion_reaction_form_completed boolean DEFAULT false
);
ALTER TABLE public.blood_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blood_issues_hospital_isolation" ON public.blood_issues FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

CREATE TABLE public.blood_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  admission_id uuid REFERENCES public.admissions(id),
  ot_id uuid,
  requested_by uuid REFERENCES public.users(id) NOT NULL,
  blood_group text NOT NULL CHECK (blood_group IN ('A','B','AB','O')),
  rh_factor text NOT NULL CHECK (rh_factor IN ('positive','negative')),
  component text NOT NULL CHECK (component IN ('whole_blood','rbc','ffp','platelets','cryoprecipitate')),
  units_required integer NOT NULL,
  urgency text DEFAULT 'routine' CHECK (urgency IN ('routine','urgent','emergency')),
  indication text NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending','processing','fulfilled','partially_fulfilled','cancelled','external_requested')),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.blood_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blood_requests_hospital_isolation" ON public.blood_requests FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

-- Seed 20 sample blood units (use hospital_id prefix to avoid unique conflicts across hospitals)
INSERT INTO public.blood_units (hospital_id, unit_number, component, blood_group, rh_factor, volume_ml, collected_at, expiry_at, storage_location, status)
SELECT h.id, 'BU-' || LEFT(h.id::text, 8) || '-' || u.num, u.comp, u.grp, u.rh, u.vol,
  now() - (u.days_old || ' days')::interval,
  now() + ((u.shelf - u.days_old) || ' days')::interval,
  u.loc, 'available'
FROM (SELECT id FROM public.hospitals LIMIT 1) h
CROSS JOIN (VALUES
  ('001','rbc','A','positive',350,3,35,'Refrigerator 1 / Shelf A'),
  ('002','rbc','A','positive',350,1,35,'Refrigerator 1 / Shelf A'),
  ('003','rbc','B','positive',350,5,35,'Refrigerator 1 / Shelf B'),
  ('004','rbc','O','positive',350,2,35,'Refrigerator 1 / Shelf C'),
  ('005','rbc','O','positive',350,0,35,'Refrigerator 1 / Shelf C'),
  ('006','rbc','AB','positive',350,8,35,'Refrigerator 1 / Shelf D'),
  ('007','rbc','A','negative',350,4,35,'Refrigerator 2 / Shelf A'),
  ('008','rbc','O','negative',350,1,35,'Refrigerator 2 / Shelf C'),
  ('009','whole_blood','B','positive',450,0,35,'Refrigerator 2 / Shelf B'),
  ('010','whole_blood','O','positive',450,2,35,'Refrigerator 2 / Shelf C'),
  ('011','ffp','A','positive',200,1,365,'Freezer 1 / Box 1'),
  ('012','ffp','B','positive',200,5,365,'Freezer 1 / Box 1'),
  ('013','ffp','O','positive',200,3,365,'Freezer 1 / Box 2'),
  ('014','ffp','AB','positive',200,0,365,'Freezer 1 / Box 2'),
  ('015','platelets','A','positive',50,0,5,'Platelet Agitator / Slot 1'),
  ('016','platelets','B','positive',50,1,5,'Platelet Agitator / Slot 2'),
  ('017','platelets','O','positive',50,2,5,'Platelet Agitator / Slot 3'),
  ('018','platelets','AB','positive',50,0,5,'Platelet Agitator / Slot 4'),
  ('019','cryoprecipitate','A','positive',20,10,365,'Freezer 2 / Box 1'),
  ('020','cryoprecipitate','O','positive',20,7,365,'Freezer 2 / Box 1')
) AS u(num, comp, grp, rh, vol, days_old, shelf, loc);

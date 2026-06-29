
-- CSSD Module: 5 tables (instrument_sets first since instruments references it)

CREATE TABLE public.instrument_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  set_name text NOT NULL,
  set_code text UNIQUE NOT NULL,
  specialty text,
  instrument_count integer DEFAULT 0,
  status text DEFAULT 'sterile' CHECK (status IN ('dirty','processing','sterile','in_use','quarantine')),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.instrument_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "instrument_sets_hospital_isolation" ON public.instrument_sets FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

CREATE TABLE public.instruments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  barcode text UNIQUE NOT NULL,
  instrument_name text NOT NULL,
  instrument_code text,
  category text DEFAULT 'surgical' CHECK (category IN ('surgical','endoscope','implant','electrical','container','other')),
  material text DEFAULT 'stainless_steel',
  set_id uuid REFERENCES public.instrument_sets(id),
  max_reprocessing integer DEFAULT 0,
  reprocessing_count integer DEFAULT 0,
  status text DEFAULT 'sterile' CHECK (status IN ('dirty','decontamination','inspection','packaging','in_sterilizer','sterile','in_use','quarantine','condemned')),
  last_sterilized_at timestamptz,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.instruments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "instruments_hospital_isolation" ON public.instruments FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

CREATE TABLE public.sterilization_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  cycle_number text UNIQUE NOT NULL,
  autoclave_id text NOT NULL,
  load_type text NOT NULL CHECK (load_type IN ('routine','emergency','flash','implant')),
  sterilization_method text DEFAULT 'steam_autoclave' CHECK (sterilization_method IN ('steam_autoclave','eo_gas','plasma','dry_heat','chemical')),
  temperature_c numeric(5,1),
  pressure_psi numeric(5,1),
  duration_minutes integer,
  cycle_start_at timestamptz NOT NULL,
  cycle_end_at timestamptz,
  operator_id uuid REFERENCES public.users(id),
  biological_indicator_used boolean DEFAULT true,
  bi_result text DEFAULT 'pending' CHECK (bi_result IN ('pass','fail','pending')),
  bi_result_at timestamptz,
  bi_read_by uuid REFERENCES public.users(id),
  chemical_indicator_result text DEFAULT 'pass' CHECK (chemical_indicator_result IN ('pass','fail')),
  flash_justification text,
  flash_approved_by uuid REFERENCES public.users(id),
  status text DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','failed','quarantine')),
  notes text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.sterilization_cycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sterilization_cycles_hospital_isolation" ON public.sterilization_cycles FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

CREATE TABLE public.cycle_instruments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  cycle_id uuid REFERENCES public.sterilization_cycles(id) NOT NULL,
  instrument_id uuid REFERENCES public.instruments(id),
  set_id uuid REFERENCES public.instrument_sets(id),
  item_type text CHECK (item_type IN ('instrument','set'))
);
ALTER TABLE public.cycle_instruments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cycle_instruments_hospital_isolation" ON public.cycle_instruments FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

CREATE TABLE public.set_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  set_id uuid REFERENCES public.instrument_sets(id) NOT NULL,
  ot_schedule_id uuid,
  patient_uhid text,
  issued_by uuid REFERENCES public.users(id) NOT NULL,
  issued_at timestamptz DEFAULT now(),
  returned_at timestamptz,
  returned_by uuid REFERENCES public.users(id),
  instruments_issued_count integer NOT NULL,
  instruments_returned_count integer DEFAULT 0,
  damaged_count integer DEFAULT 0,
  loss_count integer DEFAULT 0,
  return_status text DEFAULT 'pending' CHECK (return_status IN ('pending','complete','loss_reported')),
  loss_reason text
);
ALTER TABLE public.set_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "set_issues_hospital_isolation" ON public.set_issues FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id());

-- Seed 5 common instrument sets (only for first hospital, avoid duplicates)
INSERT INTO public.instrument_sets (hospital_id, set_name, set_code, specialty)
SELECT h.id, s.name, s.code, s.specialty
FROM (SELECT id FROM public.hospitals LIMIT 1) h
CROSS JOIN (VALUES
  ('Basic Laparotomy Set','SET-LAP-001','General Surgery'),
  ('Caesarean Section Set','SET-LSCS-001','Obstetrics'),
  ('Basic Orthopaedic Set','SET-ORTHO-001','Orthopaedics'),
  ('Laparoscopy Set','SET-LAPSC-001','General Surgery'),
  ('Minor Procedure Set','SET-MINOR-001','General')
) AS s(name, code, specialty)
WHERE NOT EXISTS (SELECT 1 FROM public.instrument_sets WHERE set_code = s.code);

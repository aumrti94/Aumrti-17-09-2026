
-- ══════════════════════════════════════════════════
-- Mortuary / Medico-Legal Module (M30) Tables
-- ══════════════════════════════════════════════════

-- 1. mortuary_admissions
CREATE TABLE public.mortuary_admissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  admission_id uuid REFERENCES public.admissions(id),
  body_number text UNIQUE NOT NULL,
  time_of_death timestamptz NOT NULL,
  pronounced_by uuid REFERENCES public.users(id) NOT NULL,
  cause_of_death text NOT NULL,
  manner_of_death text DEFAULT 'natural',
  is_mlc boolean DEFAULT false,
  storage_slot text,
  admitted_at timestamptz DEFAULT now(),
  released_at timestamptz,
  status text DEFAULT 'in_mortuary',
  notes text,
  created_at timestamptz DEFAULT now()
);

-- 2. mccd_certificates
CREATE TABLE public.mccd_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  mortuary_id uuid REFERENCES public.mortuary_admissions(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  cause_1a text NOT NULL,
  cause_1b text,
  cause_1c text,
  cause_part2 text,
  approximate_interval_1a text,
  approximate_interval_1b text,
  approximate_interval_1c text,
  icd_code_underlying text,
  manner_of_death text NOT NULL,
  was_post_mortem boolean DEFAULT false,
  certifying_doctor uuid REFERENCES public.users(id) NOT NULL,
  mccd_number text UNIQUE,
  issued_at timestamptz,
  civil_reg_submitted boolean DEFAULT false,
  civil_reg_date date,
  digital_signed boolean DEFAULT false,
  ai_draft boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- 3. mlc_records
CREATE TABLE public.mlc_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  mortuary_id uuid REFERENCES public.mortuary_admissions(id),
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  mlc_number text UNIQUE NOT NULL,
  incident_type text NOT NULL,
  incident_date date,
  incident_location text,
  police_station text,
  officer_name text,
  officer_badge text,
  fir_number text,
  intimated_at timestamptz,
  forensic_sample_collected boolean DEFAULT false,
  forensic_samples text[] DEFAULT '{}',
  injury_description text,
  post_mortem_requested boolean DEFAULT false,
  pm_done_at timestamptz,
  pm_surgeon text,
  status text DEFAULT 'open',
  created_at timestamptz DEFAULT now()
);

-- 4. body_releases
CREATE TABLE public.body_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  mortuary_id uuid REFERENCES public.mortuary_admissions(id) NOT NULL,
  released_to text NOT NULL,
  relation text NOT NULL,
  id_proof_type text NOT NULL,
  id_proof_number text,
  released_at timestamptz DEFAULT now(),
  released_by uuid REFERENCES public.users(id) NOT NULL,
  police_clearance boolean DEFAULT false,
  mccd_issued boolean DEFAULT false,
  documents_given text[] DEFAULT '{}',
  witness_name text,
  remarks text
);

-- 5. organ_donations
CREATE TABLE public.organ_donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  mortuary_id uuid REFERENCES public.mortuary_admissions(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  notto_ref text,
  brain_death_certified boolean DEFAULT false,
  brain_death_date timestamptz,
  brain_death_doctors uuid[] DEFAULT '{}',
  family_counselled boolean DEFAULT false,
  family_consent boolean DEFAULT false,
  consent_date timestamptz,
  organs_pledged text[] DEFAULT '{}',
  transplant_team_notified_at timestamptz,
  outcome text,
  created_at timestamptz DEFAULT now()
);

-- 6. cold_storage_log
CREATE TABLE public.cold_storage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  unit_name text NOT NULL,
  temperature_c numeric(4,1) NOT NULL,
  recorded_at timestamptz DEFAULT now(),
  recorded_by uuid REFERENCES public.users(id),
  alert_triggered boolean DEFAULT false,
  maintenance_note text
);

-- ══════════════════════════════════════════════════
-- Validation triggers
-- ══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.validate_mortuary_admission()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.manner_of_death NOT IN ('natural','accident','suicide','homicide','undetermined') THEN
    RAISE EXCEPTION 'Invalid manner_of_death: %', NEW.manner_of_death;
  END IF;
  IF NEW.status NOT IN ('in_mortuary','post_mortem','released','unclaimed') THEN
    RAISE EXCEPTION 'Invalid mortuary status: %', NEW.status;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_mortuary_admission
  BEFORE INSERT OR UPDATE ON public.mortuary_admissions
  FOR EACH ROW EXECUTE FUNCTION public.validate_mortuary_admission();

CREATE OR REPLACE FUNCTION public.validate_mlc_record()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.incident_type NOT IN ('rta','assault','fall','poisoning','burns','drowning','hanging','gunshot','unknown_cause','other') THEN
    RAISE EXCEPTION 'Invalid incident_type: %', NEW.incident_type;
  END IF;
  IF NEW.status NOT IN ('open','intimated','fir_filed','closed') THEN
    RAISE EXCEPTION 'Invalid mlc status: %', NEW.status;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_mlc_record
  BEFORE INSERT OR UPDATE ON public.mlc_records
  FOR EACH ROW EXECUTE FUNCTION public.validate_mlc_record();

-- ══════════════════════════════════════════════════
-- RLS policies (hospital isolation)
-- ══════════════════════════════════════════════════

ALTER TABLE public.mortuary_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mccd_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mlc_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.body_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organ_donations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cold_storage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital isolation" ON public.mortuary_admissions FOR ALL USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "Hospital isolation" ON public.mccd_certificates FOR ALL USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "Hospital isolation" ON public.mlc_records FOR ALL USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "Hospital isolation" ON public.body_releases FOR ALL USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "Hospital isolation" ON public.organ_donations FOR ALL USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "Hospital isolation" ON public.cold_storage_log FOR ALL USING (hospital_id = public.get_user_hospital_id());

-- ══════════════════════════════════════════════════
-- Performance indexes
-- ══════════════════════════════════════════════════

CREATE INDEX idx_mortuary_hospital ON public.mortuary_admissions(hospital_id);
CREATE INDEX idx_mortuary_patient ON public.mortuary_admissions(patient_id);
CREATE INDEX idx_mortuary_status ON public.mortuary_admissions(hospital_id, status);
CREATE INDEX idx_mccd_hospital ON public.mccd_certificates(hospital_id);
CREATE INDEX idx_mccd_mortuary ON public.mccd_certificates(mortuary_id);
CREATE INDEX idx_mlc_hospital ON public.mlc_records(hospital_id);
CREATE INDEX idx_mlc_patient ON public.mlc_records(patient_id);
CREATE INDEX idx_body_releases_hospital ON public.body_releases(hospital_id);
CREATE INDEX idx_organ_donations_hospital ON public.organ_donations(hospital_id);
CREATE INDEX idx_cold_storage_hospital ON public.cold_storage_log(hospital_id);
CREATE INDEX idx_cold_storage_unit ON public.cold_storage_log(hospital_id, unit_name);

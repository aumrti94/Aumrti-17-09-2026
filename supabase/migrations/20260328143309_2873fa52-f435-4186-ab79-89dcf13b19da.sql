
-- Specialty EMR Templates: 5 tables

CREATE TABLE public.obstetric_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  patient_id uuid REFERENCES patients(id) NOT NULL,
  encounter_id uuid,
  record_type text DEFAULT 'anc',
  lmp date,
  edd date,
  gestational_age_weeks integer,
  gestational_age_days integer,
  fundal_height_cm numeric(4,1),
  fetal_presentation text,
  fetal_engagement text,
  fetal_heart_rate integer,
  bishop_dilation integer,
  bishop_effacement integer,
  bishop_station integer,
  bishop_consistency integer,
  bishop_position integer,
  bishop_total integer,
  risk_pre_eclampsia boolean DEFAULT false,
  risk_gdm boolean DEFAULT false,
  risk_oligohydramnios boolean DEFAULT false,
  risk_fetal_distress boolean DEFAULT false,
  risk_notes text,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.validate_obstetric_record()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.record_type NOT IN ('anc','delivery','postnatal') THEN
    RAISE EXCEPTION 'Invalid record_type: %', NEW.record_type;
  END IF;
  IF NEW.bishop_dilation IS NOT NULL AND (NEW.bishop_dilation < 0 OR NEW.bishop_dilation > 3) THEN
    RAISE EXCEPTION 'bishop_dilation must be 0-3';
  END IF;
  IF NEW.bishop_effacement IS NOT NULL AND (NEW.bishop_effacement < 0 OR NEW.bishop_effacement > 3) THEN
    RAISE EXCEPTION 'bishop_effacement must be 0-3';
  END IF;
  IF NEW.bishop_station IS NOT NULL AND (NEW.bishop_station < 0 OR NEW.bishop_station > 3) THEN
    RAISE EXCEPTION 'bishop_station must be 0-3';
  END IF;
  IF NEW.bishop_consistency IS NOT NULL AND (NEW.bishop_consistency < 0 OR NEW.bishop_consistency > 2) THEN
    RAISE EXCEPTION 'bishop_consistency must be 0-2';
  END IF;
  IF NEW.bishop_position IS NOT NULL AND (NEW.bishop_position < 0 OR NEW.bishop_position > 2) THEN
    RAISE EXCEPTION 'bishop_position must be 0-2';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_obstetric_record
  BEFORE INSERT OR UPDATE ON public.obstetric_records
  FOR EACH ROW EXECUTE FUNCTION public.validate_obstetric_record();

CREATE POLICY "Hospital isolation" ON public.obstetric_records
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE TABLE public.partograph_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  patient_id uuid REFERENCES patients(id) NOT NULL,
  admission_id uuid REFERENCES admissions(id) NOT NULL,
  labour_start_at timestamptz NOT NULL,
  rupture_of_membranes_at timestamptz,
  liquor_colour text DEFAULT 'clear',
  cervical_dilatations jsonb DEFAULT '[]',
  fetal_heart_rates jsonb DEFAULT '[]',
  contractions jsonb DEFAULT '[]',
  oxytocin_doses jsonb DEFAULT '[]',
  outcome text,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.validate_partograph_record()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.liquor_colour NOT IN ('clear','blood_stained','meconium_thin','meconium_thick') THEN
    RAISE EXCEPTION 'Invalid liquor_colour: %', NEW.liquor_colour;
  END IF;
  IF NEW.outcome IS NOT NULL AND NEW.outcome NOT IN ('svd','lscs','forceps','vacuum','still_born') THEN
    RAISE EXCEPTION 'Invalid outcome: %', NEW.outcome;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_partograph_record
  BEFORE INSERT OR UPDATE ON public.partograph_records
  FOR EACH ROW EXECUTE FUNCTION public.validate_partograph_record();

CREATE POLICY "Hospital isolation" ON public.partograph_records
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE TABLE public.neonatal_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  patient_id uuid REFERENCES patients(id) NOT NULL,
  mother_patient_id uuid REFERENCES patients(id),
  admission_id uuid REFERENCES admissions(id),
  date_of_birth timestamptz NOT NULL,
  birth_weight_g integer,
  length_cm numeric(4,1),
  head_circumference_cm numeric(4,1),
  weight_zscore numeric(4,2),
  length_zscore numeric(4,2),
  hc_zscore numeric(4,2),
  apgar_1min integer,
  apgar_5min integer,
  bilirubin_readings jsonb DEFAULT '[]',
  phototherapy_started boolean DEFAULT false,
  tsh_done boolean DEFAULT false,
  tsh_result text,
  g6pd_done boolean DEFAULT false,
  g6pd_result text,
  hearing_screen text,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.validate_neonatal_record()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.apgar_1min IS NOT NULL AND (NEW.apgar_1min < 0 OR NEW.apgar_1min > 10) THEN
    RAISE EXCEPTION 'apgar_1min must be 0-10';
  END IF;
  IF NEW.apgar_5min IS NOT NULL AND (NEW.apgar_5min < 0 OR NEW.apgar_5min > 10) THEN
    RAISE EXCEPTION 'apgar_5min must be 0-10';
  END IF;
  IF NEW.hearing_screen IS NOT NULL AND NEW.hearing_screen NOT IN ('pass','refer','not_done') THEN
    RAISE EXCEPTION 'Invalid hearing_screen: %', NEW.hearing_screen;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_neonatal_record
  BEFORE INSERT OR UPDATE ON public.neonatal_records
  FOR EACH ROW EXECUTE FUNCTION public.validate_neonatal_record();

CREATE POLICY "Hospital isolation" ON public.neonatal_records
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE TABLE public.anaesthesia_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  patient_id uuid REFERENCES patients(id) NOT NULL,
  ot_id uuid REFERENCES ot_schedules(id),
  asa_class integer,
  mallampati_score integer,
  airway_mouth_opening text,
  neck_mobility text,
  thyromental_distance text,
  technique text NOT NULL DEFAULT 'ga',
  induction_agents jsonb DEFAULT '[]',
  maintenance_agents jsonb DEFAULT '[]',
  intraop_vitals jsonb DEFAULT '[]',
  fluid_in_ml integer DEFAULT 0,
  urine_out_ml integer,
  blood_loss_ml integer,
  aldrete_scores jsonb DEFAULT '[]',
  pacu_discharge_at timestamptz,
  complications text,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.validate_anaesthesia_record()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.technique NOT IN ('ga','spinal','epidural','regional','local','combined') THEN
    RAISE EXCEPTION 'Invalid technique: %', NEW.technique;
  END IF;
  IF NEW.asa_class IS NOT NULL AND (NEW.asa_class < 1 OR NEW.asa_class > 6) THEN
    RAISE EXCEPTION 'asa_class must be 1-6';
  END IF;
  IF NEW.mallampati_score IS NOT NULL AND (NEW.mallampati_score < 1 OR NEW.mallampati_score > 4) THEN
    RAISE EXCEPTION 'mallampati_score must be 1-4';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_anaesthesia_record
  BEFORE INSERT OR UPDATE ON public.anaesthesia_records
  FOR EACH ROW EXECUTE FUNCTION public.validate_anaesthesia_record();

CREATE POLICY "Hospital isolation" ON public.anaesthesia_records
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE TABLE public.ophthalmology_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  patient_id uuid REFERENCES patients(id) NOT NULL,
  encounter_id uuid,
  va_re_snellen text,
  va_le_snellen text,
  va_re_logmar numeric(4,2),
  va_le_logmar numeric(4,2),
  re_sphere numeric(5,2),
  re_cylinder numeric(5,2),
  re_axis integer,
  le_sphere numeric(5,2),
  le_cylinder numeric(5,2),
  le_axis integer,
  iop_re_mmhg numeric(4,1),
  iop_le_mmhg numeric(4,1),
  cup_disc_re numeric(3,1),
  cup_disc_le numeric(3,1),
  macula_re text,
  macula_le text,
  dr_grade text,
  iol_power_re numeric(5,2),
  iol_power_le numeric(5,2),
  iol_formula text,
  created_at timestamptz DEFAULT now()
);

CREATE POLICY "Hospital isolation" ON public.ophthalmology_records
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

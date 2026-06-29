-- ══════════════════════════════════════════════════
-- Physiotherapy Module (M27) Tables
-- ══════════════════════════════════════════════════

-- 1. physio_referrals
CREATE TABLE public.physio_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  admission_id uuid REFERENCES public.admissions(id),
  opd_encounter_id uuid REFERENCES public.opd_encounters(id),
  referred_by uuid REFERENCES public.users(id) NOT NULL,
  referral_date date NOT NULL DEFAULT current_date,
  diagnosis text NOT NULL,
  icd_code text,
  goals text[],
  urgency text DEFAULT 'routine',
  precautions text,
  accepted_by uuid REFERENCES public.users(id),
  accepted_at timestamptz,
  status text DEFAULT 'pending',
  total_sessions_planned integer,
  total_sessions_done integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_physio_referrals_hospital ON public.physio_referrals(hospital_id);
CREATE INDEX idx_physio_referrals_patient ON public.physio_referrals(patient_id);
CREATE INDEX idx_physio_referrals_status ON public.physio_referrals(hospital_id, status);

ALTER TABLE public.physio_referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Hospital isolation" ON public.physio_referrals FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE OR REPLACE FUNCTION public.validate_physio_referral()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.urgency NOT IN ('urgent','routine') THEN
    RAISE EXCEPTION 'Invalid urgency: %', NEW.urgency;
  END IF;
  IF NEW.status NOT IN ('pending','accepted','in_progress','completed','discharged','cancelled') THEN
    RAISE EXCEPTION 'Invalid physio_referral status: %', NEW.status;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_physio_referral
  BEFORE INSERT OR UPDATE ON public.physio_referrals
  FOR EACH ROW EXECUTE FUNCTION public.validate_physio_referral();

-- 2. physio_sessions
CREATE TABLE public.physio_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  referral_id uuid REFERENCES public.physio_referrals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  therapist_id uuid REFERENCES public.users(id) NOT NULL,
  session_date date NOT NULL,
  session_time time NOT NULL,
  duration_minutes integer NOT NULL,
  session_type text DEFAULT 'in_clinic',
  modalities_used text[],
  treatment_notes text,
  home_exercises_given boolean DEFAULT false,
  pain_score_before integer,
  pain_score_after integer,
  attended boolean DEFAULT true,
  cancellation_reason text,
  billed boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_physio_sessions_hospital ON public.physio_sessions(hospital_id);
CREATE INDEX idx_physio_sessions_referral ON public.physio_sessions(referral_id);
CREATE INDEX idx_physio_sessions_date ON public.physio_sessions(hospital_id, session_date);

ALTER TABLE public.physio_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Hospital isolation" ON public.physio_sessions FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE OR REPLACE FUNCTION public.validate_physio_session()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.session_type NOT IN ('in_clinic','bedside_ip','home_visit','tele') THEN
    RAISE EXCEPTION 'Invalid session_type: %', NEW.session_type;
  END IF;
  IF NEW.pain_score_before IS NOT NULL AND (NEW.pain_score_before < 0 OR NEW.pain_score_before > 10) THEN
    RAISE EXCEPTION 'pain_score_before must be 0-10';
  END IF;
  IF NEW.pain_score_after IS NOT NULL AND (NEW.pain_score_after < 0 OR NEW.pain_score_after > 10) THEN
    RAISE EXCEPTION 'pain_score_after must be 0-10';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_physio_session
  BEFORE INSERT OR UPDATE ON public.physio_sessions
  FOR EACH ROW EXECUTE FUNCTION public.validate_physio_session();

-- 3. outcome_scores
CREATE TABLE public.outcome_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  referral_id uuid REFERENCES public.physio_referrals(id) NOT NULL,
  tool text NOT NULL,
  score numeric(6,2) NOT NULL,
  max_score numeric(6,2),
  score_percent numeric(5,2),
  assessment_type text DEFAULT 'initial',
  scored_at date NOT NULL DEFAULT current_date,
  scored_by uuid REFERENCES public.users(id) NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_outcome_scores_hospital ON public.outcome_scores(hospital_id);
CREATE INDEX idx_outcome_scores_referral ON public.outcome_scores(referral_id);

ALTER TABLE public.outcome_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Hospital isolation" ON public.outcome_scores FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE OR REPLACE FUNCTION public.validate_outcome_score()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.tool NOT IN ('fim','barthel','vas','koos','dash','berg_balance','mrc','other') THEN
    RAISE EXCEPTION 'Invalid outcome tool: %', NEW.tool;
  END IF;
  IF NEW.assessment_type NOT IN ('initial','interim','discharge') THEN
    RAISE EXCEPTION 'Invalid assessment_type: %', NEW.assessment_type;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_outcome_score
  BEFORE INSERT OR UPDATE ON public.outcome_scores
  FOR EACH ROW EXECUTE FUNCTION public.validate_outcome_score();

-- 4. hep_plans
CREATE TABLE public.hep_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  referral_id uuid REFERENCES public.physio_referrals(id) NOT NULL,
  created_by uuid REFERENCES public.users(id) NOT NULL,
  exercises jsonb NOT NULL DEFAULT '[]',
  frequency_per_day integer DEFAULT 2,
  duration_weeks integer DEFAULT 4,
  sent_via text[],
  last_viewed_at timestamptz,
  view_count integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_hep_plans_hospital ON public.hep_plans(hospital_id);
CREATE INDEX idx_hep_plans_referral ON public.hep_plans(referral_id);

ALTER TABLE public.hep_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Hospital isolation" ON public.hep_plans FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- 5. physio_equipment_bookings
CREATE TABLE public.physio_equipment_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  equipment_type text NOT NULL,
  booked_for uuid REFERENCES public.users(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id),
  session_id uuid REFERENCES public.physio_sessions(id),
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  status text DEFAULT 'booked',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_physio_equip_hospital ON public.physio_equipment_bookings(hospital_id);
CREATE INDEX idx_physio_equip_time ON public.physio_equipment_bookings(hospital_id, start_time);

ALTER TABLE public.physio_equipment_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Hospital isolation" ON public.physio_equipment_bookings FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE OR REPLACE FUNCTION public.validate_physio_equipment_booking()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.equipment_type NOT IN ('ust','ift','tens','swt','traction','hydrotherapy','parallel_bars','treadmill','other') THEN
    RAISE EXCEPTION 'Invalid equipment_type: %', NEW.equipment_type;
  END IF;
  IF NEW.status NOT IN ('booked','in_use','completed','cancelled') THEN
    RAISE EXCEPTION 'Invalid booking status: %', NEW.status;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_physio_equipment_booking
  BEFORE INSERT OR UPDATE ON public.physio_equipment_bookings
  FOR EACH ROW EXECUTE FUNCTION public.validate_physio_equipment_booking();
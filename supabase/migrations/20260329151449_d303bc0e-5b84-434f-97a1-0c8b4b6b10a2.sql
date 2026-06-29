
-- CRM/Marketing Module (M25) Tables

CREATE TABLE public.referral_doctors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  doctor_name text NOT NULL,
  specialty text,
  qualification text,
  clinic_hospital text,
  phone text,
  email text,
  address text,
  city text,
  total_referrals integer DEFAULT 0,
  total_revenue numeric(12,2) DEFAULT 0,
  last_referral_at date,
  last_engagement_at date,
  relationship_tier text DEFAULT 'standard',
  is_active boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.marketing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  campaign_name text NOT NULL,
  campaign_type text NOT NULL,
  target_segment text,
  segment_criteria jsonb DEFAULT '{}',
  message_template text,
  start_date date,
  end_date date,
  budget_inr numeric(10,2),
  reach_count integer DEFAULT 0,
  conversion_count integer DEFAULT 0,
  revenue_generated numeric(12,2) DEFAULT 0,
  cost_per_patient numeric(8,2),
  roi_percent numeric(6,2),
  status text DEFAULT 'draft',
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.patient_acquisition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  patient_id uuid REFERENCES public.patients(id) NOT NULL,
  source text NOT NULL,
  referral_doctor_id uuid REFERENCES public.referral_doctors(id),
  campaign_id uuid REFERENCES public.marketing_campaigns(id),
  first_visit_date date,
  first_visit_revenue numeric(10,2),
  is_new_patient boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.online_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  platform text NOT NULL,
  reviewer_name text,
  rating integer NOT NULL,
  review_text text,
  review_date date,
  sentiment text,
  ai_sentiment_score numeric(4,2),
  responded boolean DEFAULT false,
  response_text text,
  responded_at timestamptz,
  responded_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.patient_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  segment_name text NOT NULL,
  segment_type text NOT NULL,
  criteria jsonb NOT NULL,
  patient_count integer DEFAULT 0,
  last_computed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_referral_doctors_hospital ON public.referral_doctors(hospital_id);
CREATE INDEX idx_patient_acquisition_hospital ON public.patient_acquisition(hospital_id);
CREATE INDEX idx_patient_acquisition_source ON public.patient_acquisition(hospital_id, source);
CREATE INDEX idx_patient_acquisition_patient ON public.patient_acquisition(patient_id);
CREATE INDEX idx_marketing_campaigns_hospital ON public.marketing_campaigns(hospital_id);
CREATE INDEX idx_online_reviews_hospital ON public.online_reviews(hospital_id);
CREATE INDEX idx_patient_segments_hospital ON public.patient_segments(hospital_id);

-- Validation Triggers
CREATE OR REPLACE FUNCTION public.validate_referral_doctor()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.relationship_tier NOT IN ('platinum','gold','silver','standard') THEN
    RAISE EXCEPTION 'Invalid relationship_tier: %', NEW.relationship_tier;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_validate_referral_doctor BEFORE INSERT OR UPDATE ON public.referral_doctors FOR EACH ROW EXECUTE FUNCTION public.validate_referral_doctor();

CREATE OR REPLACE FUNCTION public.validate_patient_acquisition()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.source NOT IN ('walk_in','referral_doctor','google','practo','justdial','facebook','instagram','whatsapp','camp','corporate','employee_health','other') THEN
    RAISE EXCEPTION 'Invalid source: %', NEW.source;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_validate_patient_acquisition BEFORE INSERT OR UPDATE ON public.patient_acquisition FOR EACH ROW EXECUTE FUNCTION public.validate_patient_acquisition();

CREATE OR REPLACE FUNCTION public.validate_marketing_campaign()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.campaign_type NOT IN ('health_camp','whatsapp_blast','sms','email','social_media','referral_program','corporate','seasonal') THEN
    RAISE EXCEPTION 'Invalid campaign_type: %', NEW.campaign_type;
  END IF;
  IF NEW.status NOT IN ('draft','active','completed','cancelled') THEN
    RAISE EXCEPTION 'Invalid campaign status: %', NEW.status;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_validate_marketing_campaign BEFORE INSERT OR UPDATE ON public.marketing_campaigns FOR EACH ROW EXECUTE FUNCTION public.validate_marketing_campaign();

CREATE OR REPLACE FUNCTION public.validate_online_review()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.platform NOT IN ('google','practo','justdial','facebook','other') THEN
    RAISE EXCEPTION 'Invalid platform: %', NEW.platform;
  END IF;
  IF NEW.rating < 1 OR NEW.rating > 5 THEN
    RAISE EXCEPTION 'rating must be 1-5';
  END IF;
  IF NEW.sentiment IS NOT NULL AND NEW.sentiment NOT IN ('positive','neutral','negative') THEN
    RAISE EXCEPTION 'Invalid sentiment: %', NEW.sentiment;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_validate_online_review BEFORE INSERT OR UPDATE ON public.online_reviews FOR EACH ROW EXECUTE FUNCTION public.validate_online_review();

CREATE OR REPLACE FUNCTION public.validate_patient_segment()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.segment_type NOT IN ('chronic_disease','post_discharge','birthday','high_value','at_risk_churn','inactive','custom') THEN
    RAISE EXCEPTION 'Invalid segment_type: %', NEW.segment_type;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_validate_patient_segment BEFORE INSERT OR UPDATE ON public.patient_segments FOR EACH ROW EXECUTE FUNCTION public.validate_patient_segment();

-- RLS Policies
ALTER TABLE public.referral_doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_acquisition ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital isolation" ON public.referral_doctors FOR ALL USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "Hospital isolation" ON public.patient_acquisition FOR ALL USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "Hospital isolation" ON public.marketing_campaigns FOR ALL USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "Hospital isolation" ON public.online_reviews FOR ALL USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "Hospital isolation" ON public.patient_segments FOR ALL USING (hospital_id = public.get_user_hospital_id());

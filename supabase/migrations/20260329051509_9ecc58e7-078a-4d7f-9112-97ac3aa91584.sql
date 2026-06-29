
-- TABLE 1: icd10_code_sets
CREATE TABLE public.icd10_code_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  set_name text NOT NULL,
  set_type text NOT NULL DEFAULT 'system_default',
  version text,
  description text,
  total_codes integer DEFAULT 0,
  is_active boolean DEFAULT true,
  uploaded_by uuid REFERENCES public.users(id),
  uploaded_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.icd10_code_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital isolation" ON public.icd10_code_sets
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE OR REPLACE FUNCTION public.validate_icd10_code_set()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.set_type NOT IN ('system_default','hospital_uploaded','custom') THEN
    RAISE EXCEPTION 'Invalid set_type: %', NEW.set_type;
  END IF;
  RETURN NEW;
END;$$;

CREATE TRIGGER trg_validate_icd10_code_set
  BEFORE INSERT OR UPDATE ON public.icd10_code_sets
  FOR EACH ROW EXECUTE FUNCTION public.validate_icd10_code_set();

-- TABLE 2: icd10_codes
CREATE TABLE public.icd10_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id),
  code_set_id uuid REFERENCES public.icd10_code_sets(id),
  code text NOT NULL,
  description text NOT NULL,
  category text,
  block text,
  block_desc text,
  chapter text,
  chapter_desc text,
  is_billable boolean DEFAULT true,
  is_header boolean DEFAULT false,
  gender_specific text,
  common_india boolean DEFAULT false,
  use_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.icd10_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read global or own codes" ON public.icd10_codes
  FOR SELECT TO authenticated
  USING (hospital_id IS NULL OR hospital_id = public.get_user_hospital_id());

CREATE POLICY "Manage own codes" ON public.icd10_codes
  FOR INSERT TO authenticated
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Update own codes" ON public.icd10_codes
  FOR UPDATE TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Delete own codes" ON public.icd10_codes
  FOR DELETE TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE OR REPLACE FUNCTION public.validate_icd10_code()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.gender_specific IS NOT NULL AND NEW.gender_specific NOT IN ('male','female') THEN
    RAISE EXCEPTION 'Invalid gender_specific: %', NEW.gender_specific;
  END IF;
  RETURN NEW;
END;$$;

CREATE TRIGGER trg_validate_icd10_code
  BEFORE INSERT OR UPDATE ON public.icd10_codes
  FOR EACH ROW EXECUTE FUNCTION public.validate_icd10_code();

CREATE INDEX IF NOT EXISTS idx_icd10_fts ON public.icd10_codes
  USING gin(to_tsvector('english', code || ' ' || description));
CREATE INDEX IF NOT EXISTS idx_icd10_code ON public.icd10_codes(code);
CREATE INDEX IF NOT EXISTS idx_icd10_common ON public.icd10_codes(common_india, use_count DESC);

-- TABLE 3: hospital_icd_settings
CREATE TABLE public.hospital_icd_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) UNIQUE NOT NULL,
  active_set text DEFAULT 'all',
  show_common_first boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.hospital_icd_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital isolation" ON public.hospital_icd_settings
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE OR REPLACE FUNCTION public.validate_hospital_icd_settings()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.active_set NOT IN ('system_only','hospital_only','all') THEN
    RAISE EXCEPTION 'Invalid active_set: %', NEW.active_set;
  END IF;
  RETURN NEW;
END;$$;

CREATE TRIGGER trg_validate_hospital_icd_settings
  BEFORE INSERT OR UPDATE ON public.hospital_icd_settings
  FOR EACH ROW EXECUTE FUNCTION public.validate_hospital_icd_settings();

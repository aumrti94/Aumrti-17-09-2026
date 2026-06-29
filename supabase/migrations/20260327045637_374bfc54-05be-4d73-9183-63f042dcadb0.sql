-- 1. system_config table for all config-based settings pages
CREATE TABLE IF NOT EXISTS public.system_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  UNIQUE(hospital_id, key)
);
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "system_config_select" ON public.system_config FOR SELECT TO authenticated USING (hospital_id = public.get_user_hospital_id());
CREATE POLICY "system_config_insert" ON public.system_config FOR INSERT TO authenticated WITH CHECK (hospital_id = public.get_user_hospital_id());
CREATE POLICY "system_config_update" ON public.system_config FOR UPDATE TO authenticated USING (hospital_id = public.get_user_hospital_id());

-- 2. consent_templates for consent form management
CREATE TABLE IF NOT EXISTS public.consent_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  form_name text NOT NULL,
  form_type text,
  content text,
  is_active boolean DEFAULT true,
  requires_witness boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.consent_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "consent_templates_all" ON public.consent_templates FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id()) WITH CHECK (hospital_id = public.get_user_hospital_id());

-- 3. clinical_protocols for protocol management
CREATE TABLE IF NOT EXISTS public.clinical_protocols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  protocol_name text NOT NULL,
  category text,
  description text,
  steps jsonb DEFAULT '[]',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.clinical_protocols ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clinical_protocols_all" ON public.clinical_protocols FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id()) WITH CHECK (hospital_id = public.get_user_hospital_id());

-- 4. api_keys for developer API access
CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  key_name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL,
  created_by uuid REFERENCES public.users(id),
  last_used_at timestamptz,
  expires_at date,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "api_keys_all" ON public.api_keys FOR ALL TO authenticated USING (hospital_id = public.get_user_hospital_id()) WITH CHECK (hospital_id = public.get_user_hospital_id());

-- 5. hospitals additions
ALTER TABLE public.hospitals ADD COLUMN IF NOT EXISTS established_year integer;
ALTER TABLE public.hospitals ADD COLUMN IF NOT EXISTS emergency_phone text;
ALTER TABLE public.hospitals ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.hospitals ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.hospitals ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE public.hospitals ADD COLUMN IF NOT EXISTS google_place_id text;
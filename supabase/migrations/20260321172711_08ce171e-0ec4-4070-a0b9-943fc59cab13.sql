
-- Add new columns to hospitals
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS setup_complete boolean NOT NULL DEFAULT false;
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS payment_methods text[] NOT NULL DEFAULT '{cash}';
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS whatsapp_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS wati_api_url text;
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS razorpay_key_id text;

-- Add registration_number to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_number text;

-- Ward type enum
CREATE TYPE ward_type AS ENUM ('general', 'private', 'semi_private', 'icu', 'nicu', 'picu', 'hdu', 'surgical', 'maternity', 'emergency', 'daycare');

-- Wards table
CREATE TABLE wards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  name text NOT NULL,
  type ward_type NOT NULL DEFAULT 'general',
  total_beds integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Bed status enum
CREATE TYPE bed_status AS ENUM ('available', 'occupied', 'reserved', 'maintenance', 'cleaning');

-- Beds table
CREATE TABLE beds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  ward_id uuid NOT NULL REFERENCES wards(id) ON DELETE CASCADE,
  bed_number text NOT NULL,
  status bed_status NOT NULL DEFAULT 'available',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Service master table
CREATE TABLE service_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'consultation',
  fee numeric(10,2) NOT NULL DEFAULT 0,
  follow_up_fee numeric(10,2),
  gst_applicable boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS on new tables (auto-enabled by trigger, but explicit)
ALTER TABLE wards ENABLE ROW LEVEL SECURITY;
ALTER TABLE beds ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_master ENABLE ROW LEVEL SECURITY;

-- Wards policies
CREATE POLICY "Users can view own hospital wards" ON wards FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Admins can manage wards" ON wards FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

-- Beds policies
CREATE POLICY "Users can view own hospital beds" ON beds FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Admins can manage beds" ON beds FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

-- Service master policies
CREATE POLICY "Users can view own hospital services" ON service_master FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Admins can manage services" ON service_master FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

-- Storage bucket for hospital logos
INSERT INTO storage.buckets (id, name, public) VALUES ('hospital-logos', 'hospital-logos', true);

-- Storage policies
CREATE POLICY "Auth users can upload logos" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'hospital-logos');
CREATE POLICY "Public can view logos" ON storage.objects FOR SELECT USING (bucket_id = 'hospital-logos');
CREATE POLICY "Auth users can update logos" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'hospital-logos');
CREATE POLICY "Auth users can delete logos" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'hospital-logos');

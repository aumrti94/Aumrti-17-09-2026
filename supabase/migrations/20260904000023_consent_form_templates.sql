-- Consent form templates stored in DB (previously only in component local state)
CREATE TABLE IF NOT EXISTS consent_form_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) ON DELETE CASCADE,
  name text NOT NULL,
  consent_type text NOT NULL
    CHECK (consent_type IN ('treatment','surgical','anaesthesia','transfusion','hiv','lama','dnr','implant','research','photography')),
  content text,
  witness_required boolean DEFAULT false,
  is_active boolean DEFAULT true,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE consent_form_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation" ON consent_form_templates
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));

CREATE INDEX idx_consent_templates_hospital ON consent_form_templates(hospital_id, is_active);

-- Add admission_id to patient_consents so consents are linked to the specific admission
ALTER TABLE patient_consents ADD COLUMN IF NOT EXISTS admission_id uuid REFERENCES admissions(id);
ALTER TABLE patient_consents ADD COLUMN IF NOT EXISTS witness_name text;
ALTER TABLE patient_consents ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES consent_form_templates(id);


-- ═══════════════════════════════════════
-- COMPLIANCE 1: NDPS Immutability
-- ═══════════════════════════════════════
DROP POLICY IF EXISTS "delete_ndps_register" ON ndps_register;
DROP POLICY IF EXISTS "no_delete_ndps" ON ndps_register;
DROP POLICY IF EXISTS "no_update_ndps" ON ndps_register;

CREATE POLICY "no_delete_ndps" ON ndps_register
  FOR DELETE USING (false);

CREATE POLICY "no_update_ndps" ON ndps_register
  FOR UPDATE USING (false);

-- ═══════════════════════════════════════
-- COMPLIANCE 3: DPDP Act - Patient Consents
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS patient_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) NOT NULL,
  patient_id uuid REFERENCES patients(id) NOT NULL,
  consent_type text NOT NULL,
  consent_given boolean NOT NULL,
  consented_at timestamptz DEFAULT now(),
  ip_address text,
  consent_text text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE patient_consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation_patient_consents" ON patient_consents
  FOR ALL USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "no_update_patient_consents" ON patient_consents
  FOR UPDATE USING (false);

CREATE POLICY "no_delete_patient_consents" ON patient_consents
  FOR DELETE USING (false);

-- ═══════════════════════════════════════
-- COMPLIANCE 4: PCPNDT Form F Immutability
-- ═══════════════════════════════════════
DROP POLICY IF EXISTS "delete_pcpndt" ON pcpndt_form_f;
DROP POLICY IF EXISTS "no_delete_pcpndt" ON pcpndt_form_f;

CREATE POLICY "no_delete_pcpndt" ON pcpndt_form_f
  FOR DELETE USING (false);

-- IMS (Information Management System) compliance tables
-- Satisfies NABH IMS chapter: record retention, access audit, config change tracking

-- ─── 1. Record Retention Policies ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS record_retention_policies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id       UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  record_type       TEXT NOT NULL,      -- 'OPD_Record','IPD_Record','MLC_Record','OT_Record', etc.
  retention_years   INT NOT NULL,
  legal_reference   TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hospital_id, record_type)
);

-- ─── 2. Record Access Logs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS record_access_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  record_type     TEXT,               -- 'OPD_Record','IPD_Record','Lab_Report','Billing', etc.
  record_id       UUID,               -- FK to the relevant record
  accessed_by     UUID REFERENCES users(id),
  accessed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  access_action   TEXT NOT NULL CHECK (access_action IN ('view','download','print','export','share')),
  patient_id      UUID REFERENCES patients(id)
);

-- ─── 3. Configuration Change Logs ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS config_change_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id  UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  config_area  TEXT,           -- 'tariff','role_permissions','clinical_templates','lab_tests', etc.
  item_id      TEXT,
  changed_by   UUID REFERENCES users(id),
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  old_value    JSONB,
  new_value    JSONB,
  reason       TEXT
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_retention_policies_hospital
  ON record_retention_policies(hospital_id);

CREATE INDEX IF NOT EXISTS idx_record_access_logs_hospital
  ON record_access_logs(hospital_id, accessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_record_access_logs_patient
  ON record_access_logs(patient_id, accessed_at DESC)
  WHERE patient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_record_access_logs_type
  ON record_access_logs(hospital_id, record_type, accessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_config_change_logs_hospital
  ON config_change_logs(hospital_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_config_change_logs_area
  ON config_change_logs(hospital_id, config_area, changed_at DESC);

-- ─── Updated-at trigger for retention policies ────────────────────────────────
CREATE OR REPLACE FUNCTION ims_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_retention_policies_updated_at
  BEFORE UPDATE ON record_retention_policies
  FOR EACH ROW EXECUTE FUNCTION ims_set_updated_at();

-- ─── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE record_retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_access_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_change_logs        ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation_retention_policies" ON record_retention_policies
  FOR ALL USING (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "hospital_isolation_record_access_logs" ON record_access_logs
  FOR ALL USING (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "hospital_isolation_config_change_logs" ON config_change_logs
  FOR ALL USING (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  );

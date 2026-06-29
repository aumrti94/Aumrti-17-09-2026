-- Facility Management & Safety (FMS) documentary evidence logs
-- Satisfies NABH FMS chapter requirements for maintenance, calibration, safety rounds, BMW

-- ─── 1. Facility Assets ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS facility_assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  asset_tag       TEXT NOT NULL,
  name            TEXT NOT NULL,
  category        TEXT,           -- 'MRI','OT Table','Lift','DG Set','AC Plant','Fire Extinguisher', etc.
  location        TEXT,
  vendor          TEXT,
  warranty_expiry DATE,
  amc_provider    TEXT,
  amc_expiry      DATE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2. Maintenance & Calibration Logs ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS facility_maintenance_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  asset_id         UUID REFERENCES facility_assets(id) ON DELETE SET NULL,
  maintenance_date DATE NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('preventive','breakdown','calibration','safety_check')),
  description      TEXT,
  performed_by     TEXT,
  status           TEXT NOT NULL DEFAULT 'ok'
                     CHECK (status IN ('ok','observation','defect')),
  next_due_date    DATE,
  document_url     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 3. Safety Rounds ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS safety_rounds (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  round_date          DATE NOT NULL,
  area                TEXT,
  conducted_by        UUID REFERENCES users(id),
  findings            TEXT,
  non_compliances     JSONB NOT NULL DEFAULT '[]'::jsonb,
  corrective_actions  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 4. BMW Manifests ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bmw_manifests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  manifest_date    DATE NOT NULL,
  vendor           TEXT,
  yellow_bag_kg    NUMERIC(8,2) DEFAULT 0,
  red_bag_kg       NUMERIC(8,2) DEFAULT 0,
  blue_bag_kg      NUMERIC(8,2) DEFAULT 0,
  white_bag_kg     NUMERIC(8,2) DEFAULT 0,
  route_sheet_url  TEXT,
  remarks          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_facility_assets_hospital
  ON facility_assets(hospital_id, is_active);

CREATE INDEX IF NOT EXISTS idx_maintenance_logs_hospital
  ON facility_maintenance_logs(hospital_id, maintenance_date DESC);

CREATE INDEX IF NOT EXISTS idx_maintenance_logs_asset
  ON facility_maintenance_logs(asset_id, maintenance_date DESC);

CREATE INDEX IF NOT EXISTS idx_maintenance_logs_due
  ON facility_maintenance_logs(hospital_id, next_due_date)
  WHERE next_due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_safety_rounds_hospital
  ON safety_rounds(hospital_id, round_date DESC);

CREATE INDEX IF NOT EXISTS idx_bmw_manifests_hospital
  ON bmw_manifests(hospital_id, manifest_date DESC);

-- ─── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE facility_assets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE facility_maintenance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_rounds            ENABLE ROW LEVEL SECURITY;
ALTER TABLE bmw_manifests            ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation_facility_assets" ON facility_assets
  FOR ALL USING (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "hospital_isolation_maintenance_logs" ON facility_maintenance_logs
  FOR ALL USING (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "hospital_isolation_safety_rounds" ON safety_rounds
  FOR ALL USING (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "hospital_isolation_bmw_manifests" ON bmw_manifests
  FOR ALL USING (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  );

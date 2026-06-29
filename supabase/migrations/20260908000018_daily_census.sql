-- Daily census snapshots — midnight aggregate of bed occupancy + patient movement
CREATE TABLE IF NOT EXISTS daily_census_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id       UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  snapshot_date     DATE NOT NULL,
  total_beds        INT  NOT NULL DEFAULT 0,
  occupied_beds     INT  NOT NULL DEFAULT 0,
  available_beds    INT  NOT NULL DEFAULT 0,
  maintenance_beds  INT  NOT NULL DEFAULT 0,
  icu_occupied      INT  NOT NULL DEFAULT 0,
  icu_total         INT  NOT NULL DEFAULT 0,
  new_admissions    INT  NOT NULL DEFAULT 0,
  discharges        INT  NOT NULL DEFAULT 0,
  transfers         INT  NOT NULL DEFAULT 0,
  deaths            INT  NOT NULL DEFAULT 0,
  ward_data         JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(hospital_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_census_hospital_date
  ON daily_census_snapshots(hospital_id, snapshot_date DESC);

ALTER TABLE daily_census_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_users_own_census" ON daily_census_snapshots
  FOR ALL USING (
    hospital_id IN (
      SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()
    )
  );

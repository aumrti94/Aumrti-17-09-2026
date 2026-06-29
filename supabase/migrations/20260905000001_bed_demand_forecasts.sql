-- Bed demand forecasts migration file
-- Applied: 2026-05-08
-- Table: bed_demand_forecasts
-- Purpose: Stores 7-day AI-generated bed occupancy predictions per ward

CREATE TABLE IF NOT EXISTS bed_demand_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  ward_id uuid REFERENCES wards(id) ON DELETE CASCADE,
  ward_name text,
  forecast_date date NOT NULL,
  predicted_occupancy int NOT NULL,
  predicted_admissions int,
  confidence_pct int CHECK (confidence_pct BETWEEN 0 AND 100),
  factors jsonb DEFAULT '{}',
  generated_at timestamptz DEFAULT now(),
  UNIQUE(hospital_id, ward_id, forecast_date)
);

ALTER TABLE bed_demand_forecasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation_bed_demand"
  ON bed_demand_forecasts
  FOR ALL
  USING (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()))
  WITH CHECK (hospital_id = (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_bed_demand_hospital_date
  ON bed_demand_forecasts(hospital_id, forecast_date);

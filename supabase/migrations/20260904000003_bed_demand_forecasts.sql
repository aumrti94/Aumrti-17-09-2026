-- Bed demand forecast persistence table
CREATE TABLE IF NOT EXISTS bed_demand_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES hospitals(id) ON DELETE CASCADE,
  ward_id uuid REFERENCES wards(id) ON DELETE CASCADE,
  forecast_date date NOT NULL,
  predicted_admissions int,
  confidence_pct int,
  ai_reasoning text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bed_demand_forecasts_uniq
  ON bed_demand_forecasts(hospital_id, ward_id, forecast_date);

CREATE INDEX IF NOT EXISTS idx_bed_demand_forecasts_hospital
  ON bed_demand_forecasts(hospital_id, forecast_date);

ALTER TABLE bed_demand_forecasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_staff_bed_forecasts" ON bed_demand_forecasts
  FOR ALL USING (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  );

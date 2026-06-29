
-- Add missing clinical columns to dialysis_sessions
ALTER TABLE dialysis_sessions
  ADD COLUMN IF NOT EXISTS scheduled_start text,
  ADD COLUMN IF NOT EXISTS pre_pulse integer,
  ADD COLUMN IF NOT EXISTS pre_temp numeric,
  ADD COLUMN IF NOT EXISTS blood_flow_rate_ml integer DEFAULT 300,
  ADD COLUMN IF NOT EXISTS dialysate_flow_rate integer DEFAULT 500,
  ADD COLUMN IF NOT EXISTS heparin_dose_units integer,
  ADD COLUMN IF NOT EXISTS dialyzer_id text,
  ADD COLUMN IF NOT EXISTS post_pulse integer,
  ADD COLUMN IF NOT EXISTS urea_pre numeric,
  ADD COLUMN IF NOT EXISTS urea_post numeric,
  ADD COLUMN IF NOT EXISTS session_notes text;

-- Add model column alias check - dialysis_machines already has 'model' column
-- The code references make_model but DB has 'model' - we'll fix in code

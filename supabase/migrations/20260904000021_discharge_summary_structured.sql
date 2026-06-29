-- Structured discharge summary JSON and explicit discharge type on admissions
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS discharge_summary_json jsonb;

ALTER TABLE admissions ADD COLUMN IF NOT EXISTS discharge_type text
  DEFAULT 'regular'
  CHECK (discharge_type IN ('regular','lama','expired','transfer','daycare'));

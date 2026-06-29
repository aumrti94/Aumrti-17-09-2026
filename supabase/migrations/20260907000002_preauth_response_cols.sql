-- Add missing columns for TPA response recording on pre-auth
ALTER TABLE insurance_pre_auth ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE insurance_pre_auth ADD COLUMN IF NOT EXISTS denial_reason text;
ALTER TABLE insurance_pre_auth ADD COLUMN IF NOT EXISTS mlc_number text;

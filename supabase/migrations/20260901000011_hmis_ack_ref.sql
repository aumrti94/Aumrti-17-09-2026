-- Add acknowledgment reference tracking to HMIS reports
ALTER TABLE hmis_reports ADD COLUMN IF NOT EXISTS acknowledgment_ref text;
ALTER TABLE hmis_reports ADD COLUMN IF NOT EXISTS portal_submission_id text;

COMMENT ON COLUMN hmis_reports.acknowledgment_ref IS 'Acknowledgment number returned by MoHFW IHIP portal on successful submission';
COMMENT ON COLUMN hmis_reports.portal_submission_id IS 'Internal submission ID from portal API response';

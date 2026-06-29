-- Preferred patient-facing languages per hospital
-- Used to filter language choices in discharge instructions, OPD print, and WhatsApp reminders

ALTER TABLE hospitals
  ADD COLUMN IF NOT EXISTS patient_languages JSONB DEFAULT '["English"]'::jsonb;

-- Back-fill existing hospitals with the default
UPDATE hospitals
   SET patient_languages = '["English"]'::jsonb
 WHERE patient_languages IS NULL;

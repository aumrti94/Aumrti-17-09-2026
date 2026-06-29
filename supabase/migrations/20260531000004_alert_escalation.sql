-- ============================================================
-- ALERT ESCALATION SYSTEM
-- Unacknowledged critical clinical alerts → SMS + email
-- ============================================================

-- Escalation rules per hospital (which roles/contacts to notify)
CREATE TABLE IF NOT EXISTS alert_escalation_rules (
  id               uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id      uuid    NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  alert_type       text,   -- null = all types; or specific type like "critical_radiology"
  severity         text    NOT NULL DEFAULT 'critical',  -- critical | high
  escalate_after_minutes int NOT NULL DEFAULT 15,        -- SLA before escalation fires
  escalation_channels text[] NOT NULL DEFAULT ARRAY['sms','email'],
  notify_roles    text[] NOT NULL DEFAULT ARRAY['doctor','admin'],
    -- roles to notify: doctor, nurse, admin, radiologist, lab_tech, pharmacist
  notify_user_ids uuid[],  -- specific user overrides
  sms_numbers     text[],  -- direct phone numbers (for on-call)
  email_addresses text[],  -- direct emails (for on-call)
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz DEFAULT now()
);

ALTER TABLE alert_escalation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alert_escalation_rules_hospital" ON alert_escalation_rules
  FOR ALL USING (hospital_id = get_user_hospital_id());

-- Escalation event log
CREATE TABLE IF NOT EXISTS alert_escalation_log (
  id               uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id      uuid    NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  alert_id         uuid    NOT NULL REFERENCES clinical_alerts(id) ON DELETE CASCADE,
  rule_id          uuid    REFERENCES alert_escalation_rules(id) ON DELETE SET NULL,
  channel          text    NOT NULL,     -- sms | email
  recipient        text    NOT NULL,     -- phone number or email
  message_body     text    NOT NULL,
  status           text    NOT NULL DEFAULT 'sent',  -- sent | failed | delivered
  provider_ref     text,                -- Twilio SID or SMTP message-id
  sent_at          timestamptz DEFAULT now()
);

ALTER TABLE alert_escalation_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alert_escalation_log_hospital" ON alert_escalation_log
  FOR ALL USING (hospital_id = get_user_hospital_id());

CREATE INDEX IF NOT EXISTS escalation_log_alert_idx ON alert_escalation_log (alert_id);
CREATE INDEX IF NOT EXISTS escalation_log_hospital_idx ON alert_escalation_log (hospital_id);

-- Add escalated_at to clinical_alerts (if column not yet present)
ALTER TABLE clinical_alerts
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalation_count int NOT NULL DEFAULT 0;

-- ============================================================
-- LAB ANALYZER MACHINE INTERFACE
-- Builds out the lab_device_connectors stub into a full
-- bidirectional HL7 / ASTM / LIS interface table set.
-- ============================================================

-- Fully populate lab_device_connectors (extends the stub)
ALTER TABLE lab_device_connectors
  ADD COLUMN IF NOT EXISTS device_name          text,
  ADD COLUMN IF NOT EXISTS manufacturer         text,
  ADD COLUMN IF NOT EXISTS model                text,
  ADD COLUMN IF NOT EXISTS serial_number        text,
  ADD COLUMN IF NOT EXISTS protocol             text    NOT NULL DEFAULT 'hl7_mllp',
    -- hl7_mllp | astm_e1381 | astm_e1394 | tcp_raw | serial_rs232
  ADD COLUMN IF NOT EXISTS host                 text,     -- IP or hostname of the analyzer
  ADD COLUMN IF NOT EXISTS port                 int,      -- TCP port (default 2575 for MLLP)
  ADD COLUMN IF NOT EXISTS is_bidirectional     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS hl7_sending_facility text,    -- MSH-4
  ADD COLUMN IF NOT EXISTS hl7_receiving_app    text,    -- MSH-5
  ADD COLUMN IF NOT EXISTS auto_validate        boolean NOT NULL DEFAULT false,
    -- when true, validated results are auto-posted without manual review
  ADD COLUMN IF NOT EXISTS last_connected_at    timestamptz,
  ADD COLUMN IF NOT EXISTS last_result_at       timestamptz,
  ADD COLUMN IF NOT EXISTS result_count         int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active            boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at           timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at           timestamptz DEFAULT now();

-- Analyzer result inbox: raw messages received from analyzers
CREATE TABLE IF NOT EXISTS lab_analyzer_messages (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id     uuid        NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  device_id       uuid        REFERENCES lab_device_connectors(id) ON DELETE SET NULL,

  -- Raw message payload
  protocol        text        NOT NULL,   -- hl7_mllp | astm_e1381 | astm_e1394
  raw_message     text        NOT NULL,   -- full raw message text for audit
  message_type    text,                   -- HL7 MSH-9 (e.g. ORU^R01), or ASTM H record

  -- Parsed fields
  patient_id_external text,              -- PID-3 (may map to UHID)
  accession_number    text,              -- OBR-3 / ASTM order number → links to lab_orders
  order_item_id       uuid REFERENCES lab_order_items(id) ON DELETE SET NULL,

  -- Processing state
  status          text        NOT NULL DEFAULT 'pending',
    -- pending | matched | posted | error | ignored
  match_confidence text,                 -- high | medium | low | unmatched
  error_reason    text,
  processed_at    timestamptz,
  posted_by       uuid REFERENCES users(id),

  received_at     timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE lab_analyzer_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab_analyzer_messages_hospital" ON lab_analyzer_messages
  FOR ALL USING (hospital_id = get_user_hospital_id());

CREATE INDEX IF NOT EXISTS lab_analyzer_msg_hospital_idx  ON lab_analyzer_messages (hospital_id);
CREATE INDEX IF NOT EXISTS lab_analyzer_msg_status_idx    ON lab_analyzer_messages (status);
CREATE INDEX IF NOT EXISTS lab_analyzer_msg_accession_idx ON lab_analyzer_messages (accession_number);
CREATE INDEX IF NOT EXISTS lab_analyzer_msg_device_idx    ON lab_analyzer_messages (device_id);
CREATE INDEX IF NOT EXISTS lab_analyzer_msg_received_idx  ON lab_analyzer_messages (received_at DESC);

-- Per-device test code mapping (analyzer code → lab_test_master)
CREATE TABLE IF NOT EXISTS lab_analyzer_test_mappings (
  id              uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id     uuid    NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  device_id       uuid    NOT NULL REFERENCES lab_device_connectors(id) ON DELETE CASCADE,
  analyzer_code   text    NOT NULL,   -- the LOINC / proprietary code the analyzer sends
  analyzer_name   text,               -- human-readable test name from analyzer
  test_id         uuid    REFERENCES lab_test_master(id) ON DELETE SET NULL,
  unit_transform  numeric DEFAULT 1,  -- multiply analyzer value by this factor
  created_at      timestamptz DEFAULT now(),
  UNIQUE (device_id, analyzer_code)
);

ALTER TABLE lab_analyzer_test_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab_analyzer_test_mappings_hospital" ON lab_analyzer_test_mappings
  FOR ALL USING (hospital_id = get_user_hospital_id());

CREATE INDEX IF NOT EXISTS lab_test_mappings_device_idx ON lab_analyzer_test_mappings (device_id);

-- RLS on lab_device_connectors (may already have it; safe to re-add)
ALTER TABLE lab_device_connectors ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'lab_device_connectors'
      AND policyname = 'lab_device_connectors_hospital'
  ) THEN
    CREATE POLICY "lab_device_connectors_hospital" ON lab_device_connectors
      FOR ALL USING (hospital_id = get_user_hospital_id());
  END IF;
END
$$;

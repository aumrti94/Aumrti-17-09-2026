-- Track billing status on OT schedules
ALTER TABLE ot_schedules
  ADD COLUMN IF NOT EXISTS billed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS bill_id uuid REFERENCES bills(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS surgeon_fee numeric(10,2),
  ADD COLUMN IF NOT EXISTS anaesthetist_fee numeric(10,2),
  ADD COLUMN IF NOT EXISTS ot_charge numeric(10,2);

-- Seed default OT service rates into service_master (won't overwrite existing rows)
-- Hospitals can adjust these in Settings → Service Master
INSERT INTO service_master (hospital_id, name, item_type, fee, gst_applicable, gst_percent, hsn_code, is_active)
SELECT h.id, 'OT Facility Charge (per hour)', 'ot_charge', 2000, true, 5, '999315', true
FROM hospitals h
WHERE NOT EXISTS (
  SELECT 1 FROM service_master sm WHERE sm.hospital_id = h.id AND sm.item_type = 'ot_charge'
);

INSERT INTO service_master (hospital_id, name, item_type, fee, gst_applicable, gst_percent, hsn_code, is_active)
SELECT h.id, 'Surgeon Fee', 'surgeon_fee', 5000, true, 5, '999316', true
FROM hospitals h
WHERE NOT EXISTS (
  SELECT 1 FROM service_master sm WHERE sm.hospital_id = h.id AND sm.item_type = 'surgeon_fee'
);

INSERT INTO service_master (hospital_id, name, item_type, fee, gst_applicable, gst_percent, hsn_code, is_active)
SELECT h.id, 'Anaesthesia Fee', 'anaesthesia_fee', 1500, true, 5, '999317', true
FROM hospitals h
WHERE NOT EXISTS (
  SELECT 1 FROM service_master sm WHERE sm.hospital_id = h.id AND sm.item_type = 'anaesthesia_fee'
);

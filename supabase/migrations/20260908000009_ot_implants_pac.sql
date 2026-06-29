-- OT Implants: relational table for surgical implants used in OT cases
CREATE TABLE IF NOT EXISTS ot_implants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID REFERENCES hospitals(id),
  schedule_id UUID REFERENCES ot_schedules(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  catalogue_number TEXT,
  manufacturer TEXT,
  lot_number TEXT,
  expiry_date DATE,
  unit_cost NUMERIC(10,2) DEFAULT 0,
  quantity INTEGER DEFAULT 1,
  billed BOOLEAN DEFAULT FALSE,
  billing_item_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_ot_implants_schedule ON ot_implants(schedule_id);
CREATE INDEX IF NOT EXISTS idx_ot_implants_hospital ON ot_implants(hospital_id);

ALTER TABLE ot_implants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hospital_isolation" ON ot_implants
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

-- OT Consumables: relational table for surgical consumables used in OT cases
CREATE TABLE IF NOT EXISTS ot_consumables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID REFERENCES hospitals(id),
  schedule_id UUID REFERENCES ot_schedules(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  item_code TEXT,
  unit TEXT DEFAULT 'pcs',
  unit_cost NUMERIC(10,2) DEFAULT 0,
  quantity INTEGER DEFAULT 1,
  billed BOOLEAN DEFAULT FALSE,
  billing_item_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_ot_consumables_schedule ON ot_consumables(schedule_id);
CREATE INDEX IF NOT EXISTS idx_ot_consumables_hospital ON ot_consumables(hospital_id);

ALTER TABLE ot_consumables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hospital_isolation" ON ot_consumables
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

-- PAC (Pre-Anaesthesia Check) columns on ot_schedules
ALTER TABLE ot_schedules ADD COLUMN IF NOT EXISTS pac_done BOOLEAN DEFAULT FALSE;
ALTER TABLE ot_schedules ADD COLUMN IF NOT EXISTS pac_done_by UUID REFERENCES users(id);
ALTER TABLE ot_schedules ADD COLUMN IF NOT EXISTS pac_done_at TIMESTAMPTZ;
ALTER TABLE ot_schedules ADD COLUMN IF NOT EXISTS pac_notes TEXT;
ALTER TABLE ot_schedules ADD COLUMN IF NOT EXISTS pac_cleared BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_ot_schedules_pac_cleared ON ot_schedules(pac_cleared) WHERE pac_cleared = FALSE;

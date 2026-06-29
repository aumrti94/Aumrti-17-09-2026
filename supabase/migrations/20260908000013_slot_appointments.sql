-- Slot-based appointment scheduling
CREATE TABLE IF NOT EXISTS doctor_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID REFERENCES hospitals(id),
  doctor_id UUID REFERENCES users(id),
  department_id UUID REFERENCES departments(id),
  slot_date DATE NOT NULL,
  slot_time TIME NOT NULL,
  slot_duration_mins INT DEFAULT 15,
  max_patients INT DEFAULT 1,
  booked_count INT DEFAULT 0,
  slot_type TEXT DEFAULT 'opd' CHECK (slot_type IN ('opd','review','procedure','teleconsult')),
  is_blocked BOOLEAN DEFAULT FALSE,
  block_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_doctor_slots_unique
  ON doctor_slots(hospital_id, doctor_id, slot_date, slot_time);
CREATE INDEX IF NOT EXISTS idx_doctor_slots_date ON doctor_slots(slot_date, hospital_id);
CREATE INDEX IF NOT EXISTS idx_doctor_slots_doctor ON doctor_slots(doctor_id, slot_date);

ALTER TABLE doctor_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hospital_isolation" ON doctor_slots
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

-- Enhance appointments table (add columns that may not yet exist)
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS slot_id UUID REFERENCES doctor_slots(id);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS booking_source TEXT DEFAULT 'front_desk';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS appointment_type TEXT DEFAULT 'opd';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date, hospital_id);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor ON appointments(doctor_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_reminder
  ON appointments(appointment_date, reminder_sent, hospital_id);

-- Link opd_tokens back to the appointment that generated it
ALTER TABLE opd_tokens ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES appointments(id);

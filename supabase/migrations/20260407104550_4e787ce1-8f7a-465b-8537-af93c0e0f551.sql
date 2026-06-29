CREATE TABLE IF NOT EXISTS nursing_procedures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  admission_id UUID REFERENCES admissions(id),
  encounter_id UUID,
  procedure_name TEXT NOT NULL,
  procedure_type TEXT NOT NULL DEFAULT 'general',
  quantity INTEGER DEFAULT 1,
  performed_by UUID REFERENCES users(id),
  performed_at TIMESTAMPTZ DEFAULT now(),
  notes TEXT,
  billed BOOLEAN DEFAULT false,
  bill_id UUID REFERENCES bills(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE nursing_procedures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own hospital nursing procedures"
  ON nursing_procedures FOR ALL USING (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  );
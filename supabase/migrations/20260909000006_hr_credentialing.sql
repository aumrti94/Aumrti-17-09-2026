-- HR Credentialing, Privileging & Training Evidence
-- Satisfies NABH HRM.2 (credentials), HRM.3 (privileges), HRM.4 (training/CME)

-- ─── 1. Extend staff_credentials ─────────────────────────────────────────────
ALTER TABLE staff_credentials
  ADD COLUMN IF NOT EXISTS name          TEXT,
  ADD COLUMN IF NOT EXISTS verified_by   UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS verified_at   TIMESTAMPTZ;

-- ─── 2. Staff Privileges ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_privileges (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id       UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id     UUID REFERENCES departments(id),
  privilege_scope   TEXT NOT NULL,           -- 'General Surgery - Level I', 'Anaesthesia - ASA I-II', etc.
  privilege_details TEXT,
  granted_by        UUID REFERENCES users(id),
  granted_at        TIMESTAMPTZ DEFAULT NOW(),
  review_due_date   DATE,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 3. Training Records ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_training_records (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  training_title   TEXT NOT NULL,
  training_type    TEXT,    -- 'Orientation','Induction','Fire Safety','BLS','ALS','NABH','Infection Control','Waste Management','Other'
  provider         TEXT,
  start_date       DATE,
  end_date         DATE,
  hours            NUMERIC(5,2),
  certificate_url  TEXT,
  assessment_score NUMERIC(5,2),
  completed        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_staff_privileges_user
  ON staff_privileges(user_id, active);

CREATE INDEX IF NOT EXISTS idx_staff_privileges_hospital
  ON staff_privileges(hospital_id, review_due_date);

CREATE INDEX IF NOT EXISTS idx_training_records_user
  ON staff_training_records(user_id, end_date DESC);

CREATE INDEX IF NOT EXISTS idx_training_records_hospital
  ON staff_training_records(hospital_id, training_type);

-- ─── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE staff_privileges       ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_training_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation_privileges" ON staff_privileges
  FOR ALL USING (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "hospital_isolation_training" ON staff_training_records
  FOR ALL USING (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  );

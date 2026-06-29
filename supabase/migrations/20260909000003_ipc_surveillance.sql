-- IPC Surveillance, Device Days & Bundle Compliance
-- Satisfies NABH HIC chapter requirements for device-associated infection tracking

-- ─── 1. Device usage per admission ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ipc_device_usage (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  admission_id        UUID NOT NULL REFERENCES admissions(id) ON DELETE CASCADE,
  patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  ward_id             UUID REFERENCES wards(id),
  device_type         TEXT NOT NULL CHECK (device_type IN (
                        'central_line','peripheral_line','urinary_catheter',
                        'ventilator','tracheostomy','others'
                      )),
  device_inserted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  device_removed_at   TIMESTAMPTZ,
  inserted_by         UUID REFERENCES users(id),
  removed_by          UUID REFERENCES users(id),
  insertion_site      TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2. Healthcare-associated infection events (HAIs) ─────────────────────────
CREATE TABLE IF NOT EXISTS ipc_infection_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  admission_id        UUID REFERENCES admissions(id),
  patient_id          UUID REFERENCES patients(id),
  infection_type      TEXT NOT NULL CHECK (infection_type IN (
                        'CLABSI','CAUTI','VAP','SSI','BSI','CDI','MDRO','other'
                      )),
  onset_date          DATE NOT NULL,
  ward_id             UUID REFERENCES wards(id),
  organism            TEXT,
  sensitivity_pattern TEXT,
  lab_order_id        UUID REFERENCES lab_orders(id),
  is_device_related   BOOLEAN NOT NULL DEFAULT FALSE,
  device_usage_id     UUID REFERENCES ipc_device_usage(id),
  outcome             TEXT CHECK (outcome IN ('recovered','transferred','expired','ongoing','unknown')),
  notes               TEXT,
  reported_by         UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 3. Bundle compliance checklists ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ipc_bundle_checklists (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  admission_id        UUID NOT NULL REFERENCES admissions(id) ON DELETE CASCADE,
  patient_id          UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  device_usage_id     UUID REFERENCES ipc_device_usage(id),
  device_type         TEXT NOT NULL,
  bundle_type         TEXT NOT NULL CHECK (bundle_type IN ('insert','maintenance','removal')),
  checklist_date      DATE NOT NULL,
  completed_by        UUID REFERENCES users(id),
  elements            JSONB NOT NULL DEFAULT '{}'::jsonb,
  compliance_pct      NUMERIC(5,2),              -- computed by app before insert (true_count/total*100)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ipc_device_hospital
  ON ipc_device_usage(hospital_id, device_inserted_at DESC);

CREATE INDEX IF NOT EXISTS idx_ipc_device_admission
  ON ipc_device_usage(admission_id, device_type);

CREATE INDEX IF NOT EXISTS idx_ipc_device_active
  ON ipc_device_usage(hospital_id, device_type) WHERE device_removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ipc_infection_hospital
  ON ipc_infection_events(hospital_id, onset_date DESC);

CREATE INDEX IF NOT EXISTS idx_ipc_infection_type
  ON ipc_infection_events(hospital_id, infection_type, onset_date);

CREATE INDEX IF NOT EXISTS idx_ipc_bundle_admission
  ON ipc_bundle_checklists(admission_id, device_type, checklist_date DESC);

CREATE INDEX IF NOT EXISTS idx_ipc_bundle_hospital
  ON ipc_bundle_checklists(hospital_id, checklist_date DESC);

-- ─── Updated-at triggers ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ipc_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_ipc_device_updated_at
  BEFORE UPDATE ON ipc_device_usage
  FOR EACH ROW EXECUTE FUNCTION ipc_set_updated_at();

CREATE TRIGGER trg_ipc_infection_updated_at
  BEFORE UPDATE ON ipc_infection_events
  FOR EACH ROW EXECUTE FUNCTION ipc_set_updated_at();

-- ─── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE ipc_device_usage        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ipc_infection_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ipc_bundle_checklists   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation_ipc_device" ON ipc_device_usage
  FOR ALL USING (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "hospital_isolation_ipc_events" ON ipc_infection_events
  FOR ALL USING (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "hospital_isolation_ipc_bundle" ON ipc_bundle_checklists
  FOR ALL USING (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  );

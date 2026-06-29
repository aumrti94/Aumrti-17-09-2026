-- Unified Safety Events, RCA & CAPA
-- Satisfies NABH QPS (incident reporting), PSQ, PRE (complaints), ROM (governance)

-- ─── 1. Safety Events ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS safety_events (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id             UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  event_number            TEXT NOT NULL,          -- EV-YYYY-####
  event_type              TEXT NOT NULL CHECK (event_type IN (
                            'incident','near_miss','sentinel','complaint',
                            'grievance','legal_notice','claim'
                          )),
  category                TEXT CHECK (category IN (
                            'fall','medication_error','surgery','lab','billing',
                            'behaviour','privacy','equipment','infection','other'
                          )),
  severity                TEXT CHECK (severity IN (
                            'no_harm','mild','moderate','severe','death'
                          )),
  reported_by             UUID REFERENCES users(id),
  reported_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  department_id           UUID REFERENCES departments(id),
  location                TEXT,
  patient_id              UUID REFERENCES patients(id),
  admission_id            UUID REFERENCES admissions(id),
  description             TEXT NOT NULL,
  immediate_action_taken  TEXT,
  status                  TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
                            'open','under_investigation','action_planned','closed'
                          )),
  linked_nabh_standard_id UUID REFERENCES nabh_standards(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hospital_id, event_number)
);

-- ─── 2. Root Cause Analysis ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS safety_event_rca (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  safety_event_id     UUID NOT NULL REFERENCES safety_events(id) ON DELETE CASCADE,
  methodology         TEXT CHECK (methodology IN ('5_whys','fishbone','fmea','other')),
  rca_summary         TEXT,
  contributing_factors JSONB DEFAULT '{"people":"","process":"","equipment":"","environment":""}'::jsonb,
  ai_draft_used       BOOLEAN DEFAULT FALSE,     -- tracks if AI draft was used + attested
  completed_by        UUID REFERENCES users(id),
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (safety_event_id)                       -- one RCA per event
);

-- ─── 3. Corrective & Preventive Actions ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS safety_event_capa (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  safety_event_id       UUID NOT NULL REFERENCES safety_events(id) ON DELETE CASCADE,
  action_type           TEXT NOT NULL CHECK (action_type IN ('corrective','preventive')),
  action_description    TEXT NOT NULL,
  responsible_owner_id  UUID REFERENCES users(id),
  due_date              DATE,
  status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
                          'open','in_progress','completed','cancelled'
                        )),
  completed_at          TIMESTAMPTZ,
  effectiveness_review  TEXT,
  ai_suggested          BOOLEAN DEFAULT FALSE,    -- tracks AI-suggested actions
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_safety_events_hospital
  ON safety_events(hospital_id, reported_at DESC);

CREATE INDEX IF NOT EXISTS idx_safety_events_type
  ON safety_events(hospital_id, event_type, status);

CREATE INDEX IF NOT EXISTS idx_safety_events_patient
  ON safety_events(patient_id) WHERE patient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_safety_event_rca_event
  ON safety_event_rca(safety_event_id);

CREATE INDEX IF NOT EXISTS idx_safety_event_capa_event
  ON safety_event_capa(safety_event_id);

CREATE INDEX IF NOT EXISTS idx_safety_event_capa_status
  ON safety_event_capa(safety_event_id, status);

-- ─── Updated-at triggers ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION safety_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_safety_events_updated_at
  BEFORE UPDATE ON safety_events
  FOR EACH ROW EXECUTE FUNCTION safety_set_updated_at();

CREATE TRIGGER trg_safety_rca_updated_at
  BEFORE UPDATE ON safety_event_rca
  FOR EACH ROW EXECUTE FUNCTION safety_set_updated_at();

CREATE TRIGGER trg_safety_capa_updated_at
  BEFORE UPDATE ON safety_event_capa
  FOR EACH ROW EXECUTE FUNCTION safety_set_updated_at();

-- ─── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE safety_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_event_rca  ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_event_capa ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation_safety_events" ON safety_events
  FOR ALL USING (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "hospital_isolation_safety_rca" ON safety_event_rca
  FOR ALL USING (
    safety_event_id IN (
      SELECT id FROM safety_events
      WHERE hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
    )
  )
  WITH CHECK (
    safety_event_id IN (
      SELECT id FROM safety_events
      WHERE hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
    )
  );

CREATE POLICY "hospital_isolation_safety_capa" ON safety_event_capa
  FOR ALL USING (
    safety_event_id IN (
      SELECT id FROM safety_events
      WHERE hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
    )
  )
  WITH CHECK (
    safety_event_id IN (
      SELECT id FROM safety_events
      WHERE hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
    )
  );

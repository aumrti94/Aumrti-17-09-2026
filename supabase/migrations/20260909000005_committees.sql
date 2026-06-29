-- Governance & Committees
-- Satisfies NABH HRM/ROM chapter requirements for formal committee governance

-- ─── 1. Committees ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hospital_committees (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,           -- 'Quality & Safety', 'IPC', 'OT', 'P&T', etc.
  description     TEXT,
  chairperson_id  UUID REFERENCES users(id),
  secretary_id    UUID REFERENCES users(id),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2. Committee Members ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS committee_members (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id   UUID NOT NULL REFERENCES hospital_committees(id) ON DELETE CASCADE,
  user_id        UUID REFERENCES users(id),   -- NULL for external members
  member_name    TEXT,                         -- for non-HMS-user members
  member_role    TEXT,                         -- 'Member','Invitee','Advisor'
  designation    TEXT,                         -- 'Medical Superintendent','Nursing Head'
  is_core_member BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 3. Meetings ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS committee_meetings (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  committee_id           UUID NOT NULL REFERENCES hospital_committees(id) ON DELETE CASCADE,
  meeting_date           DATE NOT NULL,
  venue                  TEXT,
  quorum_met             BOOLEAN DEFAULT TRUE,
  agenda                 TEXT,
  minutes                TEXT,
  nabh_chapters_covered  TEXT[] DEFAULT '{}', -- e.g. {'AAC','HIC','QPS'}
  ai_minutes_used        BOOLEAN DEFAULT FALSE,
  created_by             UUID REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 4. Action Items ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS committee_action_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id           UUID NOT NULL REFERENCES committee_meetings(id) ON DELETE CASCADE,
  description          TEXT NOT NULL,
  responsible_owner_id UUID REFERENCES users(id),
  owner_name           TEXT,           -- for non-HMS-user owners
  due_date             DATE,
  status               TEXT NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open','in_progress','completed','deferred','cancelled')),
  completion_notes     TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_committees_hospital
  ON hospital_committees(hospital_id, is_active);

CREATE INDEX IF NOT EXISTS idx_committee_members_committee
  ON committee_members(committee_id);

CREATE INDEX IF NOT EXISTS idx_committee_meetings_committee
  ON committee_meetings(committee_id, meeting_date DESC);

CREATE INDEX IF NOT EXISTS idx_committee_actions_meeting
  ON committee_action_items(meeting_id);

CREATE INDEX IF NOT EXISTS idx_committee_actions_status
  ON committee_action_items(status) WHERE status IN ('open','in_progress');

-- ─── Updated-at triggers ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION committee_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_committee_meetings_updated_at
  BEFORE UPDATE ON committee_meetings
  FOR EACH ROW EXECUTE FUNCTION committee_set_updated_at();

CREATE TRIGGER trg_committee_actions_updated_at
  BEFORE UPDATE ON committee_action_items
  FOR EACH ROW EXECUTE FUNCTION committee_set_updated_at();

-- ─── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE hospital_committees     ENABLE ROW LEVEL SECURITY;
ALTER TABLE committee_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE committee_meetings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE committee_action_items  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation_committees" ON hospital_committees
  FOR ALL USING (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "hospital_isolation_committee_members" ON committee_members
  FOR ALL USING (
    committee_id IN (
      SELECT id FROM hospital_committees
      WHERE hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
    )
  )
  WITH CHECK (
    committee_id IN (
      SELECT id FROM hospital_committees
      WHERE hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
    )
  );

CREATE POLICY "hospital_isolation_committee_meetings" ON committee_meetings
  FOR ALL USING (
    committee_id IN (
      SELECT id FROM hospital_committees
      WHERE hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
    )
  )
  WITH CHECK (
    committee_id IN (
      SELECT id FROM hospital_committees
      WHERE hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
    )
  );

CREATE POLICY "hospital_isolation_committee_actions" ON committee_action_items
  FOR ALL USING (
    meeting_id IN (
      SELECT cm.id FROM committee_meetings cm
      JOIN hospital_committees hc ON hc.id = cm.committee_id
      WHERE hc.hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
    )
  )
  WITH CHECK (
    meeting_id IN (
      SELECT cm.id FROM committee_meetings cm
      JOIN hospital_committees hc ON hc.id = cm.committee_id
      WHERE hc.hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
    )
  );

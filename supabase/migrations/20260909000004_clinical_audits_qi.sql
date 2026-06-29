-- Clinical Audits & QI Projects
-- Satisfies NABH QPS.7 (periodic clinical audit) and QPS.8 (QI projects / PDSA)

-- ─── 1. Clinical Audits ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clinical_audits (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id             UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  title                   TEXT NOT NULL,
  department_id           UUID REFERENCES departments(id),
  objective               TEXT NOT NULL,
  standard_criteria       TEXT NOT NULL,
  data_source             TEXT,                     -- e.g. 'OPD Prescriptions', 'Lab TAT'
  sample_method           TEXT CHECK (sample_method IN ('random','consecutive','all')),
  sample_size             INT,
  period_from             DATE,
  period_to               DATE,
  created_by              UUID REFERENCES users(id),
  status                  TEXT NOT NULL DEFAULT 'planning'
                            CHECK (status IN ('planning','data_collection','analysis','action','closed')),
  linked_nabh_standard_id UUID REFERENCES nabh_standards(id),
  conclusion              TEXT,                     -- free-text committee conclusion
  ai_summary              TEXT,                     -- AI-generated narrative (attested)
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2. Audit Sample Records ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clinical_audit_samples (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id         UUID NOT NULL REFERENCES clinical_audits(id) ON DELETE CASCADE,
  reference_id     UUID,                            -- FK to source record (opd_token, admission, etc.)
  reference_module TEXT,                            -- 'OPD','IPD','Lab','OT','Billing'
  is_compliant     BOOLEAN,                         -- NULL = pending review
  remarks          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 3. QI Projects ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qi_projects (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id             UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  title                   TEXT NOT NULL,
  problem_statement       TEXT NOT NULL,
  aim_statement           TEXT NOT NULL,
  baseline_metric         TEXT,
  baseline_value          NUMERIC,
  target_metric           TEXT,
  target_value            NUMERIC,
  current_value           NUMERIC,                  -- updated as cycles complete
  start_date              DATE,
  end_date                DATE,
  project_owner_id        UUID REFERENCES users(id),
  status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','completed','abandoned')),
  linked_nabh_standard_id UUID REFERENCES nabh_standards(id),
  source_audit_id         UUID REFERENCES clinical_audits(id),  -- if project came from audit finding
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 4. PDSA Cycles ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qi_cycles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qi_project_id  UUID NOT NULL REFERENCES qi_projects(id) ON DELETE CASCADE,
  cycle_label    TEXT NOT NULL DEFAULT 'PDSA 1',
  plan           TEXT,
  do_action      TEXT,                              -- 'do' is reserved in SQL; named do_action
  study          TEXT,
  act            TEXT,
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_clinical_audits_hospital
  ON clinical_audits(hospital_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_clinical_audits_status
  ON clinical_audits(hospital_id, status);

CREATE INDEX IF NOT EXISTS idx_audit_samples_audit
  ON clinical_audit_samples(audit_id);

CREATE INDEX IF NOT EXISTS idx_qi_projects_hospital
  ON qi_projects(hospital_id, status);

CREATE INDEX IF NOT EXISTS idx_qi_cycles_project
  ON qi_cycles(qi_project_id, created_at);

-- ─── Updated-at triggers ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION qa_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_clinical_audits_updated_at
  BEFORE UPDATE ON clinical_audits
  FOR EACH ROW EXECUTE FUNCTION qa_set_updated_at();

CREATE TRIGGER trg_qi_projects_updated_at
  BEFORE UPDATE ON qi_projects
  FOR EACH ROW EXECUTE FUNCTION qa_set_updated_at();

-- ─── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE clinical_audits        ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_audit_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE qi_projects            ENABLE ROW LEVEL SECURITY;
ALTER TABLE qi_cycles              ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_isolation_clinical_audits" ON clinical_audits
  FOR ALL USING (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "hospital_isolation_audit_samples" ON clinical_audit_samples
  FOR ALL USING (
    audit_id IN (
      SELECT id FROM clinical_audits
      WHERE hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
    )
  )
  WITH CHECK (
    audit_id IN (
      SELECT id FROM clinical_audits
      WHERE hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
    )
  );

CREATE POLICY "hospital_isolation_qi_projects" ON qi_projects
  FOR ALL USING (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "hospital_isolation_qi_cycles" ON qi_cycles
  FOR ALL USING (
    qi_project_id IN (
      SELECT id FROM qi_projects
      WHERE hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
    )
  )
  WITH CHECK (
    qi_project_id IN (
      SELECT id FROM qi_projects
      WHERE hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
    )
  );

-- NABH Compliance Matrix & Evidence Repository
-- Tables: nabh_standards (global master), nabh_hospital_compliance, nabh_evidence_items

-- ─── 1. Master standards table (hospital-agnostic) ───────────────────────────
CREATE TABLE IF NOT EXISTS nabh_standards (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_code            TEXT NOT NULL,   -- AAC, COP, MOM, HIC, PRE, ROM, FMS, HRM, IMS, QPS
  standard_code           TEXT NOT NULL,   -- e.g. AAC.1, COP.3
  objective_element_code  TEXT,            -- e.g. a, b — NULL for standard-level entries
  level                   TEXT NOT NULL CHECK (level IN ('Core','Commitment','Achievement','Excellence')),
  description             TEXT NOT NULL,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (standard_code, objective_element_code)
);

-- ─── 2. Hospital-specific compliance tracking ────────────────────────────────
CREATE TABLE IF NOT EXISTS nabh_hospital_compliance (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  nabh_standard_id    UUID NOT NULL REFERENCES nabh_standards(id) ON DELETE CASCADE,
  applicability       TEXT NOT NULL DEFAULT 'Applicable'
                        CHECK (applicability IN ('Applicable','Not Applicable')),
  status              TEXT NOT NULL DEFAULT 'Not Started'
                        CHECK (status IN ('Not Started','In Progress','Compliant','Non-Compliant','Partially Compliant')),
  process_owner_id    UUID REFERENCES users(id),
  last_assessed_at    TIMESTAMPTZ,
  last_assessed_by    UUID REFERENCES users(id),
  assessor_score      NUMERIC(3,1) CHECK (assessor_score IS NULL OR (assessor_score >= 0 AND assessor_score <= 5)),
  comments            TEXT,
  risk_level          TEXT NOT NULL DEFAULT 'Medium'
                        CHECK (risk_level IN ('Low','Medium','High','Critical')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hospital_id, nabh_standard_id)
);

-- ─── 3. Evidence artefacts ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nabh_evidence_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  nabh_compliance_id  UUID NOT NULL REFERENCES nabh_hospital_compliance(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  evidence_type       TEXT CHECK (evidence_type IN (
                        'Policy','SOP','Form','Record','Report',
                        'Screenshot','Training','Audit','Committee Minutes','Other'
                      )),
  module_reference    TEXT,
  url                 TEXT,
  uploaded_by         UUID REFERENCES users(id),
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes               TEXT
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_nabh_standards_chapter
  ON nabh_standards(chapter_code, standard_code);

CREATE INDEX IF NOT EXISTS idx_nabh_compliance_hospital
  ON nabh_hospital_compliance(hospital_id, nabh_standard_id);

CREATE INDEX IF NOT EXISTS idx_nabh_evidence_compliance
  ON nabh_evidence_items(nabh_compliance_id);

CREATE INDEX IF NOT EXISTS idx_nabh_evidence_hospital
  ON nabh_evidence_items(hospital_id);

-- ─── Updated_at trigger ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION nabh_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_nabh_compliance_updated_at
  BEFORE UPDATE ON nabh_hospital_compliance
  FOR EACH ROW EXECUTE FUNCTION nabh_set_updated_at();

-- ─── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE nabh_standards          ENABLE ROW LEVEL SECURITY;
ALTER TABLE nabh_hospital_compliance ENABLE ROW LEVEL SECURITY;
ALTER TABLE nabh_evidence_items     ENABLE ROW LEVEL SECURITY;

-- Standards are global master data — any authenticated user may read
CREATE POLICY "read_nabh_standards" ON nabh_standards
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Hospital isolation for compliance records
CREATE POLICY "hospital_isolation_nabh_compliance" ON nabh_hospital_compliance
  FOR ALL USING (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  );

-- Hospital isolation for evidence items
CREATE POLICY "hospital_isolation_nabh_evidence" ON nabh_evidence_items
  FOR ALL USING (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    hospital_id IN (SELECT hospital_id FROM users WHERE auth_user_id = auth.uid())
  );

-- ─── Seed: NABH 6th Edition Standards (representative, codes + short descriptions) ──
-- TODO: Import full OE-level entries via CSV for complete accreditation coverage.
-- Source: NABH 6th Edition (2023) Accreditation Standards for Hospitals.

INSERT INTO nabh_standards (chapter_code, standard_code, objective_element_code, level, description) VALUES

-- ── Chapter AAC: Access, Assessment and Continuity of Care ───────────────────
('AAC','AAC.1', NULL, 'Core',       'Hospital services are aligned to community needs and clearly communicated'),
('AAC','AAC.2', NULL, 'Core',       'Patient registration and admission processes are defined and followed'),
('AAC','AAC.3', NULL, 'Core',       'Medical assessment is performed by qualified professionals within defined timeframes'),
('AAC','AAC.4', NULL, 'Commitment', 'Nursing assessment is structured, documented, and acted upon'),
('AAC','AAC.5', NULL, 'Commitment', 'Nutritional screening is performed for all admitted patients'),
('AAC','AAC.6', NULL, 'Achievement','Rehabilitation needs are assessed and a rehabilitation plan is documented'),
('AAC','AAC.7', NULL, 'Core',       'Discharge and transfer of patients follows a documented protocol'),
('AAC','AAC.8', NULL, 'Commitment', 'Patient information and clinical records are complete and accurate'),
('AAC','AAC.9', NULL, 'Commitment', 'Discharge summary is provided to the patient at the time of discharge'),
('AAC','AAC.10',NULL, 'Achievement','Follow-up care instructions are provided to patients and families'),

-- ── Chapter COP: Care of Patients ────────────────────────────────────────────
('COP','COP.1', NULL, 'Core',       'Uniform care is provided to patients regardless of paying category'),
('COP','COP.2', NULL, 'Core',       'High-risk patients are identified and monitored per protocol'),
('COP','COP.3', NULL, 'Core',       'Resuscitation services are available 24x7 with trained staff'),
('COP','COP.4', NULL, 'Core',       'Blood and blood products are managed safely per defined protocols'),
('COP','COP.5', NULL, 'Commitment', 'Patient restraint use is defined, justified, and monitored'),
('COP','COP.6', NULL, 'Achievement','End-of-life care protocols address patient dignity and family support'),
('COP','COP.7', NULL, 'Commitment', 'Pain is assessed using validated tools and managed per protocol'),
('COP','COP.8', NULL, 'Core',       'Anaesthesia care covers pre-operative, intra-operative, and post-operative phases'),
('COP','COP.9', NULL, 'Core',       'Surgical safety including WHO Surgical Safety Checklist is implemented'),
('COP','COP.10',NULL, 'Core',       'ICU protocols address admission criteria, monitoring, and discharge'),
('COP','COP.11',NULL, 'Achievement','Paediatric-specific care protocols and safety measures are in place'),
('COP','COP.12',NULL, 'Achievement','Neonatal care protocols address assessment, warmth, and infection control'),
('COP','COP.13',NULL, 'Core',       'Emergency care is available 24x7 with triage and resuscitation capability'),

-- ── Chapter MOM: Management of Medication ────────────────────────────────────
('MOM','MOM.1', NULL, 'Core',       'Drug formulary is maintained, approved, and reviewed periodically'),
('MOM','MOM.2', NULL, 'Core',       'Medications are stored safely and dispensed per documented protocol'),
('MOM','MOM.3', NULL, 'Core',       'Medication orders are legible, dated, timed, and authenticated'),
('MOM','MOM.4', NULL, 'Core',       'Drug administration follows the 5-rights and is documented'),
('MOM','MOM.5', NULL, 'Commitment', 'Adverse drug reactions are monitored, documented, and reported'),
('MOM','MOM.6', NULL, 'Achievement','Clinical pharmacy services are integrated into patient care'),
('MOM','MOM.7', NULL, 'Commitment', 'Process for recall and return of medications is defined'),

-- ── Chapter PRE: Patient Rights and Education ─────────────────────────────────
('PRE','PRE.1', NULL, 'Core',       'Patient rights policy is defined, approved, and displayed'),
('PRE','PRE.2', NULL, 'Core',       'Patients are informed of their rights in a language they understand'),
('PRE','PRE.3', NULL, 'Core',       'Informed consent is obtained before procedures, surgery, and anaesthesia'),
('PRE','PRE.4', NULL, 'Commitment', 'Patient and family education is planned and documented systematically'),
('PRE','PRE.5', NULL, 'Achievement','Patient satisfaction is measured and improvement actions are taken'),

-- ── Chapter HIC: Hospital Infection Control ────────────────────────────────────
('HIC','HIC.1', NULL, 'Core',       'Infection control programme with a dedicated committee is established'),
('HIC','HIC.2', NULL, 'Core',       'Hand hygiene protocols follow WHO 5 moments and are audited regularly'),
('HIC','HIC.3', NULL, 'Core',       'Isolation rooms and protocols exist for infectious and immunocompromised patients'),
('HIC','HIC.4', NULL, 'Core',       'Sharps and needle management protocol prevents needle-stick injuries'),
('HIC','HIC.5', NULL, 'Core',       'Biomedical waste management follows BMWM Rules and is documented'),
('HIC','HIC.6', NULL, 'Commitment', 'Laundry and linen management protocols prevent cross-contamination'),
('HIC','HIC.7', NULL, 'Core',       'Sterilisation and disinfection protocols cover all critical items'),
('HIC','HIC.8', NULL, 'Commitment', 'Kitchen hygiene and food safety standards are maintained and audited'),
('HIC','HIC.9', NULL, 'Commitment', 'Healthcare-associated infection surveillance is conducted and reported'),
('HIC','HIC.10',NULL, 'Achievement','Outbreak management plan is documented, drilled, and staff are trained'),

-- ── Chapter ROM: Responsibilities of Management ────────────────────────────────
('ROM','ROM.1', NULL, 'Core',       'Governance structure with defined roles and responsibilities is documented'),
('ROM','ROM.2', NULL, 'Core',       'Hospital management complies with all statutory and regulatory requirements'),
('ROM','ROM.3', NULL, 'Core',       'Policies and procedures are documented, approved, and accessible to staff'),
('ROM','ROM.4', NULL, 'Core',       'Quality improvement programme is established and operational'),
('ROM','ROM.5', NULL, 'Achievement','Ethics committee provides oversight on patient care and research ethics'),
('ROM','ROM.6', NULL, 'Achievement','Strategic and operational planning aligns with organisational goals'),

-- ── Chapter FMS: Facility Management and Safety ───────────────────────────────
('FMS','FMS.1', NULL, 'Core',       'Fire and life safety programme includes detection, suppression, and drills'),
('FMS','FMS.2', NULL, 'Core',       'Security management plan protects patients, staff, and assets'),
('FMS','FMS.3', NULL, 'Core',       'Hazardous materials are identified, labelled, handled, and disposed safely'),
('FMS','FMS.4', NULL, 'Core',       'Medical equipment inventory and preventive maintenance schedule exists'),
('FMS','FMS.5', NULL, 'Commitment', 'Utility systems including electrical, water, and gas backup are maintained'),
('FMS','FMS.6', NULL, 'Commitment', 'Infrastructure maintenance schedule is followed and records are kept'),
('FMS','FMS.7', NULL, 'Achievement','Disaster management plan covers internal and external disasters with drills'),

-- ── Chapter HRM: Human Resource Management ────────────────────────────────────
('HRM','HRM.1', NULL, 'Core',       'Workforce planning and recruitment policies ensure adequate staffing'),
('HRM','HRM.2', NULL, 'Core',       'Orientation programme and continuing education are conducted for all staff'),
('HRM','HRM.3', NULL, 'Commitment', 'Performance appraisal system covers all employees with defined criteria'),
('HRM','HRM.4', NULL, 'Commitment', 'Staff health, vaccination, and welfare programmes are in place'),
('HRM','HRM.5', NULL, 'Core',       'Licensing, credentialing, and privileging of clinical staff is verified'),

-- ── Chapter IMS: Information Management System ────────────────────────────────
('IMS','IMS.1', NULL, 'Core',       'Medical records policy covers creation, maintenance, retention, and retrieval'),
('IMS','IMS.2', NULL, 'Core',       'Patient privacy and confidentiality is protected by policy and practice'),
('IMS','IMS.3', NULL, 'Commitment', 'Data management and reporting systems support clinical and operational needs'),
('IMS','IMS.4', NULL, 'Achievement','IT security policies protect patient data and hospital information systems'),
('IMS','IMS.5', NULL, 'Commitment', 'Statistical data is collected, analysed, and used for quality monitoring'),

-- ── Chapter QPS: Quality, Patient Safety and Improvement ─────────────────────
('QPS','QPS.1', NULL, 'Core',       'Quality management programme with defined goals and indicators is established'),
('QPS','QPS.2', NULL, 'Core',       'Quality indicators are tracked, benchmarked, and reported to management'),
('QPS','QPS.3', NULL, 'Core',       'Patient safety incident reporting system is operational and non-punitive'),
('QPS','QPS.4', NULL, 'Commitment', 'Root cause analysis is conducted for sentinel events and near misses'),
('QPS','QPS.5', NULL, 'Commitment', 'CAPA process ensures corrective and preventive actions are tracked to closure'),
('QPS','QPS.6', NULL, 'Excellence', 'Accreditation compliance is maintained with documented evidence')

ON CONFLICT (standard_code, objective_element_code) DO NOTHING;

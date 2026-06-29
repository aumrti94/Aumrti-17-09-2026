-- Insurance gaps: co-payment collection tracking + claim submission deadline
-- Gap 1: Track co-payment collected per pre-auth
ALTER TABLE insurance_pre_auth
  ADD COLUMN IF NOT EXISTS copayment_collected       BOOLEAN   DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS copayment_collected_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS copayment_due             NUMERIC   DEFAULT 0;

-- Gap 2: Track 60-day submission deadline per claim (TPA contract requirement)
ALTER TABLE insurance_claims
  ADD COLUMN IF NOT EXISTS submission_deadline       DATE;

-- Backfill submission_deadline for existing claims that have a submitted_at
UPDATE insurance_claims
SET submission_deadline = (submitted_at::date + INTERVAL '60 days')::date
WHERE submission_deadline IS NULL
  AND submitted_at IS NOT NULL;

-- Index for deadline monitoring queries
CREATE INDEX IF NOT EXISTS idx_insurance_pre_auth_copayment
  ON insurance_pre_auth (hospital_id, copayment_collected)
  WHERE copayment_collected = FALSE AND copayment_due > 0;

CREATE INDEX IF NOT EXISTS idx_insurance_claims_deadline
  ON insurance_claims (hospital_id, submission_deadline)
  WHERE submission_deadline IS NOT NULL AND status = 'draft';

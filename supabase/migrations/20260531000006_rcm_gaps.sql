-- ============================================================
-- RCM GAPS: Bill Amendments, TPA Disputes, PMJAY packages,
--           HCX callback tracking, Credit limits
-- ============================================================

-- ── Gap 7: Bill Amendment Audit Trail ──────────────────────
CREATE TABLE IF NOT EXISTS bill_amendments (
  id              uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id     uuid    NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  bill_id         uuid    NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  amendment_type  text    NOT NULL,
    -- line_item_added | line_item_removed | rate_changed | discount_applied
    -- insurance_updated | status_changed | advance_applied | cancelled
  field_changed   text,                -- column name that changed
  old_value       jsonb,               -- snapshot of before state
  new_value       jsonb,               -- snapshot of after state
  reason          text,                -- mandatory for finalized bill edits
  changed_by      uuid    REFERENCES users(id),
  changed_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bill_amendments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bill_amendments_hospital" ON bill_amendments
  FOR ALL USING (hospital_id = get_user_hospital_id());

CREATE INDEX IF NOT EXISTS bill_amendments_bill_idx      ON bill_amendments (bill_id);
CREATE INDEX IF NOT EXISTS bill_amendments_hospital_idx  ON bill_amendments (hospital_id);
CREATE INDEX IF NOT EXISTS bill_amendments_changed_idx   ON bill_amendments (changed_at DESC);

-- ── Gap 5: TPA Dispute & Underpayment Recovery ──────────────
CREATE TABLE IF NOT EXISTS tpa_disputes (
  id                    uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id           uuid    NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  claim_id              uuid    REFERENCES insurance_claims(id) ON DELETE CASCADE,
  reconciliation_id     uuid    REFERENCES insurance_payment_reconciliation(id) ON DELETE SET NULL,

  dispute_amount        numeric(12,2) NOT NULL,
  claimed_amount        numeric(12,2) NOT NULL,
  settled_amount        numeric(12,2) NOT NULL,

  dispute_reason        text    NOT NULL,
  dispute_category      text    NOT NULL DEFAULT 'underpayment',
    -- underpayment | non_coverage | deduction_error | coding_mismatch | other

  status                text    NOT NULL DEFAULT 'raised',
    -- raised | acknowledged | under_review | partially_settled | settled | written_off

  dispute_letter_sent   boolean NOT NULL DEFAULT false,
  dispute_letter_sent_at timestamptz,
  tpa_reference         text,             -- TPA's dispute ticket number
  tpa_response          text,
  tpa_responded_at      timestamptz,

  -- Escalation
  escalation_level      int     NOT NULL DEFAULT 0,  -- 0=none, 1=manager, 2=legal
  escalated_at          timestamptz,
  next_followup_at      date,

  -- Recovery
  recovery_amount       numeric(12,2) DEFAULT 0,
  recovery_date         date,
  recovery_reference    text,

  raised_by             uuid    REFERENCES users(id),
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

ALTER TABLE tpa_disputes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tpa_disputes_hospital" ON tpa_disputes
  FOR ALL USING (hospital_id = get_user_hospital_id());

CREATE INDEX IF NOT EXISTS tpa_disputes_hospital_idx ON tpa_disputes (hospital_id);
CREATE INDEX IF NOT EXISTS tpa_disputes_claim_idx    ON tpa_disputes (claim_id);
CREATE INDEX IF NOT EXISTS tpa_disputes_status_idx   ON tpa_disputes (status);

-- Dispute communication log
CREATE TABLE IF NOT EXISTS tpa_dispute_communications (
  id              uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id     uuid    NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  dispute_id      uuid    NOT NULL REFERENCES tpa_disputes(id) ON DELETE CASCADE,
  direction       text    NOT NULL DEFAULT 'outbound', -- outbound | inbound
  channel         text    NOT NULL DEFAULT 'email',    -- email | letter | call | portal
  subject         text,
  body            text    NOT NULL,
  sent_by         uuid    REFERENCES users(id),
  sent_at         timestamptz DEFAULT now()
);

ALTER TABLE tpa_dispute_communications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tpa_dispute_comms_hospital" ON tpa_dispute_communications
  FOR ALL USING (hospital_id = get_user_hospital_id());

-- ── Gap 1: HCX Callback Tracking ───────────────────────────
ALTER TABLE insurance_claims
  ADD COLUMN IF NOT EXISTS hcx_claim_id          text,    -- HCX correlation ID
  ADD COLUMN IF NOT EXISTS hcx_status            text,    -- pending | acknowledged | approved | rejected | queried
  ADD COLUMN IF NOT EXISTS hcx_approved_amount   numeric(12,2),
  ADD COLUMN IF NOT EXISTS hcx_rejection_reason  text,
  ADD COLUMN IF NOT EXISTS hcx_response_at       timestamptz,
  ADD COLUMN IF NOT EXISTS hcx_response_payload  jsonb;   -- full FHIR ClaimResponse for audit

ALTER TABLE insurance_pre_auth
  ADD COLUMN IF NOT EXISTS hcx_request_id        text,
  ADD COLUMN IF NOT EXISTS hcx_status            text,
  ADD COLUMN IF NOT EXISTS hcx_approved_amount   numeric(12,2),
  ADD COLUMN IF NOT EXISTS hcx_response_at       timestamptz;

-- ── Gap 3: PMJAY Package Code Master ───────────────────────
CREATE TABLE IF NOT EXISTS pmjay_package_master (
  id              uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id     uuid    NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  package_code    text    NOT NULL,          -- e.g. HBP-10-101-V0001-0101
  package_name    text    NOT NULL,
  package_group   text,                      -- e.g. "General Medicine", "Cardiology"
  base_rate       numeric(12,2) NOT NULL,    -- PMJAY approved rate ₹
  speciality_rate numeric(12,2),             -- for higher category hospitals
  icd10_codes     text[],                    -- associated ICD-10 codes
  procedure_codes text[],                    -- associated procedure codes
  max_days        int,                       -- max hospital stay covered
  pre_auth_required boolean DEFAULT true,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE pmjay_package_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pmjay_packages_hospital" ON pmjay_package_master
  FOR ALL USING (hospital_id = get_user_hospital_id());

CREATE INDEX IF NOT EXISTS pmjay_pkg_hospital_idx  ON pmjay_package_master (hospital_id);
CREATE INDEX IF NOT EXISTS pmjay_pkg_code_idx      ON pmjay_package_master (package_code);

-- PMJAY claims (extend govt_scheme_claims with PMJAY-specific fields)
ALTER TABLE govt_scheme_claims
  ADD COLUMN IF NOT EXISTS pmjay_package_code   text,
  ADD COLUMN IF NOT EXISTS pmjay_pre_auth_id    text,    -- PMJAY pre-auth reference
  ADD COLUMN IF NOT EXISTS pmjay_beneficiary_id text,    -- BIS beneficiary ID
  ADD COLUMN IF NOT EXISTS hcx_claim_id         text,
  ADD COLUMN IF NOT EXISTS approved_amount       numeric(12,2),
  ADD COLUMN IF NOT EXISTS settled_amount        numeric(12,2),
  ADD COLUMN IF NOT EXISTS rejection_reason      text,
  ADD COLUMN IF NOT EXISTS settled_at            timestamptz;

-- ── Gap 8: Credit Limit Enforcement tracking ────────────────
-- (payer_masters created in 20260908000004 — guard if not yet present)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payer_masters') THEN
    ALTER TABLE payer_masters
      ADD COLUMN IF NOT EXISTS credit_hold           boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS credit_hold_reason    text,
      ADD COLUMN IF NOT EXISTS credit_hold_at        timestamptz,
      ADD COLUMN IF NOT EXISTS outstanding_amount    numeric(12,2) NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Advance balance helper: add bill-level advance_applied column
ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS advance_applied       numeric(12,2) NOT NULL DEFAULT 0;

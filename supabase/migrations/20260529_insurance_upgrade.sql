-- =============================================================================
-- Migration: 20260529_insurance_upgrade.sql
-- Description: Insurance & TPA 3-tier workflow upgrade
--              (Manual / AI-Assisted / Automated)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. RLS helper note
--    This migration uses the pre-existing public.get_user_hospital_id()
--    function (defined in the initial migration) which resolves the calling
--    user's hospital_id from public.users WHERE auth_user_id = auth.uid().
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. ALTER insurance_pre_auth
-- ---------------------------------------------------------------------------
ALTER TABLE public.insurance_pre_auth
  ADD COLUMN IF NOT EXISTS sla_deadline              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_breached              BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_amount           NUMERIC,
  ADD COLUMN IF NOT EXISTS rejection_reason          TEXT,
  ADD COLUMN IF NOT EXISTS tpa_reference_number      TEXT,
  ADD COLUMN IF NOT EXISTS submission_mode           TEXT
    CONSTRAINT insurance_pre_auth_submission_mode_chk
    CHECK (submission_mode IN ('manual', 'ai_assisted', 'automated')),
  ADD COLUMN IF NOT EXISTS document_checklist        JSONB,
  ADD COLUMN IF NOT EXISTS icd10_codes               JSONB,
  ADD COLUMN IF NOT EXISTS supplementary_required    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS supplementary_amount      NUMERIC;

COMMENT ON COLUMN public.insurance_pre_auth.document_checklist    IS 'Array of {doc: TEXT, uploaded: BOOL} objects';
COMMENT ON COLUMN public.insurance_pre_auth.icd10_codes           IS 'Array of {code: TEXT, description: TEXT} objects';
COMMENT ON COLUMN public.insurance_pre_auth.sla_deadline          IS 'Cashless SLA deadline — typically created_at + tpa_config.pre_auth_sla_minutes';

-- ---------------------------------------------------------------------------
-- 2. ALTER insurance_claims
-- ---------------------------------------------------------------------------
ALTER TABLE public.insurance_claims
  ADD COLUMN IF NOT EXISTS tpa_reference_number      TEXT,
  ADD COLUMN IF NOT EXISTS approved_amount           NUMERIC,
  ADD COLUMN IF NOT EXISTS rejection_reason          TEXT,
  ADD COLUMN IF NOT EXISTS query_count               INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS appeal_deadline           DATE,
  ADD COLUMN IF NOT EXISTS appeal_submitted_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciled                BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS underpayment_amount       NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS submission_mode           TEXT
    CONSTRAINT insurance_claims_submission_mode_chk
    CHECK (submission_mode IN ('manual', 'ai_assisted', 'automated'));

-- ---------------------------------------------------------------------------
-- 3. ALTER tpa_config
-- ---------------------------------------------------------------------------
ALTER TABLE public.tpa_config
  ADD COLUMN IF NOT EXISTS pre_auth_sla_minutes      INT DEFAULT 60,
  ADD COLUMN IF NOT EXISTS discharge_sla_minutes     INT DEFAULT 180,
  ADD COLUMN IF NOT EXISTS api_endpoint              TEXT,
  ADD COLUMN IF NOT EXISTS api_key_encrypted         TEXT,
  ADD COLUMN IF NOT EXISTS submission_method         TEXT
    CONSTRAINT tpa_config_submission_method_chk
    CHECK (submission_method IN ('manual', 'email', 'hcx_api', 'rpa_bot')),
  ADD COLUMN IF NOT EXISTS contact_email             TEXT,
  ADD COLUMN IF NOT EXISTS turnaround_days           INT DEFAULT 7;

-- ---------------------------------------------------------------------------
-- 4. EXTEND tpa_queries (guarded: table created in 20260904000026_p2_gaps)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tpa_queries') THEN
    ALTER TABLE public.tpa_queries
      ADD COLUMN IF NOT EXISTS pre_auth_id        UUID        REFERENCES public.insurance_pre_auth(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS query_date         DATE,
      ADD COLUMN IF NOT EXISTS response_deadline  DATE,
      ADD COLUMN IF NOT EXISTS response_text      TEXT,
      ADD COLUMN IF NOT EXISTS response_date      DATE,
      ADD COLUMN IF NOT EXISTS ai_draft_response  TEXT;

    ALTER TABLE public.tpa_queries DROP CONSTRAINT IF EXISTS tpa_queries_status_check;
    ALTER TABLE public.tpa_queries DROP CONSTRAINT IF EXISTS tpa_queries_status_chk;
    ALTER TABLE public.tpa_queries ADD CONSTRAINT tpa_queries_status_chk
      CHECK (status IN ('open', 'responded', 'replied', 'overdue', 'escalated', 'closed'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. CREATE insurance_payment_reconciliation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.insurance_payment_reconciliation (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id                 UUID        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  claim_id                    UUID        NOT NULL REFERENCES public.insurance_claims(id) ON DELETE RESTRICT,
  tpa_payment_advice_number   TEXT,
  tpa_paid_amount             NUMERIC     NOT NULL,
  hospital_claimed_amount     NUMERIC     NOT NULL,
  difference_amount           NUMERIC     GENERATED ALWAYS AS (hospital_claimed_amount - tpa_paid_amount) STORED,
  payment_date                DATE,
  bank_reference              TEXT,
  reconciled                  BOOLEAN     NOT NULL DEFAULT false,
  dispute_raised              BOOLEAN     NOT NULL DEFAULT false,
  dispute_reason              TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.insurance_payment_reconciliation IS 'Tracks TPA payment advice vs hospital-claimed amount; positive difference_amount = underpayment';
COMMENT ON COLUMN public.insurance_payment_reconciliation.difference_amount IS 'Computed: hospital_claimed_amount − tpa_paid_amount (positive = underpayment)';

-- ---------------------------------------------------------------------------
-- 6. CREATE insurance_sla_log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.insurance_sla_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     UUID        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  reference_type  TEXT        NOT NULL
    CONSTRAINT insurance_sla_log_ref_type_chk
    CHECK (reference_type IN ('pre_auth', 'claim', 'discharge')),
  reference_id    UUID        NOT NULL,
  patient_name    TEXT,
  tpa_name        TEXT,
  sla_deadline    TIMESTAMPTZ,
  breached_at     TIMESTAMPTZ,
  breach_minutes  INT,
  alert_sent_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.insurance_sla_log IS 'Append-only audit log of SLA breaches; reference_id points to the relevant pre_auth/claim row';

-- ---------------------------------------------------------------------------
-- 7. CREATE hospital_insurance_settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hospital_insurance_settings (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id              UUID        UNIQUE NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  plan_tier                TEXT        NOT NULL DEFAULT 'manual'
    CONSTRAINT his_plan_tier_chk
    CHECK (plan_tier IN ('manual', 'ai_assisted', 'automated')),
  auto_submit_pre_auth     BOOLEAN     NOT NULL DEFAULT false,
  auto_submit_claims       BOOLEAN     NOT NULL DEFAULT false,
  sla_alert_channel        TEXT        NOT NULL DEFAULT 'in_app'
    CONSTRAINT his_alert_channel_chk
    CHECK (sla_alert_channel IN ('in_app', 'whatsapp', 'email', 'sms')),
  whatsapp_alert_number    TEXT,
  denial_threshold_score   INT         NOT NULL DEFAULT 40,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.hospital_insurance_settings IS 'Per-hospital Insurance & TPA automation tier and alert preferences';
COMMENT ON COLUMN public.hospital_insurance_settings.denial_threshold_score IS 'ai_denial_risk_score above this value triggers auto-hold on claim submission';
COMMENT ON COLUMN public.hospital_insurance_settings.plan_tier IS 'manual=no AI; ai_assisted=drafts + checklists; automated=auto-submit via HCX/RPA';

-- updated_at trigger for hospital_insurance_settings
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_his_updated_at ON public.hospital_insurance_settings;
CREATE TRIGGER trg_his_updated_at
  BEFORE UPDATE ON public.hospital_insurance_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- INDEXES
-- =============================================================================

-- insurance_pre_auth (new columns)
CREATE INDEX IF NOT EXISTS idx_ipa_hospital_status
  ON public.insurance_pre_auth (hospital_id, status);
CREATE INDEX IF NOT EXISTS idx_ipa_sla_deadline
  ON public.insurance_pre_auth (sla_deadline)
  WHERE sla_breached = false;
CREATE INDEX IF NOT EXISTS idx_ipa_created_at
  ON public.insurance_pre_auth (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ipa_submission_mode
  ON public.insurance_pre_auth (hospital_id, submission_mode);

-- insurance_claims (new columns)
CREATE INDEX IF NOT EXISTS idx_ic_hospital_status
  ON public.insurance_claims (hospital_id, status);
CREATE INDEX IF NOT EXISTS idx_ic_reconciled
  ON public.insurance_claims (hospital_id, reconciled);
CREATE INDEX IF NOT EXISTS idx_ic_submission_mode
  ON public.insurance_claims (hospital_id, submission_mode);
CREATE INDEX IF NOT EXISTS idx_ic_created_at
  ON public.insurance_claims (created_at DESC);

-- tpa_queries indexes (guarded)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tpa_queries') THEN
    CREATE INDEX IF NOT EXISTS idx_tpaq_hospital_id ON public.tpa_queries (hospital_id);
    CREATE INDEX IF NOT EXISTS idx_tpaq_claim_id ON public.tpa_queries (claim_id);
    CREATE INDEX IF NOT EXISTS idx_tpaq_status ON public.tpa_queries (hospital_id, status);
    CREATE INDEX IF NOT EXISTS idx_tpaq_created_at ON public.tpa_queries (created_at DESC);
  END IF;
END $$;

-- insurance_payment_reconciliation
CREATE INDEX IF NOT EXISTS idx_ipr_hospital_id
  ON public.insurance_payment_reconciliation (hospital_id);
CREATE INDEX IF NOT EXISTS idx_ipr_claim_id
  ON public.insurance_payment_reconciliation (claim_id);
CREATE INDEX IF NOT EXISTS idx_ipr_reconciled
  ON public.insurance_payment_reconciliation (hospital_id, reconciled);
CREATE INDEX IF NOT EXISTS idx_ipr_payment_date
  ON public.insurance_payment_reconciliation (payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_ipr_created_at
  ON public.insurance_payment_reconciliation (created_at DESC);

-- insurance_sla_log
CREATE INDEX IF NOT EXISTS idx_isla_hospital_id
  ON public.insurance_sla_log (hospital_id);
CREATE INDEX IF NOT EXISTS idx_isla_reference
  ON public.insurance_sla_log (reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_isla_sla_deadline
  ON public.insurance_sla_log (sla_deadline);
CREATE INDEX IF NOT EXISTS idx_isla_breached_at
  ON public.insurance_sla_log (breached_at)
  WHERE breached_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_isla_created_at
  ON public.insurance_sla_log (created_at DESC);

-- hospital_insurance_settings
CREATE INDEX IF NOT EXISTS idx_his_hospital_id
  ON public.hospital_insurance_settings (hospital_id);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

-- Enable RLS on new tables (tpa_queries guarded — may not exist yet)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tpa_queries') THEN
    ALTER TABLE public.tpa_queries ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;
ALTER TABLE public.insurance_payment_reconciliation
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_sla_log
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hospital_insurance_settings
  ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- tpa_queries policies (guarded)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tpa_queries') THEN
    DROP POLICY IF EXISTS "tpa_queries_hospital_select" ON public.tpa_queries;
    CREATE POLICY "tpa_queries_hospital_select" ON public.tpa_queries FOR SELECT USING (hospital_id = public.get_user_hospital_id());
    DROP POLICY IF EXISTS "tpa_queries_hospital_insert" ON public.tpa_queries;
    CREATE POLICY "tpa_queries_hospital_insert" ON public.tpa_queries FOR INSERT WITH CHECK (hospital_id = public.get_user_hospital_id());
    DROP POLICY IF EXISTS "tpa_queries_hospital_update" ON public.tpa_queries;
    CREATE POLICY "tpa_queries_hospital_update" ON public.tpa_queries FOR UPDATE USING (hospital_id = public.get_user_hospital_id()) WITH CHECK (hospital_id = public.get_user_hospital_id());
    DROP POLICY IF EXISTS "tpa_queries_hospital_delete" ON public.tpa_queries;
    CREATE POLICY "tpa_queries_hospital_delete" ON public.tpa_queries FOR DELETE USING (hospital_id = public.get_user_hospital_id());
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- insurance_payment_reconciliation policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "ipr_hospital_select" ON public.insurance_payment_reconciliation;
CREATE POLICY "ipr_hospital_select"
  ON public.insurance_payment_reconciliation FOR SELECT
  USING (hospital_id = public.get_user_hospital_id());

DROP POLICY IF EXISTS "ipr_hospital_insert" ON public.insurance_payment_reconciliation;
CREATE POLICY "ipr_hospital_insert"
  ON public.insurance_payment_reconciliation FOR INSERT
  WITH CHECK (hospital_id = public.get_user_hospital_id());

DROP POLICY IF EXISTS "ipr_hospital_update" ON public.insurance_payment_reconciliation;
CREATE POLICY "ipr_hospital_update"
  ON public.insurance_payment_reconciliation FOR UPDATE
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

DROP POLICY IF EXISTS "ipr_hospital_delete" ON public.insurance_payment_reconciliation;
CREATE POLICY "ipr_hospital_delete"
  ON public.insurance_payment_reconciliation FOR DELETE
  USING (hospital_id = public.get_user_hospital_id());

-- ---------------------------------------------------------------------------
-- insurance_sla_log policies  (append-only in practice; no delete for audit)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "isla_hospital_select" ON public.insurance_sla_log;
CREATE POLICY "isla_hospital_select"
  ON public.insurance_sla_log FOR SELECT
  USING (hospital_id = public.get_user_hospital_id());

DROP POLICY IF EXISTS "isla_hospital_insert" ON public.insurance_sla_log;
CREATE POLICY "isla_hospital_insert"
  ON public.insurance_sla_log FOR INSERT
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- Intentionally no UPDATE/DELETE policy — SLA log is immutable audit trail.

-- ---------------------------------------------------------------------------
-- hospital_insurance_settings policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "his_hospital_select" ON public.hospital_insurance_settings;
CREATE POLICY "his_hospital_select"
  ON public.hospital_insurance_settings FOR SELECT
  USING (hospital_id = public.get_user_hospital_id());

DROP POLICY IF EXISTS "his_hospital_insert" ON public.hospital_insurance_settings;
CREATE POLICY "his_hospital_insert"
  ON public.hospital_insurance_settings FOR INSERT
  WITH CHECK (hospital_id = public.get_user_hospital_id());

DROP POLICY IF EXISTS "his_hospital_update" ON public.hospital_insurance_settings;
CREATE POLICY "his_hospital_update"
  ON public.hospital_insurance_settings FOR UPDATE
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- No delete — settings row is permanent; deactivate via plan_tier instead.

-- =============================================================================
-- DEFAULT SETTINGS ROW (upsert for existing hospitals)
-- =============================================================================
-- Inserts a default "manual" settings row for every hospital that doesn't
-- already have one. Safe to run multiple times.
INSERT INTO public.hospital_insurance_settings (hospital_id)
SELECT id
FROM   public.hospitals
WHERE  id NOT IN (SELECT hospital_id FROM public.hospital_insurance_settings)
ON CONFLICT (hospital_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 8. ADD extended columns to tpa_config  (P10 — TPA Package Rate Master &
--    per-TPA SLA alerts, HCX code, email template)
-- ---------------------------------------------------------------------------
ALTER TABLE public.tpa_config
  ADD COLUMN IF NOT EXISTS package_rates         JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sla_alert_channel     TEXT  DEFAULT 'in_app'
    CONSTRAINT tpa_config_sla_alert_chk
    CHECK (sla_alert_channel IN ('in_app', 'whatsapp', 'email', 'sms')),
  ADD COLUMN IF NOT EXISTS whatsapp_alert_number TEXT,
  ADD COLUMN IF NOT EXISTS tpa_hcx_code          TEXT,
  ADD COLUMN IF NOT EXISTS email_subject_template TEXT
    DEFAULT 'Claim Submission — {claim_number} — {patient_name}',
  ADD COLUMN IF NOT EXISTS cc_emails             TEXT[];

COMMENT ON COLUMN public.tpa_config.package_rates IS
  'Array of {id,procedure_name,package_code,approved_rate,effective_date,includes} rate bundles';
COMMENT ON COLUMN public.tpa_config.sla_alert_channel IS
  'Per-TPA channel for SLA breach alerts (overrides hospital default when set)';
COMMENT ON COLUMN public.tpa_config.tpa_hcx_code IS
  'TPA identifier on the NHA Health Claims Exchange network';
COMMENT ON COLUMN public.tpa_config.email_subject_template IS
  'Template for email submission subject; supports {claim_number} and {patient_name} tokens';
COMMENT ON COLUMN public.tpa_config.cc_emails IS
  'Array of CC email addresses for email-mode claim submissions';

-- ---------------------------------------------------------------------------
-- 9. ADD n8n_webhook_url to hospital_insurance_settings  (P13 alert dispatcher)
-- ---------------------------------------------------------------------------
ALTER TABLE public.hospital_insurance_settings
  ADD COLUMN IF NOT EXISTS n8n_webhook_url TEXT;

COMMENT ON COLUMN public.hospital_insurance_settings.n8n_webhook_url IS
  'n8n automation webhook URL for WhatsApp relay. Body sent: {to, message, type}';

-- ---------------------------------------------------------------------------
-- 10. Denial management columns  (P12 — appeal workflow)
-- ---------------------------------------------------------------------------
ALTER TABLE public.insurance_claims
  ADD COLUMN IF NOT EXISTS rejection_code          TEXT
    CONSTRAINT insurance_claims_rejection_code_chk
    CHECK (rejection_code IN (
      'not_medically_necessary','policy_exclusion','pre_auth_not_obtained',
      'incorrect_icd_code','document_deficiency','duplicate_claim','other'
    )),
  ADD COLUMN IF NOT EXISTS rejection_notice_date   DATE,
  ADD COLUMN IF NOT EXISTS appeal_status           TEXT
    CONSTRAINT insurance_claims_appeal_status_chk
    CHECK (appeal_status IN ('draft','submitted','upheld','reversed'));

COMMENT ON COLUMN public.insurance_claims.rejection_code IS
  'Structured denial reason code from the IRDAI-standard rejection categories';
COMMENT ON COLUMN public.insurance_claims.rejection_notice_date IS
  'Date the hospital received the written rejection notice from TPA';
COMMENT ON COLUMN public.insurance_claims.appeal_status IS
  'Tracks the appeal lifecycle: draft → submitted → upheld/reversed';

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

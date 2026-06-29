-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260628000002_phi_column_encryption.sql
-- Purpose  : Add encrypted (_enc) and hash (_hash) columns alongside the 12
--            highest-risk PHI columns in Aumrti HMS.
--
-- STRATEGY — Additive, Zero-Downtime:
--   1. Add new nullable columns (_enc, _hash) — no existing queries break.
--   2. The phi-backfill-encrypt Edge Function fills these columns in batches.
--   3. After 100% backfill verified, a future migration drops the plaintext cols.
--   4. Indexes on _hash columns allow exact-match search without decryption.
--
-- Tables covered (DPDP Act §8(4) risk classification):
--   CRITICAL : patients (aadhaar_number if it exists)
--   HIGH     : patients.phone, patients.full_name, admissions.emergency_contact_phone
--              lab_reports.result_text, consent_forms.patient_signature_data
--              ai_usage_logs.prompt_text
--   MEDIUM   : patients.address, prescriptions.notes, bills.patient_name_snapshot
--              whatsapp_bot_sessions.last_message, audit_log.details (via Edge Fn boundary)
--
-- Ananya (Security) sign-off: confirm column list before running in prod.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLE: patients
-- ═══════════════════════════════════════════════════════════════════════════

-- phone
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS phone_enc   TEXT,   -- AES-256-GCM ciphertext: v{n}:{base64}
  ADD COLUMN IF NOT EXISTS phone_hash  TEXT;   -- HMAC-SHA256 hex for exact-match search

-- full_name
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS name_enc    TEXT,   -- encrypted full name
  ADD COLUMN IF NOT EXISTS name_hash   TEXT;   -- HMAC for exact-match search

-- address (medium risk — no hash needed, address search not required)
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS address_enc TEXT;

-- aadhaar_number — encrypt if column exists (added by some hospitals manually)
-- We wrap in a DO block so migration is idempotent even if column doesn't exist
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'patients'
      AND column_name  = 'aadhaar_number'
  ) THEN
    ALTER TABLE patients
      ADD COLUMN IF NOT EXISTS aadhaar_enc  TEXT,
      ADD COLUMN IF NOT EXISTS aadhaar_hash TEXT;
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLE: admissions
-- ═══════════════════════════════════════════════════════════════════════════

-- emergency_contact_phone
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'admissions'
  ) THEN
    ALTER TABLE admissions
      ADD COLUMN IF NOT EXISTS ec_phone_enc  TEXT,
      ADD COLUMN IF NOT EXISTS ec_phone_hash TEXT;
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLE: lab_reports
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'lab_reports'
  ) THEN
    ALTER TABLE lab_reports
      ADD COLUMN IF NOT EXISTS result_enc TEXT;
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLE: prescriptions
-- ═══════════════════════════════════════════════════════════════════════════

-- Free-text notes may contain clinical observations about the patient
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'prescriptions'
  ) THEN
    ALTER TABLE prescriptions
      ADD COLUMN IF NOT EXISTS notes_enc TEXT;
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLE: bills
-- ═══════════════════════════════════════════════════════════════════════════

-- Snapshot of patient name at time of billing (often duplicated from patients table)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'bills'
      AND column_name  = 'patient_name_snapshot'
  ) THEN
    ALTER TABLE bills
      ADD COLUMN IF NOT EXISTS patient_name_enc TEXT;
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLE: consent_forms (digital_consent migration)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'consent_forms'
  ) THEN
    ALTER TABLE consent_forms
      ADD COLUMN IF NOT EXISTS signature_data_enc TEXT;
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLE: ai_usage_logs
-- ═══════════════════════════════════════════════════════════════════════════

-- prompt_text may contain clinical free text with patient identifiers
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'ai_usage_logs'
      AND column_name  = 'prompt_text'
  ) THEN
    ALTER TABLE ai_usage_logs
      ADD COLUMN IF NOT EXISTS prompt_enc TEXT;
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLE: whatsapp_bot_sessions
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'whatsapp_bot_sessions'
      AND column_name  = 'last_message'
  ) THEN
    ALTER TABLE whatsapp_bot_sessions
      ADD COLUMN IF NOT EXISTS last_message_enc TEXT;
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- INDEXES on _hash columns for exact-match search
-- ═══════════════════════════════════════════════════════════════════════════

-- patients.phone_hash — replaces LIKE search on phone
CREATE INDEX IF NOT EXISTS patients_phone_hash_idx
  ON patients (hospital_id, phone_hash)
  WHERE phone_hash IS NOT NULL;

-- patients.name_hash — for exact-match patient name search
CREATE INDEX IF NOT EXISTS patients_name_hash_idx
  ON patients (hospital_id, name_hash)
  WHERE name_hash IS NOT NULL;

-- admissions.ec_phone_hash
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'admissions'
  ) THEN
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS admissions_ec_phone_hash_idx
        ON admissions (hospital_id, ec_phone_hash)
        WHERE ec_phone_hash IS NOT NULL;
    $idx$;
  END IF;
END;
$$;

-- aadhaar — conditional index (only if column added above)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'patients'
      AND column_name  = 'aadhaar_hash'
  ) THEN
    EXECUTE $idx$
      CREATE UNIQUE INDEX IF NOT EXISTS patients_aadhaar_hash_idx
        ON patients (hospital_id, aadhaar_hash)
        WHERE aadhaar_hash IS NOT NULL;
    $idx$;
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- COMMENTS for documentation and DPDP compliance traceability
-- ═══════════════════════════════════════════════════════════════════════════

COMMENT ON COLUMN patients.phone_enc IS
  'AES-256-GCM encrypted phone number. Format: v{key_version}:{base64(iv||ct||tag)}. '
  'DPDP Act §8(4). Decryption only in Edge Functions with service_role access to phi_encryption_keys.';

COMMENT ON COLUMN patients.phone_hash IS
  'HMAC-SHA256 of normalised phone (10 digits, no +91 prefix). '
  'Used for exact-match search. Cannot be reversed to plaintext.';

COMMENT ON COLUMN patients.name_enc IS
  'AES-256-GCM encrypted full_name. DPDP Act §8(4).';

COMMENT ON COLUMN patients.address_enc IS
  'AES-256-GCM encrypted address. DPDP Act §8(4). No search hash — address search not required.';

-- Comment on admissions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'admissions'
  ) THEN
    EXECUTE $c$
      COMMENT ON COLUMN admissions.ec_phone_enc IS
        'AES-256-GCM encrypted emergency contact phone number. DPDP Act §8(4).'
    $c$;
  END IF;
END;
$$;

-- Comment on lab_reports
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'lab_reports'
  ) THEN
    EXECUTE $c$
      COMMENT ON COLUMN lab_reports.result_enc IS
        'AES-256-GCM encrypted lab result text. DPDP Act §8(4). '
        'AI features (ai-discharge-summary) decrypt this server-side before passing to LLM.'
    $c$;
  END IF;
END;
$$;

-- Comment on prescriptions
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'prescriptions'
  ) THEN
    EXECUTE $c$
      COMMENT ON COLUMN prescriptions.notes_enc IS
        'AES-256-GCM encrypted clinical notes. DPDP Act §8(4).'
    $c$;
  END IF;
END;
$$;

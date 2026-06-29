-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260628000001_phi_encryption_keys.sql
-- Purpose  : PHI Field-Level Encryption — Key Management Infrastructure
-- Spec     : DPDP Act 2023 §8(4), CERT-In Health Sector Guidelines (AES-256)
--
-- Design:
--   • One active Data Encryption Key (DEK) per hospital at any time.
--   • The raw DEK bytes are stored encrypted under a master Key Encryption Key
--     (KEK) which lives ONLY in Supabase Vault secrets — it is NEVER in this table.
--   • Old DEKs (rotated) are retained for 90 days so historic ciphertext
--     rows can still be decrypted during backfill / migration window.
--   • RLS: ONLY service_role can SELECT/INSERT/UPDATE. Anon and JWT-auth users
--     are completely blocked from seeing any key material.
--
-- Ananya (Security) sign-off required before any DEK is generated in prod.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Key registry table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS phi_encryption_keys (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     UUID        NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,

  -- Monotonically incrementing version. New key = old version + 1.
  key_version     INTEGER     NOT NULL DEFAULT 1,

  -- AES-256-GCM DEK encrypted under the KEK stored in Supabase Vault.
  -- Format: base64(iv[12 bytes] || ciphertext[32 bytes] || authTag[16 bytes])
  -- The KEK never leaves Vault; decryption only happens inside Edge Functions
  -- that have SUPABASE_VAULT_KEY_ID injected as a secret.
  encrypted_dek   TEXT        NOT NULL,

  algorithm       TEXT        NOT NULL DEFAULT 'aes-256-gcm',
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at      TIMESTAMPTZ,          -- set when a new key replaces this one
  expires_at      TIMESTAMPTZ,          -- null = indefinite; set to now()+90d on rotation

  CONSTRAINT phi_encryption_keys_algo_check
    CHECK (algorithm = 'aes-256-gcm'),

  -- Only one active key per hospital at a time
  CONSTRAINT phi_encryption_keys_one_active_per_hospital
    UNIQUE NULLS NOT DISTINCT (hospital_id, is_active)
    -- Note: partial unique index below handles this more cleanly in older PG versions
);

-- Partial unique index: only one row with is_active = TRUE per hospital
CREATE UNIQUE INDEX IF NOT EXISTS phi_encryption_keys_unique_active
  ON phi_encryption_keys (hospital_id)
  WHERE is_active = TRUE;

-- ── 2. Index for key version lookups (decryption of old rows) ───────────────
CREATE INDEX IF NOT EXISTS phi_encryption_keys_hospital_version_idx
  ON phi_encryption_keys (hospital_id, key_version);

-- ── 3. Row Level Security — BLOCK ALL except service_role ───────────────────
ALTER TABLE phi_encryption_keys ENABLE ROW LEVEL SECURITY;

-- Deny ALL by default (no permissive fallback)
-- service_role bypasses RLS entirely in Supabase — no explicit grant needed.
-- The following policy blocks JWT-authenticated callers from ever reading keys.
CREATE POLICY phi_encryption_keys_block_auth_users
  ON phi_encryption_keys
  FOR ALL
  TO authenticated, anon
  USING (FALSE)
  WITH CHECK (FALSE);

-- ── 4. Backfill log table (used by phi-backfill-encrypt Edge Function) ──────
CREATE TABLE IF NOT EXISTS phi_backfill_log (
  id              BIGSERIAL   PRIMARY KEY,
  hospital_id     UUID        NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  table_name      TEXT        NOT NULL,
  column_name     TEXT        NOT NULL,
  rows_encrypted  INTEGER     NOT NULL DEFAULT 0,
  rows_failed     INTEGER     NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  status          TEXT        NOT NULL DEFAULT 'running'  -- running | done | failed
    CHECK (status IN ('running', 'done', 'failed')),
  error_message   TEXT
);

ALTER TABLE phi_backfill_log ENABLE ROW LEVEL SECURITY;

-- Only hospital_admin and aumrti_admin roles can read backfill progress
CREATE POLICY phi_backfill_log_hospital_admin_read
  ON phi_backfill_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.auth_user_id = auth.uid()
        AND u.hospital_id  = phi_backfill_log.hospital_id
        AND u.role IN ('hospital_admin', 'super_admin')
    )
  );

-- Only service_role can write backfill log rows
CREATE POLICY phi_backfill_log_service_write
  ON phi_backfill_log
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (FALSE);  -- service_role bypasses RLS

-- ── 5. Helper function: get_active_key_version (used by Edge Functions) ─────
-- Returns the active key_version for a hospital. Callable by service_role only.
CREATE OR REPLACE FUNCTION get_active_phi_key_version(p_hospital_id UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT key_version
  FROM phi_encryption_keys
  WHERE hospital_id = p_hospital_id
    AND is_active = TRUE
  LIMIT 1;
$$;

-- Revoke public access; only service_role can call this
REVOKE ALL ON FUNCTION get_active_phi_key_version(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_active_phi_key_version(UUID) FROM authenticated;
REVOKE ALL ON FUNCTION get_active_phi_key_version(UUID) FROM anon;

COMMENT ON TABLE phi_encryption_keys IS
  'Hospital-scoped Data Encryption Keys (DEKs) for PHI field-level encryption. '
  'DEKs are themselves encrypted under a KEK stored in Supabase Vault. '
  'Only service_role (Edge Functions) may access this table. '
  'DPDP Act 2023 §8(4) compliance. Do NOT query this table from application code.';

COMMENT ON TABLE phi_backfill_log IS
  'Progress tracking for the phi-backfill-encrypt Edge Function that migrates '
  'plaintext PHI columns to their encrypted equivalents.';

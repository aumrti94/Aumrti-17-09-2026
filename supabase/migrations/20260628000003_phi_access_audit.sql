-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260628000003_phi_access_audit.sql
-- Purpose  : PHI field-level access audit trail for DPDP Act & NABH HIC.4
--
-- Creates phi_access_audit table to record every server-side decryption event.
-- This is separate from the existing audit_log table (which tracks clinical
-- actions). This table specifically tracks who accessed encrypted PHI and when.
--
-- Written by: Ananya (Security/DPDP) + Meera (DB Infrastructure)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. PHI access audit table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS phi_access_audit (
  id           BIGSERIAL   PRIMARY KEY,
  hospital_id  UUID        NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  user_id      UUID        REFERENCES users(id) ON DELETE SET NULL,  -- null = system/edge fn
  table_name   TEXT        NOT NULL,
  row_id       TEXT        NOT NULL,                -- UUID or composite key as text
  field_names  TEXT[]      NOT NULL DEFAULT '{}',  -- which fields were decrypted
  access_type  TEXT        NOT NULL DEFAULT 'read'
    CHECK (access_type IN ('read', 'write', 'export', 'key_rotation')),
  source       TEXT        NOT NULL DEFAULT 'edge_function',
    -- edge_function | admin_console | export_job | ai_feature
  request_ip   TEXT,       -- optional: IP of the caller (from X-Forwarded-For)
  accessed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Partition hint: this table grows fast — add time-based index ─────────
CREATE INDEX IF NOT EXISTS phi_access_audit_hospital_time_idx
  ON phi_access_audit (hospital_id, accessed_at DESC);

CREATE INDEX IF NOT EXISTS phi_access_audit_user_time_idx
  ON phi_access_audit (user_id, accessed_at DESC)
  WHERE user_id IS NOT NULL;

-- ── 3. Row Level Security ────────────────────────────────────────────────────
ALTER TABLE phi_access_audit ENABLE ROW LEVEL SECURITY;

-- Hospital admin and super_admin can read their hospital's audit log
CREATE POLICY phi_access_audit_admin_read
  ON phi_access_audit
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.auth_user_id = auth.uid()
        AND u.hospital_id  = phi_access_audit.hospital_id
        AND u.role IN ('hospital_admin', 'super_admin')
    )
  );

-- Only service_role can insert (Edge Functions write audit rows)
CREATE POLICY phi_access_audit_deny_auth_insert
  ON phi_access_audit
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (FALSE);

-- No one (including admin) can UPDATE or DELETE audit rows
CREATE POLICY phi_access_audit_deny_update
  ON phi_access_audit
  FOR UPDATE
  TO authenticated, anon
  USING (FALSE);

CREATE POLICY phi_access_audit_deny_delete
  ON phi_access_audit
  FOR DELETE
  TO authenticated, anon
  USING (FALSE);

-- ── 4. Retention policy helper function ─────────────────────────────────────
-- Call monthly from a cron Edge Function: SELECT purge_old_phi_audit();
-- Purges records older than 3 years (DPDP Act minimum retention period).
CREATE OR REPLACE FUNCTION purge_old_phi_audit()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM phi_access_audit
  WHERE accessed_at < now() - INTERVAL '3 years';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION purge_old_phi_audit() FROM PUBLIC, authenticated, anon;

-- ── 5. Comments ──────────────────────────────────────────────────────────────
COMMENT ON TABLE phi_access_audit IS
  'Immutable audit trail for PHI field decryption events. '
  'DPDP Act 2023 §10 (accountability) + NABH HIC.4 (PHI access logging). '
  'Rows are written exclusively by Edge Functions via service_role. '
  'Retention: 3 years minimum. Purge via purge_old_phi_audit() function.';

COMMENT ON COLUMN phi_access_audit.field_names IS
  'Array of PHI field names that were decrypted in this access event, e.g. {phone, name}.';

COMMENT ON COLUMN phi_access_audit.source IS
  'Which system component performed the decryption: '
  'edge_function | admin_console | export_job | ai_feature';

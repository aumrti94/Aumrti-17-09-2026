-- KNOWN-BUG-121 fix (2026-09-12) — recovering the parts of
-- 20260628000002_phi_column_encryption.sql that never actually applied.
--
-- That migration guarded eight ALTER blocks with `IF EXISTS (... information_schema ...)`
-- so it would not hard-fail against a table that did not exist yet. Running the real live
-- schema against every one of those eight guards (via a read-only `supabase db dump`, not
-- inference from column names) found:
--
--   PASSED CORRECTLY, already live — no action needed:
--     admissions.ec_phone_enc / ec_phone_hash    (admissions pre-dates the migration)
--     prescriptions.notes_enc                    (prescriptions pre-dates the migration)
--
--   GUARD PREMISE WAS FALSE, correctly never fired, nothing to add:
--     patients.aadhaar_enc / aadhaar_hash   — patients has no aadhaar_number column; there is
--                                              no raw Aadhaar stored here to encrypt.
--     bills.patient_name_enc                — bills has no patient_name_snapshot column at
--                                              all; the design uses patient_id (FK) + a join,
--                                              never a denormalised name. Nothing to encrypt.
--     ai_usage_logs.prompt_enc              — ai_usage_logs has no prompt_text column; raw
--                                              prompts are never persisted here.
--     whatsapp_bot_sessions.last_message_enc — the real table has last_message_at (a
--                                              timestamp) but never last_message (content).
--   None of these four are recovered here — adding an _enc column with nothing behind it to
--   encrypt would be dead schema, not a fix.
--
--   GENUINELY MISSING — recovered below:
--     lab_reports.result_enc      — wrong table name. The real table is `lab_results`, and its
--                                    result-content column is `result_value`, not `result_text`.
--                                    HIGH-risk PHI per the original migration's own DPDP §8(4)
--                                    classification; sitting unencrypted in production since
--                                    the guard has never once fired.
--     consent_forms.signature_data_enc — wrong table name AND wrong shape. The real table is
--                                    `patient_consents`, created before this migration, but its
--                                    TWO plaintext signature columns (patient_signature,
--                                    witness_signature) were not added until 20260910000004 —
--                                    three months after this migration ran. MEDIUM-risk PHI,
--                                    also unencrypted in production since day one.
--
-- Also recovered: 20260607000001_fix_missing_tables.sql's guarded patient_id/encounter_id
-- addition to ai_usage_logs — audit linkage, unrelated to encryption, same silent-skip cause
-- (ai_usage_logs was not created until 20260910000002, three months after that migration ran).
--
-- Same strategy as the original: additive, nullable, zero-downtime. This migration does NOT
-- encrypt any existing plaintext row — it only adds the empty _enc columns. Encrypting real
-- rows is supabase/functions/phi-backfill-encrypt's job, fixed in the same change to target
-- the correct tables (its COLUMN_MAP still said "lab_reports"/"result_text" and had no entry
-- for patient_consents at all — the same drift, one layer up).
--
-- RATIFICATION: the original migration required "Ananya (Security) sign-off: confirm column
-- list before running in prod" before it ran. This recovery carries the same requirement —
-- see the review requested alongside this migration.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ai_usage_logs — audit linkage columns from 20260607000001, silently skipped because
-- ai_usage_logs did not exist until 20260910000002 (three months later).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.ai_usage_logs
  ADD COLUMN IF NOT EXISTS patient_id    uuid REFERENCES public.patients(id),
  ADD COLUMN IF NOT EXISTS encounter_id  uuid;

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_patient
  ON public.ai_usage_logs (patient_id) WHERE patient_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- lab_results.result_enc — recovers 20260628000002's "lab_reports.result_enc" intent against
-- the table's real name and real column (result_value, not result_text).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.lab_results
  ADD COLUMN IF NOT EXISTS result_enc TEXT;

COMMENT ON COLUMN public.lab_results.result_enc IS
  'AES-256-GCM encrypted lab_results.result_value. DPDP Act §8(4). Recovered 2026-09-12 — the '
  'original 20260628000002 migration targeted a table named lab_reports, which never existed; '
  'the real table is lab_results and the real column is result_value.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- patient_consents — recovers 20260628000002's "consent_forms.signature_data_enc" intent.
-- The real table has TWO plaintext signature columns, not one merged "signature_data" field,
-- so this needs two _enc columns rather than the original's single one.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.patient_consents
  ADD COLUMN IF NOT EXISTS patient_signature_enc TEXT,
  ADD COLUMN IF NOT EXISTS witness_signature_enc TEXT;

COMMENT ON COLUMN public.patient_consents.patient_signature_enc IS
  'AES-256-GCM encrypted patient_consents.patient_signature. DPDP Act §8(4). Recovered '
  '2026-09-12 — the original 20260628000002 migration targeted a table named consent_forms, '
  'which never existed; the real table is patient_consents, and patient_signature did not '
  'exist until 20260910000004 (three months after that migration ran).';

COMMENT ON COLUMN public.patient_consents.witness_signature_enc IS
  'AES-256-GCM encrypted patient_consents.witness_signature. DPDP Act §8(4). Same recovery as '
  'patient_signature_enc — the original migration never accounted for a separate witness '
  'signature column at all.';

COMMIT;

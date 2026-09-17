-- Recovers the ACTUAL missing half of the KNOWN-BUG-121 investigation.
--
-- 20260628000002_phi_column_encryption.sql guarded patients.aadhaar_enc/aadhaar_hash on
-- `column_name = 'aadhaar_number'` existing on `patients` — a column that has never existed
-- under that name. The follow-up recovery migration (20261106000010) investigated all eight
-- guards from that original migration and concluded this one's "GUARD PREMISE WAS FALSE,
-- correctly never fired, nothing to add: patients has no aadhaar_number column; there is no
-- raw Aadhaar stored here to encrypt" — but the real column is `patients.aadhaar_id`, a
-- different name for the same thing, and it does exist. That recovery's own investigation
-- missed it, the same "wrong name" failure shape it had just found and fixed for
-- lab_reports/lab_results and consent_forms/patient_consents one migration earlier.
--
-- The gap is live and user-facing today, not theoretical: KNOWN-BUG-123's fix
-- (src/components/patients/PatientRegistrationModal.tsx) stopped writing plaintext to
-- aadhaar_id and instead calls upsert-patient-phi's encrypt_and_write for the aadhaar field —
-- which writes to patients.aadhaar_enc/aadhaar_hash. Without this migration those columns do
-- not exist, so every attempt to save a patient's Aadhaar number 500s (PostgREST: "Could not
-- find the 'aadhaar_enc' column of 'patients' in the schema cache"), surfaced to the user as
-- the destructive toast that fix added on failure. Found via Phase 6 edge-function testing
-- against upsert-patient-phi.
--
-- Same strategy as both prior migrations: additive, nullable, zero-downtime. Does not encrypt
-- any existing plaintext in aadhaar_id — that is phi-backfill-encrypt's job, and aadhaar_id
-- is left in place (never drop a column holding data) until a backfill + verified cutover.

BEGIN;

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS aadhaar_enc  TEXT,
  ADD COLUMN IF NOT EXISTS aadhaar_hash TEXT;

COMMENT ON COLUMN public.patients.aadhaar_enc IS
  'AES-256-GCM encrypted patients.aadhaar_id. DPDP Act sec 8(4). Added 2026-09-13 — the original '
  '20260628000002 migration guarded this on a column named aadhaar_number, which never existed; '
  'the real column is aadhaar_id. Written by upsert-patient-phi''s encrypt_and_write operation.';

COMMENT ON COLUMN public.patients.aadhaar_hash IS
  'HMAC-SHA256 of the normalised Aadhaar digits, for exact-match search without decrypting. '
  'Same recovery as aadhaar_enc.';

-- Exact-match search index, matching the pattern already established for phone_hash/name_hash
-- in 20260628000002. Partial: only rows that have actually been encrypted carry a hash.
CREATE UNIQUE INDEX IF NOT EXISTS patients_aadhaar_hash_idx
  ON public.patients (hospital_id, aadhaar_hash)
  WHERE aadhaar_hash IS NOT NULL;

COMMIT;

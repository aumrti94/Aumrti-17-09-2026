-- Mark a diagnosis as an unconfirmed AI suggestion.
--
-- The voice scribe's structuring prompt was deliberately extract-only: it filled the
-- Diagnosis field ONLY when a diagnosis was spoken aloud, and was explicitly forbidden from
-- inferring one. That is safe but leaves the field empty in an ordinary consultation where
-- the doctor describes findings without naming a diagnosis, which reads as a broken feature.
--
-- The model may now propose a working diagnosis, but it is kept strictly separate from what
-- was actually said:
--   * `opd_encounters.diagnosis` still records only a SPOKEN diagnosis.
--   * A suggestion lands in `opd_diagnoses` with this flag set, is never `is_primary`, and
--     is excluded from the primary-diagnosis resolution that feeds the encounter record,
--     ICD coding and billing (see syncPrimary in DiagnosisPanel.tsx).
--   * Clearing the flag is the doctor's explicit "Confirm" action, after which it behaves
--     as any other diagnosis.
--
-- Default false, so every existing row is treated as a human diagnosis — which it is.

ALTER TABLE opd_diagnoses
  ADD COLUMN IF NOT EXISTS is_ai_suggested BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN opd_diagnoses.is_ai_suggested IS
  'True while this diagnosis is an unconfirmed AI suggestion. Such rows are never primary and are excluded from ICD coding and billing until a clinician confirms them (which sets this back to false).';

-- Partial index: the UI and any audit of unreviewed AI output only ever query the true side,
-- which is expected to be a small minority of rows.
CREATE INDEX IF NOT EXISTS idx_opd_diagnoses_ai_suggested
  ON opd_diagnoses (encounter_id)
  WHERE is_ai_suggested = true;

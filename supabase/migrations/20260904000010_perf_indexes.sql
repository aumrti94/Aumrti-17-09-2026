-- Performance indexes for the 4 highest-traffic tables that had zero indexes.
-- Every query against these tables was doing a full sequential scan.

-- opd_tokens: queried on every OPD load, TV display, and 4 realtime subs
CREATE INDEX IF NOT EXISTS idx_opd_tokens_hospital_status
  ON opd_tokens(hospital_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_opd_tokens_hospital_date
  ON opd_tokens(hospital_id, visit_date, status);

CREATE INDEX IF NOT EXISTS idx_opd_tokens_patient
  ON opd_tokens(patient_id);

-- nursing_mar: queried by medication_id IN (...) + status on every nursing page load
CREATE INDEX IF NOT EXISTS idx_nursing_mar_medication
  ON nursing_mar(medication_id, scheduled_time);

CREATE INDEX IF NOT EXISTS idx_nursing_mar_hospital_pending
  ON nursing_mar(hospital_id, scheduled_time)
  WHERE administered_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_nursing_mar_admission_date
  ON nursing_mar(admission_id, scheduled_date);

-- ipd_vitals: queried by admission_id IN (...) ORDER BY recorded_at DESC for latest-per-patient
CREATE INDEX IF NOT EXISTS idx_ipd_vitals_admission_time
  ON ipd_vitals(admission_id, recorded_at DESC);

-- ipd_medications: queried by admission_id IN (...) in nursing + IPD pages
CREATE INDEX IF NOT EXISTS idx_ipd_medications_admission
  ON ipd_medications(admission_id, is_active);

CREATE INDEX IF NOT EXISTS idx_ipd_medications_hospital
  ON ipd_medications(hospital_id, created_at DESC);

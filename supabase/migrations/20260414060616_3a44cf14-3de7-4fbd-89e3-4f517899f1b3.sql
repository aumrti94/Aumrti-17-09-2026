-- Backfill encounter doctor_id from tokens
UPDATE opd_encounters e
SET doctor_id = t.doctor_id
FROM opd_tokens t
WHERE e.token_id = t.id
  AND t.doctor_id IS NOT NULL
  AND e.doctor_id != t.doctor_id;

-- Backfill bill encounter_id from encounters
UPDATE bills b
SET encounter_id = e.id
FROM opd_encounters e
WHERE b.bill_type = 'opd'
  AND b.encounter_id IS NULL
  AND b.patient_id = e.patient_id
  AND b.bill_date = e.visit_date
  AND b.hospital_id = e.hospital_id;
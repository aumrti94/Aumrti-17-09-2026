
ALTER TABLE patients ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Backfill UHIDs using a CTE
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY hospital_id ORDER BY created_at) AS rn,
         hospital_id, created_at
  FROM patients
  WHERE uhid IS NULL OR uhid = ''
)
UPDATE patients SET uhid = 'UHID-' || UPPER(SUBSTRING(numbered.hospital_id::text, 1, 3)) || '-' || TO_CHAR(numbered.created_at, 'YYYYMMDD') || '-' || LPAD(numbered.rn::text, 4, '0')
FROM numbered WHERE patients.id = numbered.id;

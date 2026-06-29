-- Store dimension + quarantine status on drug_batches, plus return audit table

-- 1. Add store dimension to drug_batches (= pharmacy stock)
ALTER TABLE drug_batches
  ADD COLUMN IF NOT EXISTS store_location_id UUID REFERENCES store_locations(id),
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'
    CHECK (status IN ('active', 'quarantined', 'destroyed'));

CREATE INDEX IF NOT EXISTS idx_drug_batches_store
  ON drug_batches(store_location_id, hospital_id);
CREATE INDEX IF NOT EXISTS idx_drug_batches_status
  ON drug_batches(status, hospital_id);

-- 2. pharmacy_return_audit: full audit trail for every return event
--    (separate from credit_notes — stores stock disposition + bill link)
CREATE TABLE IF NOT EXISTS pharmacy_return_audit (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         UUID REFERENCES hospitals(id),
  dispensing_item_id  UUID REFERENCES pharmacy_dispensing_items(id),
  patient_id          UUID REFERENCES patients(id),
  admission_id        UUID REFERENCES admissions(id),
  bill_id             UUID REFERENCES bills(id),
  credit_note_id      UUID REFERENCES credit_notes(id),
  drug_name           TEXT NOT NULL,
  batch_number        TEXT,
  quantity_returned   NUMERIC(8,2),
  unit_price          NUMERIC(10,2),
  total_refund        NUMERIC(12,2),
  return_reason       TEXT NOT NULL
    CHECK (return_reason IN (
      'unused','excess','patient_discharged','physician_order',
      'wrong_drug','expired','adverse_reaction','prescription_changed',
      'patient_expired','medication_changed','patient_refused','other'
    )),
  stock_action        TEXT
    CHECK (stock_action IN ('returned_to_stock','quarantined','destroyed')),
  bill_adjusted       BOOLEAN DEFAULT FALSE,
  bill_adjustment_at  TIMESTAMPTZ,
  created_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE pharmacy_return_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hospital_isolation" ON pharmacy_return_audit
  USING  (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

CREATE INDEX IF NOT EXISTS idx_pharmacy_return_audit_hospital
  ON pharmacy_return_audit(hospital_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pharmacy_return_audit_patient
  ON pharmacy_return_audit(patient_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_return_audit_bill
  ON pharmacy_return_audit(bill_id)
  WHERE bill_id IS NOT NULL;

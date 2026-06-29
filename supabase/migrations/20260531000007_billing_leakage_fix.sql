-- ============================================================
-- BILLING LEAKAGE FIX
-- Add billing_status + bill_id to ALL service delivery tables
-- that were missing billing integration.
-- ============================================================

-- Standard billing_status values used across all modules:
--   unbilled   → service delivered, not yet billed
--   billed     → bill_line_item created, charge captured
--   waived     → service waived (no charge, intentional)
--   included   → covered under a package/bundle

-- ── dialysis_sessions ──────────────────────────────────────
ALTER TABLE dialysis_sessions
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'unbilled'
    CHECK (billing_status IN ('unbilled','billed','waived','included')),
  ADD COLUMN IF NOT EXISTS bill_id       uuid REFERENCES bills(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS billed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS billed_amount numeric(12,2);

-- ── ed_visits (Emergency Department) ──────────────────────
ALTER TABLE ed_visits
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'unbilled'
    CHECK (billing_status IN ('unbilled','billed','waived','included')),
  ADD COLUMN IF NOT EXISTS bill_id       uuid REFERENCES bills(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS billed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS triage_charge numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ed_charge     numeric(12,2) DEFAULT 0;

-- ── chemo_orders (Oncology) ────────────────────────────────
ALTER TABLE chemo_orders
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'unbilled'
    CHECK (billing_status IN ('unbilled','billed','waived','included')),
  ADD COLUMN IF NOT EXISTS bill_id       uuid REFERENCES bills(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS billed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS billed_amount numeric(12,2);

-- ── ambulance_dispatches ───────────────────────────────────
ALTER TABLE ambulance_dispatches
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'unbilled'
    CHECK (billing_status IN ('unbilled','billed','waived','included')),
  ADD COLUMN IF NOT EXISTS bill_id       uuid REFERENCES bills(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS billed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS trip_charge   numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS per_km_rate   numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS distance_km   numeric(8,2);

-- ── dental_treatment_plans ─────────────────────────────────
-- Add bill_id for idempotency (currently billing is inline, no guard)
ALTER TABLE dental_treatment_plans
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'unbilled'
    CHECK (billing_status IN ('unbilled','billed','waived','included')),
  ADD COLUMN IF NOT EXISTS bill_id       uuid REFERENCES bills(id) ON DELETE SET NULL;

-- ── ivf_cycles ─────────────────────────────────────────────
ALTER TABLE ivf_cycles
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'unbilled'
    CHECK (billing_status IN ('unbilled','billed','waived','included')),
  ADD COLUMN IF NOT EXISTS bill_id       uuid REFERENCES bills(id) ON DELETE SET NULL;

-- ── vaccination_records ─────────────────────────────────────
ALTER TABLE vaccination_records
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'unbilled'
    CHECK (billing_status IN ('unbilled','billed','waived','included')),
  ADD COLUMN IF NOT EXISTS bill_id       uuid REFERENCES bills(id) ON DELETE SET NULL;

-- ── blood_issues (Blood Bank idempotency) ──────────────────
ALTER TABLE blood_issues
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'unbilled'
    CHECK (billing_status IN ('unbilled','billed','waived','included')),
  ADD COLUMN IF NOT EXISTS bill_id       uuid REFERENCES bills(id) ON DELETE SET NULL;

-- ── opd_encounters — add consultation billing tracking ──────
-- opd_encounters may be named differently; use the existing encounters table
ALTER TABLE opd_encounters
  ADD COLUMN IF NOT EXISTS consultation_billed  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consultation_bill_id uuid    REFERENCES bills(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS consultation_fee     numeric(12,2);

-- ── General service charges table (for modules without a specific table) ──
-- Used by: Physiotherapy, Home Care, Mental Health, Mortuary, Dietetics, AYUSH
CREATE TABLE IF NOT EXISTS service_charges (
  id              uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id     uuid    NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  patient_id      uuid    REFERENCES patients(id) ON DELETE SET NULL,
  admission_id    uuid    REFERENCES admissions(id) ON DELETE SET NULL,
  encounter_id    uuid    REFERENCES opd_encounters(id) ON DELETE SET NULL,

  service_module  text    NOT NULL,
    -- physiotherapy | home_care | mental_health | mortuary | dietetics | ayush | cssd | other
  service_ref_id  text,              -- ID from the source module's table (may be any table)
  service_date    date    NOT NULL DEFAULT CURRENT_DATE,
  service_name    text    NOT NULL,
  quantity        int     NOT NULL DEFAULT 1,
  unit_rate       numeric(12,2) NOT NULL,
  gst_percent     numeric(5,2) NOT NULL DEFAULT 0,
  gst_amount      numeric(12,2) NOT NULL DEFAULT 0,
  total_amount    numeric(12,2) NOT NULL,
  therapist_id    uuid    REFERENCES users(id),
  notes           text,

  billing_status  text    NOT NULL DEFAULT 'unbilled'
    CHECK (billing_status IN ('unbilled','billed','waived','included')),
  bill_id         uuid    REFERENCES bills(id) ON DELETE SET NULL,
  billed_at       timestamptz,

  created_by      uuid    REFERENCES users(id),
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE service_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_charges_hospital" ON service_charges
  FOR ALL USING (hospital_id = get_user_hospital_id());

CREATE INDEX IF NOT EXISTS sc_hospital_idx   ON service_charges (hospital_id);
CREATE INDEX IF NOT EXISTS sc_patient_idx    ON service_charges (patient_id);
CREATE INDEX IF NOT EXISTS sc_module_idx     ON service_charges (service_module);
CREATE INDEX IF NOT EXISTS sc_status_idx     ON service_charges (billing_status);
CREATE INDEX IF NOT EXISTS sc_admission_idx  ON service_charges (admission_id);
CREATE INDEX IF NOT EXISTS sc_date_idx       ON service_charges (service_date DESC);

-- ── Revenue leakage dashboard view ─────────────────────────
-- Shows all unbilled service charges across modules for the daily leakage report
CREATE OR REPLACE VIEW unbilled_service_summary AS
SELECT
  hospital_id,
  service_module,
  service_date,
  COUNT(*)                   AS unbilled_count,
  SUM(total_amount)          AS unbilled_amount,
  MIN(service_date)          AS oldest_unbilled_date
FROM service_charges
WHERE billing_status = 'unbilled'
GROUP BY hospital_id, service_module, service_date;

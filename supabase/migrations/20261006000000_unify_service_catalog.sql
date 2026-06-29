-- ============================================================================
-- Unify Service Catalog — Phase 1 (foundation)
-- ----------------------------------------------------------------------------
-- Lets module-owned price rows (starting with ward/bed tariffs) be surfaced and
-- managed from the central Settings → Services & Fees page, while keeping each
-- module's existing entry point and billing path exactly as they are today.
--
-- STRICTLY ADDITIVE: no existing column is dropped, renamed, or has its default
-- altered; no existing source row is modified by this migration. It only adds
-- two link columns to service_master and mirrors ward tariffs INTO the catalog.
-- Idempotent: safe to re-run (IF NOT EXISTS + NOT EXISTS guards).
-- ============================================================================

-- 1. Link a catalog (service_master) row back to the module row it mirrors.
--    e.g. source_table = 'wards', source_id = <ward uuid>.
ALTER TABLE service_master ADD COLUMN IF NOT EXISTS source_table text;
ALTER TABLE service_master ADD COLUMN IF NOT EXISTS source_id uuid;

-- 2. At most one mirror row per source record per hospital — guarantees the
--    bi-directional sync upsert never creates duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_master_source_unique
  ON service_master(hospital_id, source_table, source_id)
  WHERE source_id IS NOT NULL;

-- 3. Backfill: mirror existing ward tariffs into the catalog so they appear in
--    the IPD Beds & Wards tab immediately. Only inserts rows that are missing,
--    so re-running is a no-op. wards.rate_per_day remains the source of truth
--    for IPD bed-day billing (see src/lib/ipdBilling.ts) — untouched here.
INSERT INTO service_master (hospital_id, name, category, fee, item_type, source_table, source_id, is_active)
SELECT
  w.hospital_id,
  w.name || ' (per day)',
  'bed',
  COALESCE(w.rate_per_day, 0),
  'bed_charge',
  'wards',
  w.id,
  true
FROM wards w
WHERE NOT EXISTS (
  SELECT 1 FROM service_master sm
  WHERE sm.hospital_id = w.hospital_id
    AND sm.source_table = 'wards'
    AND sm.source_id = w.id
);

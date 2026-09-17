-- Merge asset_register into fixed_assets
-- asset_register (/assets module) duplicates fixed_assets (/accounts).
-- This migration adds the 5 missing insurance/disposal columns to fixed_assets,
-- copies all asset_register rows over, then retires asset_register.
--
-- ── KNOWN-BUG-118 fix (2026-09-12) — this file was originally timestamped
-- 20260611000001 and has NEVER successfully applied to any database. `fixed_assets`
-- (the table this migration alters and inserts into) is not created until
-- 20260910000010_erp_mci_jci.sql — three months after the original timestamp. Confirmed
-- by grepping every migration touching `fixed_assets` or `asset_register`: nothing
-- creates the destination table before September, and `supabase db reset` failed at
-- statement 0 of this file with `relation "public.fixed_assets" does not exist`, cleanly,
-- after 211 migrations had applied. Renamed via `git mv` to sort after its dependency;
-- content is otherwise unchanged except the drop-vs-rename fix below. No application code
-- references `asset_register` or `depreciation_ledger` (grepped `src/` and
-- `supabase/functions/` — zero hits), so the merge and retirement are safe to run.
--
-- Also: the original ended with `DROP TABLE IF EXISTS ... CASCADE` for both source
-- tables, which is exactly what CLAUDE.md and the supabase-migration skill forbid —
-- "Never drop a table in a production migration." Since this migration had never
-- actually run anywhere, this is the cheapest possible point to fix that: both tables
-- are renamed to a `_retired_` prefix instead, so the migrated data survives under a
-- new name rather than being destroyed. Nothing reads them under their old names again.

-- 1. Add columns that exist in asset_register but not yet in fixed_assets
ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS insurance_policy_no  text,
  ADD COLUMN IF NOT EXISTS insurance_provider   text,
  ADD COLUMN IF NOT EXISTS insurance_expiry     date,
  ADD COLUMN IF NOT EXISTS insurance_premium    numeric(12,2),
  ADD COLUMN IF NOT EXISTS disposal_reason      text;

-- 2. Copy rows from asset_register into fixed_assets, if asset_register still exists.
--    Guarded rather than assumed: this migration is idempotent, and a re-run after the
--    tables have already been renamed away (step 3) must not fail looking for a table
--    that is no longer there under this name.
--    Skip if the same asset_code already exists for that hospital.
--    Column name differences handled here:
--      acquisition_date  → purchase_date
--      acquisition_cost  → purchase_cost
--      residual_value    → salvage_value
--      accumulated_depreciation → accumulated_dep
--      is_active=false   → status='disposed', otherwise 'active'
--      depreciation_method 'slm' → 'straight_line'
--      category 'equipment' → 'medical_equipment' (closest match)
--      disposal_date     → disposed_at
--      disposal_amount   → disposal_value
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'asset_register' AND c.relkind = 'r'
  ) THEN
    INSERT INTO public.fixed_assets (
      hospital_id,
      asset_code,
      asset_name,
      category,
      purchase_date,
      purchase_cost,
      useful_life_years,
      depreciation_method,
      salvage_value,
      accumulated_dep,
      current_book_value,
      notes,
      insurance_policy_no,
      insurance_provider,
      insurance_expiry,
      insurance_premium,
      disposed_at,
      disposal_value,
      disposal_reason,
      status
    )
    SELECT
      ar.hospital_id,
      ar.asset_code,
      ar.asset_name,
      CASE ar.category
        WHEN 'equipment'  THEN 'medical_equipment'
        WHEN 'land'       THEN 'land'
        WHEN 'building'   THEN 'building'
        WHEN 'vehicle'    THEN 'vehicle'
        ELSE 'other'
      END,
      ar.acquisition_date,
      ar.acquisition_cost,
      ar.useful_life_years,
      CASE ar.depreciation_method
        WHEN 'slm' THEN 'straight_line'
        WHEN 'wdv' THEN 'wdv'
        ELSE 'straight_line'
      END,
      COALESCE(ar.residual_value, 0),
      COALESCE(ar.accumulated_depreciation, 0),
      GREATEST(ar.acquisition_cost - COALESCE(ar.accumulated_depreciation, 0), 0),
      ar.notes,
      ar.insurance_policy_no,
      ar.insurance_provider,
      ar.insurance_expiry,
      ar.insurance_premium,
      ar.disposal_date,
      ar.disposal_amount,
      ar.disposal_reason,
      CASE WHEN ar.is_active = false THEN 'disposed' ELSE 'active' END
    FROM public.asset_register ar
    ON CONFLICT (hospital_id, asset_code) DO NOTHING;
  END IF;
END;
$$;

-- 3. Retire the now-redundant tables. Renamed, not dropped — CLAUDE.md: "Never drop a
--    table in a production migration." `depreciation_ledger` first, since it FKs to
--    asset_register and the rename order should mirror the dependency direction.
ALTER TABLE IF EXISTS public.depreciation_ledger RENAME TO _retired_depreciation_ledger;
ALTER TABLE IF EXISTS public.asset_register      RENAME TO _retired_asset_register;

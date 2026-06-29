-- Merge asset_register into fixed_assets
-- asset_register (/assets module) duplicates fixed_assets (/accounts).
-- This migration adds the 5 missing insurance/disposal columns to fixed_assets,
-- copies all asset_register rows over, then drops asset_register.

-- 1. Add columns that exist in asset_register but not yet in fixed_assets
ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS insurance_policy_no  text,
  ADD COLUMN IF NOT EXISTS insurance_provider   text,
  ADD COLUMN IF NOT EXISTS insurance_expiry     date,
  ADD COLUMN IF NOT EXISTS insurance_premium    numeric(12,2),
  ADD COLUMN IF NOT EXISTS disposal_reason      text;

-- 2. Copy rows from asset_register into fixed_assets
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

-- 3. Drop the now-redundant table (and its dependent depreciation_ledger rows)
DROP TABLE IF EXISTS public.depreciation_ledger CASCADE;
DROP TABLE IF EXISTS public.asset_register CASCADE;

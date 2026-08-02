-- Let a hospital configure a custom GST % per ward that overrides the
-- statutory room-charge calculation (ICU exempt, >₹5,000/day non-ICU = 5%,
-- else 0% — see src/lib/gstRules.ts getRoomChargeGSTRate). That function
-- remains the default; this is an explicit, documented per-ward override for
-- hospitals with a specific compliance reason to bill differently.

ALTER TABLE public.wards ADD COLUMN IF NOT EXISTS gst_applicable boolean NOT NULL DEFAULT false;
ALTER TABLE public.wards ADD COLUMN IF NOT EXISTS gst_percent numeric NOT NULL DEFAULT 0;

-- Extend the shared catalog-mirror upsert with optional GST columns so the
-- ward's override is also visible to the generic billing picker (which reads
-- service_master, not wards, for ad-hoc line items — see
-- resolveServiceGstPercent in src/lib/gstRules.ts, whose mirror-row branch
-- already prefers an explicit configured rate over the statutory default).
-- The other 4 mirror triggers (lab/radiology/packages/service_rates) don't
-- pass these new params, so they keep getting the column defaults
-- (false/0) exactly as before — non-breaking for them.
CREATE OR REPLACE FUNCTION public.upsert_service_catalog_mirror(
  p_hospital_id uuid,
  p_source_table text,
  p_source_id uuid,
  p_name text,
  p_category text,
  p_item_type text,
  p_fee numeric,
  p_is_active boolean,
  p_gst_applicable boolean DEFAULT false,
  p_gst_percent numeric DEFAULT 0
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_hospital_id IS NULL OR p_source_id IS NULL OR p_name IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO service_master (
    hospital_id, name, category, fee, item_type, source_table, source_id, is_active,
    gst_applicable, gst_percent
  ) VALUES (
    p_hospital_id, p_name, p_category, COALESCE(p_fee, 0), p_item_type,
    p_source_table, p_source_id, COALESCE(p_is_active, true),
    COALESCE(p_gst_applicable, false), COALESCE(p_gst_percent, 0)
  )
  ON CONFLICT (hospital_id, source_table, source_id) WHERE source_id IS NOT NULL
  DO UPDATE SET
    name           = EXCLUDED.name,
    category       = EXCLUDED.category,
    fee            = EXCLUDED.fee,
    item_type      = EXCLUDED.item_type,
    is_active      = EXCLUDED.is_active,
    gst_applicable = EXCLUDED.gst_applicable,
    gst_percent    = EXCLUDED.gst_percent;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_ward_to_catalog()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM deactivate_service_catalog_mirror(OLD.hospital_id, 'wards', OLD.id);
    RETURN OLD;
  END IF;
  PERFORM upsert_service_catalog_mirror(
    NEW.hospital_id, 'wards', NEW.id,
    NEW.name || ' (per day)', 'bed', ward_catalog_item_type(NEW.type::text),
    NEW.rate_per_day, COALESCE(NEW.is_active, true),
    COALESCE(NEW.gst_applicable, false), COALESCE(NEW.gst_percent, 0)
  );
  RETURN NEW;
END;
$$;

-- Phase 4 (Tier 1): barcode lookup key for USB keyboard-wedge scanners.
-- item_code already exists (free text); barcode is a dedicated GTIN/scan value.
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS barcode text;
CREATE INDEX IF NOT EXISTS idx_inventory_items_barcode ON public.inventory_items(hospital_id, barcode);

-- Phase 8 (Tier 3): GST state infra + CGST/SGST/IGST split on procurement documents.
-- state_code (2-digit GST code) on hospitals & vendors drives intra- vs inter-state; the
-- split amounts are stored per-PO and per-line. Additive.

ALTER TABLE public.hospitals ADD COLUMN IF NOT EXISTS state_code text;
ALTER TABLE public.vendors   ADD COLUMN IF NOT EXISTS state_code text;

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS cgst_amount numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount numeric(14,2) DEFAULT 0;

ALTER TABLE public.po_items
  ADD COLUMN IF NOT EXISTS cgst_amount numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount numeric(14,2) DEFAULT 0;

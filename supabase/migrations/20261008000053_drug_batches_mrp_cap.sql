-- Pharmacy gap-fill plan, Phase 14 — confirmed zero validation anywhere (client or DB)
-- that sale_price <= mrp. Selling above printed MRP is illegal (Legal Metrology Act).
-- Clamp any existing violating rows before adding the constraint so this migration
-- can't fail on pre-existing bad data.
UPDATE public.drug_batches SET sale_price = mrp WHERE sale_price > mrp;

ALTER TABLE public.drug_batches
  ADD CONSTRAINT drug_batches_sale_price_le_mrp CHECK (sale_price <= mrp);

-- Tier C: GST input-credit eligibility (Sec 17(5)) per item + default TDS section per vendor.
-- itc_eligibility drives how GST is posted at GRN: 'eligible' -> GST input credit (1050);
-- 'blocked' -> GST folded into goods cost (no ITC); 'proportionate' -> half/half.
-- Defaults keep current behaviour ('eligible'). Additive.

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS itc_eligibility text NOT NULL DEFAULT 'eligible'
    CHECK (itc_eligibility IN ('eligible','blocked','proportionate')),
  ADD COLUMN IF NOT EXISTS itc_reason text;

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS default_tds_section text;

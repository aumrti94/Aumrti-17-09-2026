-- G3 (OT slice): let OT implants/consumables that were pulled from the central inventory
-- master actually deduct stock on consumption. inventory_item_id is set only when the
-- implant was chosen from the inventory autocomplete; stock_deducted guards against
-- double-deduction and enables reversal if the line is removed. Additive, nullable.

ALTER TABLE public.ot_implants
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES public.inventory_items(id),
  ADD COLUMN IF NOT EXISTS stock_deducted boolean DEFAULT false;

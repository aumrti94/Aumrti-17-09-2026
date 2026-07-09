-- Ward Store Realization — Phase 1: item linkage.
-- Links ward/sub-store indent lines and stock movements to the inventory_items master
-- (previously free-text only). All columns nullable so legacy free-text rows keep working.
-- Additive only.

ALTER TABLE public.store_indent_items
  ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES public.inventory_items(id);

ALTER TABLE public.store_stock_movements
  ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES public.inventory_items(id),
  ADD COLUMN IF NOT EXISTS batch_number text,
  ADD COLUMN IF NOT EXISTS expiry_date date;

CREATE INDEX IF NOT EXISTS idx_store_indent_items_item ON public.store_indent_items(item_id);
CREATE INDEX IF NOT EXISTS idx_store_movements_item ON public.store_stock_movements(item_id);

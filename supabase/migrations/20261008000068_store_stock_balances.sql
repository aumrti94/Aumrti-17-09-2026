-- Ward Store Realization — Phase 2: per-store on-hand balances.
-- Sub-stores (ward/ot/icu/pharmacy/lab store_locations) get real batch-level balances here.
-- The CENTRAL store remains inventory_stock (single source of truth) — it is NOT duplicated
-- into store_stock, to avoid double-counting in the future consolidated rollup view.
-- Balances start empty and are populated by Phase 3 (issue) movements. Additive only.

CREATE TABLE IF NOT EXISTS public.store_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  store_id uuid REFERENCES public.store_locations(id) NOT NULL,
  item_id uuid REFERENCES public.inventory_items(id) NOT NULL,
  batch_number text,
  expiry_date date,
  quantity_available numeric(12,2) NOT NULL DEFAULT 0,
  cost_price numeric(12,2),
  is_consignment boolean DEFAULT false,
  consignment_vendor_id uuid REFERENCES public.vendors(id),
  last_movement_at timestamptz DEFAULT now(),
  UNIQUE (store_id, item_id, batch_number)
);

CREATE INDEX IF NOT EXISTS idx_store_stock_hospital ON public.store_stock(hospital_id);
CREATE INDEX IF NOT EXISTS idx_store_stock_store ON public.store_stock(store_id);
CREATE INDEX IF NOT EXISTS idx_store_stock_item ON public.store_stock(item_id);

ALTER TABLE public.store_stock ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hospital_isolation" ON public.store_stock;
CREATE POLICY "hospital_isolation" ON public.store_stock
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

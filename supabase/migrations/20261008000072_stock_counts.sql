-- Phase 3 (Tier 1): physical stock-take / cycle-count.
-- A count session snapshots system quantities per batch (central inventory_stock or a
-- sub-store's store_stock), captures the physical count, and on posting writes variances
-- back and logs them to the ledger. Additive.

CREATE TABLE IF NOT EXISTS public.stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  count_number text,
  store_id uuid REFERENCES public.store_locations(id),  -- NULL = central store
  scope text NOT NULL DEFAULT 'central' CHECK (scope IN ('central','store')),
  status text NOT NULL DEFAULT 'counting' CHECK (status IN ('counting','posted','cancelled')),
  counted_by uuid REFERENCES public.users(id),
  approved_by uuid REFERENCES public.users(id),
  notes text,
  created_at timestamptz DEFAULT now(),
  posted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_stock_counts_hospital ON public.stock_counts(hospital_id, status);

CREATE TABLE IF NOT EXISTS public.stock_count_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid REFERENCES public.stock_counts(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.inventory_items(id),
  item_name text,
  stock_row_id uuid,          -- inventory_stock.id or store_stock.id being counted
  batch_number text,
  system_qty numeric(12,2) NOT NULL DEFAULT 0,
  counted_qty numeric(12,2),
  variance numeric(12,2)
);
CREATE INDEX IF NOT EXISTS idx_stock_count_items_count ON public.stock_count_items(count_id);

ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hospital_isolation" ON public.stock_counts;
CREATE POLICY "hospital_isolation" ON public.stock_counts
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

ALTER TABLE public.stock_count_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hospital_isolation" ON public.stock_count_items;
CREATE POLICY "hospital_isolation" ON public.stock_count_items
  USING (EXISTS (SELECT 1 FROM public.stock_counts sc WHERE sc.id = stock_count_items.count_id AND sc.hospital_id = get_user_hospital_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.stock_counts sc WHERE sc.id = stock_count_items.count_id AND sc.hospital_id = get_user_hospital_id()));

CREATE SEQUENCE IF NOT EXISTS stock_count_seq START 1000;
CREATE OR REPLACE FUNCTION generate_stock_count_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.count_number IS NULL THEN
    NEW.count_number := 'SC-' || to_char(now(), 'YYYYMM') || '-' || LPAD(nextval('stock_count_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_stock_count_number ON public.stock_counts;
CREATE TRIGGER trg_stock_count_number BEFORE INSERT ON public.stock_counts
  FOR EACH ROW EXECUTE FUNCTION generate_stock_count_number();

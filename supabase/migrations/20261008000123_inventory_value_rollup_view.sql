-- Inventory value-on-hand rollup for Analytics & BI (Revenue tab "Scheme & Ops" tiles).
-- No pre-aggregated inventory value/spend table exists — inventory_stock carries
-- hospital_id directly (confirmed in migration 20260324080900), so this is a
-- straightforward per-hospital SUM(quantity_available * cost_price).
--
-- security_invoker = true is required: without it, a view runs with the permissions
-- of the view owner (the migration role), which would bypass inventory_stock's RLS
-- and leak cross-tenant stock values to any authenticated user querying this view.

CREATE OR REPLACE VIEW public.inventory_value_by_hospital
WITH (security_invoker = true) AS
SELECT
  hospital_id,
  SUM(COALESCE(quantity_available, 0) * COALESCE(cost_price, 0)) AS value_on_hand
FROM public.inventory_stock
GROUP BY hospital_id;

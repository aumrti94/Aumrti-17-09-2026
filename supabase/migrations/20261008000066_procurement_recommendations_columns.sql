-- Procurement Recommendations: add the columns the ProcurementRecommendationsPage
-- (routed /inventory/procurement-recommendations, linked from the HOD dashboard) reads
-- and writes. The original v9 foundation table only had recommended_quantity/reasoning/
-- status, so the reorder-breach scan, stockout-estimate refresh, and list query all
-- errored against non-existent columns. Additive only — no data touched.

ALTER TABLE public.procurement_recommendations
  ADD COLUMN IF NOT EXISTS current_stock numeric,
  ADD COLUMN IF NOT EXISTS expected_stockout_date date,
  ADD COLUMN IF NOT EXISTS priority text,
  ADD COLUMN IF NOT EXISTS priority_score integer,
  ADD COLUMN IF NOT EXISTS recommendation_type text,
  ADD COLUMN IF NOT EXISTS recommendation_text text,
  ADD COLUMN IF NOT EXISTS forecast_7d numeric,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

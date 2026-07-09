-- Tier A / P1-P2: demand forecasting engine (statistical core, in-DB).
-- item_consumption_daily is a per-item daily rollup of real consumption (issues + OT/nursing
-- consumption) from stock_transactions. run_inventory_forecast() reads it to predict stockout
-- dates + order quantities and writes procurement_recommendations (type 'forecast') with a
-- confidence score. Functions are SECURITY INVOKER — RLS on the underlying tables confines
-- each caller to their own hospital. Additive.

-- Daily consumption rollup ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.item_consumption_daily (
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  consumption_date date NOT NULL,
  qty_consumed numeric(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (hospital_id, item_id, consumption_date)
);
ALTER TABLE public.item_consumption_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hospital_isolation" ON public.item_consumption_daily;
CREATE POLICY "hospital_isolation" ON public.item_consumption_daily
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

-- procurement_recommendations gains a confidence score (Santosh's rule: never a bare number)
ALTER TABLE public.procurement_recommendations
  ADD COLUMN IF NOT EXISTS confidence_score numeric(5,2);

-- Refresh last 180d of the rollup from actual consumption transactions ----------
CREATE OR REPLACE FUNCTION public.refresh_item_consumption_daily(p_hospital_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.item_consumption_daily
   WHERE hospital_id = p_hospital_id AND consumption_date >= current_date - 180;

  INSERT INTO public.item_consumption_daily (hospital_id, item_id, consumption_date, qty_consumed)
  SELECT hospital_id, item_id, created_at::date, SUM(-quantity)
  FROM public.stock_transactions
  WHERE hospital_id = p_hospital_id
    AND quantity < 0
    AND transaction_type IN ('indent_issue','ot_consumption','nursing_consumption','store_issue')
    AND created_at >= current_date - 180
  GROUP BY hospital_id, item_id, created_at::date
  ON CONFLICT (hospital_id, item_id, consumption_date) DO UPDATE SET qty_consumed = EXCLUDED.qty_consumed;
END $$;

-- Forecast: predict stockout + recommended order qty for at-risk items ----------
CREATE OR REPLACE FUNCTION public.run_inventory_forecast(p_hospital_id uuid)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_count int;
BEGIN
  PERFORM public.refresh_item_consumption_daily(p_hospital_id);

  -- refresh only the auto-generated pending forecasts; keep accepted/rejected + manual scans
  DELETE FROM public.procurement_recommendations
   WHERE hospital_id = p_hospital_id AND status = 'pending' AND recommendation_type = 'forecast';

  WITH cons AS (
    SELECT item_id,
           SUM(qty_consumed) FILTER (WHERE consumption_date >= current_date - 60) AS c60,
           COUNT(DISTINCT consumption_date) FILTER (WHERE consumption_date >= current_date - 60) AS days_with_data
    FROM public.item_consumption_daily
    WHERE hospital_id = p_hospital_id
    GROUP BY item_id
  ),
  stock AS (
    SELECT item_id, SUM(quantity_available) AS on_hand
    FROM public.inventory_stock WHERE hospital_id = p_hospital_id GROUP BY item_id
  ),
  calc AS (
    SELECT i.id AS item_id, i.reorder_level, i.max_stock_level, i.minimum_order_qty,
           COALESCE(s.on_hand,0) AS on_hand,
           COALESCE(c.c60,0) / 60.0 AS daily,
           COALESCE(c.days_with_data,0) AS ddays
    FROM public.inventory_items i
    LEFT JOIN cons c ON c.item_id = i.id
    LEFT JOIN stock s ON s.item_id = i.id
    WHERE i.hospital_id = p_hospital_id AND i.is_active
  ),
  fc AS (
    SELECT *,
      floor(on_hand / daily)::int AS dts,
      round(daily * 7)::int AS f7,
      least(100, round((ddays / 60.0) * 100))::numeric(5,2) AS conf,
      greatest(COALESCE(max_stock_level, reorder_level * 3) - on_hand, COALESCE(minimum_order_qty, 1))::int AS order_qty
    FROM calc
    WHERE daily > 0 AND (on_hand <= reorder_level OR on_hand / daily <= 21)
  ),
  ins AS (
    INSERT INTO public.procurement_recommendations
      (hospital_id, item_id, recommended_quantity, current_stock, expected_stockout_date,
       priority, priority_score, recommendation_type, recommendation_text, forecast_7d, confidence_score, status, reasoning)
    SELECT p_hospital_id, item_id, order_qty, on_hand, current_date + dts,
      CASE WHEN on_hand = 0 THEN 'critical' WHEN dts <= 7 THEN 'high' WHEN dts <= 14 THEN 'medium' ELSE 'low' END,
      CASE WHEN on_hand = 0 THEN 100 WHEN dts <= 7 THEN 80 WHEN dts <= 14 THEN 60 ELSE 40 END,
      'forecast',
      'Forecast ~' || round(daily,1) || '/day. ' ||
        CASE WHEN on_hand = 0 THEN 'OUT OF STOCK.' ELSE 'Est. stockout in ' || dts || 'd (' || to_char(current_date + dts, 'DD Mon') || ').' END ||
        ' Suggest order ' || order_qty || '.',
      f7, conf, 'pending',
      'Auto-forecast ' || to_char(now(), 'DD Mon YYYY') || '; ' || ddays || 'd history.'
    FROM fc
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  INSERT INTO public.demand_forecasts (hospital_id, item_id, forecast_date, predicted_consumption, confidence_score)
  SELECT p_hospital_id, item_id, current_date, round(daily * 30, 2), conf FROM fc;

  RETURN v_count;
END $$;

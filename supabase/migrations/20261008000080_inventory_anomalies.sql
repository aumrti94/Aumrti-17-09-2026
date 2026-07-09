-- Tier A / P4: inventory anomaly & leakage detection (rules-first, in-DB).
-- run_inventory_anomaly_scan() writes deterministic, auditable anomalies to inventory_anomalies.
-- SECURITY INVOKER — RLS confines each caller to their hospital. Additive.

CREATE TABLE IF NOT EXISTS public.inventory_anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  item_id uuid REFERENCES public.inventory_items(id),
  anomaly_type text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  detail text,
  detected_at timestamptz DEFAULT now(),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed')),
  reviewed_by uuid REFERENCES public.users(id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_anomalies_hospital ON public.inventory_anomalies(hospital_id, status);

ALTER TABLE public.inventory_anomalies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hospital_isolation" ON public.inventory_anomalies;
CREATE POLICY "hospital_isolation" ON public.inventory_anomalies
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

CREATE OR REPLACE FUNCTION public.run_inventory_anomaly_scan(p_hospital_id uuid)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_count int;
BEGIN
  PERFORM public.refresh_item_consumption_daily(p_hospital_id);

  -- clear prior auto-open anomalies (keep reviewed/dismissed)
  DELETE FROM public.inventory_anomalies WHERE hospital_id = p_hospital_id AND status = 'open';

  -- 1) Off-contract price: latest GRN rate exceeds the vendor's active contract by >10%
  INSERT INTO public.inventory_anomalies (hospital_id, item_id, anomaly_type, severity, detail)
  WITH latest_grn AS (
    SELECT DISTINCT ON (gi.item_id) gi.item_id, gi.unit_rate, gr.vendor_id
    FROM public.grn_items gi JOIN public.grn_records gr ON gr.id = gi.grn_id
    WHERE gr.hospital_id = p_hospital_id AND gr.grn_date >= current_date - 90
    ORDER BY gi.item_id, gr.grn_date DESC
  )
  SELECT p_hospital_id, lg.item_id, 'off_contract_price', 'high',
    'Latest GRN rate ₹' || lg.unit_rate || ' exceeds contract ₹' || rc.rate || ' by ' || round((lg.unit_rate - rc.rate) / rc.rate * 100) || '%'
  FROM latest_grn lg
  JOIN public.vendor_rate_contracts rc ON rc.item_id = lg.item_id AND rc.vendor_id = lg.vendor_id AND rc.is_active
    AND (rc.valid_to IS NULL OR rc.valid_to >= current_date)
  WHERE lg.unit_rate > rc.rate * 1.1;

  -- 2) Consumption spike: a day in the last 14d exceeds 3x the item's 14-60d baseline
  INSERT INTO public.inventory_anomalies (hospital_id, item_id, anomaly_type, severity, detail)
  WITH base AS (
    SELECT item_id, AVG(qty_consumed) AS avg_daily
    FROM public.item_consumption_daily
    WHERE hospital_id = p_hospital_id AND consumption_date BETWEEN current_date - 60 AND current_date - 14
    GROUP BY item_id HAVING AVG(qty_consumed) > 0
  ),
  recent AS (
    SELECT item_id, MAX(qty_consumed) AS peak
    FROM public.item_consumption_daily
    WHERE hospital_id = p_hospital_id AND consumption_date >= current_date - 14
    GROUP BY item_id
  )
  SELECT p_hospital_id, r.item_id, 'consumption_spike', 'medium',
    'Peak ' || r.peak || '/day vs baseline ' || round(b.avg_daily, 1) || '/day'
  FROM recent r JOIN base b ON b.item_id = r.item_id
  WHERE r.peak > b.avg_daily * 3;

  -- 3) Abnormal adjustment / write-off in the last 30d
  INSERT INTO public.inventory_anomalies (hospital_id, item_id, anomaly_type, severity, detail)
  SELECT p_hospital_id, st.item_id, 'abnormal_adjustment',
    CASE WHEN abs(st.quantity) > 200 THEN 'high' ELSE 'medium' END,
    st.transaction_type || ' of ' || abs(st.quantity) || ' units' || COALESCE(' — ' || st.notes, '')
  FROM public.stock_transactions st
  WHERE st.hospital_id = p_hospital_id AND st.created_at >= current_date - 30
    AND st.transaction_type IN ('disposal', 'expired', 'count_variance', 'adjustment')
    AND abs(st.quantity) > 50;

  -- 4) Dead stock: on-hand but no consumption in 90 days
  INSERT INTO public.inventory_anomalies (hospital_id, item_id, anomaly_type, severity, detail)
  WITH stock AS (
    SELECT item_id, SUM(quantity_available) AS oh FROM public.inventory_stock
    WHERE hospital_id = p_hospital_id GROUP BY item_id HAVING SUM(quantity_available) > 0
  ),
  consumed AS (
    SELECT DISTINCT item_id FROM public.item_consumption_daily
    WHERE hospital_id = p_hospital_id AND consumption_date >= current_date - 90
  )
  SELECT p_hospital_id, s.item_id, 'dead_stock', 'low', s.oh || ' units on hand, no consumption in 90 days'
  FROM stock s LEFT JOIN consumed c ON c.item_id = s.item_id
  WHERE c.item_id IS NULL;

  -- 5) Un-billed consumption (revenue leakage): consumed from stock but the source doc isn't billed
  INSERT INTO public.inventory_anomalies (hospital_id, item_id, anomaly_type, severity, detail)
  SELECT p_hospital_id, npc.inventory_item_id, 'unbilled_consumption', 'high',
    'Nursing consumable ' || npc.item_name || ' (x' || npc.quantity || ') consumed but procedure not billed'
  FROM public.nursing_procedure_consumables npc
  JOIN public.nursing_procedures np ON np.id = npc.nursing_procedure_id
  WHERE npc.hospital_id = p_hospital_id AND npc.stock_deducted AND npc.inventory_item_id IS NOT NULL
    AND np.billed = false;

  INSERT INTO public.inventory_anomalies (hospital_id, item_id, anomaly_type, severity, detail)
  SELECT p_hospital_id, oc.inventory_item_id, 'unbilled_consumption', 'high',
    'OT consumable ' || oc.item_name || ' consumed but not billed'
  FROM public.ot_consumables oc
  WHERE oc.hospital_id = p_hospital_id AND oc.stock_deducted AND oc.inventory_item_id IS NOT NULL AND oc.billed = false;

  SELECT count(*) INTO v_count FROM public.inventory_anomalies WHERE hospital_id = p_hospital_id AND status = 'open';
  RETURN v_count;
END $$;

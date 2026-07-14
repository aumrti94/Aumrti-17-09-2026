-- Metrics registry entries for the Phase 2 cross-module rollup KPIs added to
-- the Revenue tab's "Scheme & Ops" row (usePMJAYClaimsSummary, usePayrollCostRatio,
-- useInventoryValueOnHand in src/hooks/useAnalyticsData.ts).

INSERT INTO public.metrics_registry
  (metric_key, display_name, tab_key, numerator_description, denominator_description, period_description, methodology_notes, source_tables, owner_persona, caveats) VALUES

  ('analytics.revenue.pmjay_settled', 'PMJAY Settled', 'revenue',
   'SUM(pmjay_claims.settled_amount) for claims with submitted_at in range', 'Total claim count and denial-rate shown as subtitle',
   'Selected date range (submitted_at)',
   'Denial is detected via presence of denial_reason/denial_code on the claim row, not a status-string match (pmjay_claims.status vocabulary is not fully standardized in this codebase).',
   '["pmjay_claims"]', 'Santosh', 'Previously absent from Analytics entirely — only generic insurance_claims was rolled up.'),

  ('analytics.revenue.payroll_cost_ratio', 'Payroll Cost / Revenue', 'revenue',
   'SUM(payroll_runs.total_net) for runs whose month falls inside the selected range', 'Same revenue figure as analytics.revenue.total_collection (bills.paid_amount, non-pharmacy)',
   'Selected date range, payroll_runs matched by month/year',
   'payroll_runs is monthly-granular, not date-range filterable directly — a run is included if its month falls anywhere inside the selected range.',
   '["payroll_runs", "bills"]', 'Santosh', 'Previously absent from Analytics entirely.'),

  ('analytics.revenue.inventory_value_on_hand', 'Inventory Value on Hand', 'revenue',
   'SUM(inventory_stock.quantity_available * inventory_stock.cost_price)', NULL, 'Point-in-time (current stock, not range-filtered)',
   'Reads the inventory_value_by_hospital view (migration 20261008000123), created WITH (security_invoker = true) so RLS on inventory_stock is respected rather than bypassed by the view owner.',
   '["inventory_stock"]', 'Santosh', 'Previously absent from Analytics entirely; no dedicated inventory value/spend summary table existed before this view.')

ON CONFLICT (metric_key) DO NOTHING;

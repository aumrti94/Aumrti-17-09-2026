-- Phase 7 (Tier 2): PO approval matrix (value thresholds) + cost-centre tagging.
-- Cost centres are modelled as departments (same convention as accounting's cost_centre_id).
-- Approval rules define an amount band that requires a given approver role; enforcement is
-- additive on top of the existing segregation-of-duties (creator != approver). Additive.

CREATE TABLE IF NOT EXISTS public.po_approval_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  min_amount numeric(14,2) NOT NULL DEFAULT 0,
  max_amount numeric(14,2),                 -- NULL = no upper bound
  required_role text,                       -- role that must approve in this band
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_approval_rules_hospital ON public.po_approval_rules(hospital_id);

ALTER TABLE public.po_approval_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hospital_isolation" ON public.po_approval_rules;
CREATE POLICY "hospital_isolation" ON public.po_approval_rules
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS cost_centre_id uuid REFERENCES public.departments(id);

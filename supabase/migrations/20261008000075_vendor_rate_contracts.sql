-- Phase 6 (Tier 2): vendor rate contracts / rate cards.
-- A negotiated rate for a vendor+item over a validity window; used to auto-fill PO/RFQ
-- rates and flag off-contract pricing. Additive.

CREATE TABLE IF NOT EXISTS public.vendor_rate_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.inventory_items(id),
  rate numeric(12,2) NOT NULL,
  gst_percent numeric(5,2) DEFAULT 12,
  valid_from date,
  valid_to date,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rate_contracts_lookup ON public.vendor_rate_contracts(hospital_id, vendor_id, item_id, is_active);

ALTER TABLE public.vendor_rate_contracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hospital_isolation" ON public.vendor_rate_contracts;
CREATE POLICY "hospital_isolation" ON public.vendor_rate_contracts
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

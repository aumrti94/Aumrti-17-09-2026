-- Phase 10 (Tier 3): TDS on purchase + partial vendor payments.
-- tds_sections holds the deductible sections; a vendor payment can deduct TDS (Dr AP /
-- Cr Bank + Cr TDS Payable). purchase_orders tracks TDS + supports part payment via the
-- existing paid_amount. Additive. Seeds common sections per hospital.

CREATE TABLE IF NOT EXISTS public.tds_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  section text NOT NULL,
  rate numeric(5,2) NOT NULL,
  threshold numeric(14,2) DEFAULT 0,
  description text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE (hospital_id, section)
);
ALTER TABLE public.tds_sections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hospital_isolation" ON public.tds_sections;
CREATE POLICY "hospital_isolation" ON public.tds_sections
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS tds_amount numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tds_section text;

-- Seed common TDS sections for existing hospitals
INSERT INTO public.tds_sections (hospital_id, section, rate, threshold, description)
SELECT h.id, s.section, s.rate, s.threshold, s.description
FROM public.hospitals h
CROSS JOIN (VALUES
  ('194C', 2.0, 100000, 'Payment to contractors'),
  ('194J', 10.0, 30000, 'Professional / technical fees'),
  ('194Q', 0.1, 5000000, 'Purchase of goods')
) AS s(section, rate, threshold, description)
ON CONFLICT (hospital_id, section) DO NOTHING;

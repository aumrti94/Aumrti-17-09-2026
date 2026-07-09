-- Phase 5 (Tier 2): Purchase Requisition -> RFQ -> Vendor Quotation -> PO.
-- Greenfield procurement cycle upstream of purchase_orders. Quotations convert to a PO
-- (reusing the existing po_items model). Additive.

CREATE TABLE IF NOT EXISTS public.purchase_requisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  requisition_number text,
  department_id uuid REFERENCES public.departments(id),
  requested_by uuid REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','rfq_created','closed','cancelled')),
  notes text,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.requisition_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id uuid REFERENCES public.purchase_requisitions(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.inventory_items(id),
  quantity numeric(12,2) NOT NULL DEFAULT 1,
  remarks text
);

CREATE TABLE IF NOT EXISTS public.rfqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  rfq_number text,
  requisition_id uuid REFERENCES public.purchase_requisitions(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','awarded','closed','cancelled')),
  due_date date,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.rfq_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id uuid REFERENCES public.rfqs(id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES public.vendors(id)
);

CREATE TABLE IF NOT EXISTS public.vendor_quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  rfq_id uuid REFERENCES public.rfqs(id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES public.vendors(id),
  delivery_days integer,
  notes text,
  total_amount numeric(14,2) DEFAULT 0,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','awarded','rejected')),
  po_id uuid REFERENCES public.purchase_orders(id),
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.quotation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid REFERENCES public.vendor_quotations(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.inventory_items(id),
  quantity numeric(12,2) NOT NULL DEFAULT 1,
  unit_rate numeric(12,2) DEFAULT 0,
  gst_percent numeric(5,2) DEFAULT 12,
  total_amount numeric(14,2) DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_req_items_req ON public.requisition_items(requisition_id);
CREATE INDEX IF NOT EXISTS idx_rfq_vendors_rfq ON public.rfq_vendors(rfq_id);
CREATE INDEX IF NOT EXISTS idx_quotations_rfq ON public.vendor_quotations(rfq_id);
CREATE INDEX IF NOT EXISTS idx_quotation_items_q ON public.quotation_items(quotation_id);

-- RLS: hospital-scoped parents direct; child tables via parent existence.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['purchase_requisitions','rfqs','vendor_quotations']) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "hospital_isolation" ON public.%I', t);
    EXECUTE format('CREATE POLICY "hospital_isolation" ON public.%I USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id())', t);
  END LOOP;
END$$;

ALTER TABLE public.requisition_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "req_items_isolation" ON public.requisition_items;
CREATE POLICY "req_items_isolation" ON public.requisition_items
  USING (EXISTS (SELECT 1 FROM public.purchase_requisitions r WHERE r.id = requisition_items.requisition_id AND r.hospital_id = get_user_hospital_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.purchase_requisitions r WHERE r.id = requisition_items.requisition_id AND r.hospital_id = get_user_hospital_id()));

ALTER TABLE public.rfq_vendors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rfq_vendors_isolation" ON public.rfq_vendors;
CREATE POLICY "rfq_vendors_isolation" ON public.rfq_vendors
  USING (EXISTS (SELECT 1 FROM public.rfqs r WHERE r.id = rfq_vendors.rfq_id AND r.hospital_id = get_user_hospital_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rfqs r WHERE r.id = rfq_vendors.rfq_id AND r.hospital_id = get_user_hospital_id()));

ALTER TABLE public.quotation_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "quotation_items_isolation" ON public.quotation_items;
CREATE POLICY "quotation_items_isolation" ON public.quotation_items
  USING (EXISTS (SELECT 1 FROM public.vendor_quotations q WHERE q.id = quotation_items.quotation_id AND q.hospital_id = get_user_hospital_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.vendor_quotations q WHERE q.id = quotation_items.quotation_id AND q.hospital_id = get_user_hospital_id()));

-- Auto document numbers
CREATE SEQUENCE IF NOT EXISTS requisition_seq START 1000;
CREATE SEQUENCE IF NOT EXISTS rfq_seq START 1000;
CREATE OR REPLACE FUNCTION generate_requisition_number() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN IF NEW.requisition_number IS NULL THEN NEW.requisition_number := 'REQ-' || to_char(now(),'YYYYMM') || '-' || LPAD(nextval('requisition_seq')::text,4,'0'); END IF; RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION generate_rfq_number() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN IF NEW.rfq_number IS NULL THEN NEW.rfq_number := 'RFQ-' || to_char(now(),'YYYYMM') || '-' || LPAD(nextval('rfq_seq')::text,4,'0'); END IF; RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_requisition_number ON public.purchase_requisitions;
CREATE TRIGGER trg_requisition_number BEFORE INSERT ON public.purchase_requisitions FOR EACH ROW EXECUTE FUNCTION generate_requisition_number();
DROP TRIGGER IF EXISTS trg_rfq_number ON public.rfqs;
CREATE TRIGGER trg_rfq_number BEFORE INSERT ON public.rfqs FOR EACH ROW EXECUTE FUNCTION generate_rfq_number();

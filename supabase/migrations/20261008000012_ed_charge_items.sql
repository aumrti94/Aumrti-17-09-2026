-- Itemized Emergency Department charges (Phase 1 — ED billing)
-- Each row is one billable ED line (procedure / consumable / observation / consult).
-- Billed via autoChargeService(sourceTable='ed_charge_items', sourceId=id), which is
-- idempotent on billing_status and stamps bill_id / billed_at back onto the row.
-- Additive only: the existing flat casualty fee (ed_visits.billing_status) is untouched.
CREATE TABLE IF NOT EXISTS public.ed_charge_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
  ed_visit_id UUID NOT NULL REFERENCES public.ed_visits(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id),

  -- What is being charged
  service_master_id UUID REFERENCES public.service_master(id),
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'procedure', -- procedure | consumable | observation | consult
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  gst_percent NUMERIC(5,2) NOT NULL DEFAULT 0,

  -- Billing linkage (stamped by autoChargeService)
  billing_status TEXT NOT NULL DEFAULT 'unbilled', -- unbilled | billed
  bill_id UUID REFERENCES public.bills(id),
  billed_at TIMESTAMPTZ,

  -- Metadata. performed_by is an audit reference to the acting user; it stores the
  -- auth user id (like the app's other ordered_by/created_by columns), so it is a plain
  -- uuid with NO foreign key — matching how autoChargeService records the actor elsewhere.
  performed_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ed_charge_items_hospital_id ON public.ed_charge_items(hospital_id);
CREATE INDEX IF NOT EXISTS idx_ed_charge_items_ed_visit_id ON public.ed_charge_items(ed_visit_id);
CREATE INDEX IF NOT EXISTS idx_ed_charge_items_patient_id ON public.ed_charge_items(patient_id);
CREATE INDEX IF NOT EXISTS idx_ed_charge_items_bill_id ON public.ed_charge_items(bill_id);

ALTER TABLE public.ed_charge_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own hospital ed_charge_items" ON public.ed_charge_items;
CREATE POLICY "Users can view own hospital ed_charge_items"
  ON public.ed_charge_items FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

DROP POLICY IF EXISTS "Users can manage own hospital ed_charge_items" ON public.ed_charge_items;
CREATE POLICY "Users can manage own hospital ed_charge_items"
  ON public.ed_charge_items FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

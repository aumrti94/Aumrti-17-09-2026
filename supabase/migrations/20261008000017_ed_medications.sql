-- ED medication administration record (eMAR) — Phase 7.
-- Records emergency drugs administered during an ED visit. Optionally links to an
-- ed_charge_items row when the drug/consumable is billed. Additive only.
CREATE TABLE IF NOT EXISTS public.ed_medications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
  ed_visit_id UUID NOT NULL REFERENCES public.ed_visits(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id),

  drug_name TEXT NOT NULL,
  dose TEXT,
  route TEXT,
  administered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Audit reference to the acting user; stores the auth user id like the app's other
  -- ordered_by/created_by columns, so it is a plain uuid with NO foreign key.
  administered_by UUID,
  notes TEXT,
  ed_charge_item_id UUID REFERENCES public.ed_charge_items(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ed_medications_hospital_id ON public.ed_medications(hospital_id);
CREATE INDEX IF NOT EXISTS idx_ed_medications_ed_visit_id ON public.ed_medications(ed_visit_id);
CREATE INDEX IF NOT EXISTS idx_ed_medications_patient_id ON public.ed_medications(patient_id);

ALTER TABLE public.ed_medications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own hospital ed_medications" ON public.ed_medications;
CREATE POLICY "Users can view own hospital ed_medications"
  ON public.ed_medications FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

DROP POLICY IF EXISTS "Users can manage own hospital ed_medications" ON public.ed_medications;
CREATE POLICY "Users can manage own hospital ed_medications"
  ON public.ed_medications FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

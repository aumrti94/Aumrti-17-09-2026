-- OT Gap review (Phase 8): real persistence for hospital-custom checklist items
-- and the OT-team equipment checklist (both previously fake/local-only state).
CREATE TABLE public.ot_checklist_custom_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  phase text NOT NULL CHECK (phase IN ('signin', 'timeout', 'signout')),
  item_text text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ot_checklist_custom_items_hospital ON public.ot_checklist_custom_items(hospital_id, phase);

ALTER TABLE public.ot_checklist_custom_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own hospital ot_checklist_custom_items" ON public.ot_checklist_custom_items FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital ot_checklist_custom_items" ON public.ot_checklist_custom_items FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

CREATE TABLE public.ot_equipment_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  ot_schedule_id uuid REFERENCES public.ot_schedules(id) NOT NULL,
  item_text text NOT NULL,
  checked boolean NOT NULL DEFAULT false,
  checked_by uuid,
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ot_schedule_id, item_text)
);

CREATE INDEX idx_ot_equipment_checklist_schedule ON public.ot_equipment_checklist(ot_schedule_id);

ALTER TABLE public.ot_equipment_checklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own hospital ot_equipment_checklist" ON public.ot_equipment_checklist FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
CREATE POLICY "Users can manage own hospital ot_equipment_checklist" ON public.ot_equipment_checklist FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());

-- Lab Test Groups: allow grouping multiple tests into panels (e.g. Lipid Profile)

CREATE TABLE IF NOT EXISTS public.lab_test_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  group_name text NOT NULL,
  group_code text,
  category text,
  fee numeric NOT NULL DEFAULT 0,
  tat_minutes int,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lab_test_group_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.lab_test_groups(id) ON DELETE CASCADE,
  test_id uuid NOT NULL REFERENCES public.lab_test_master(id) ON DELETE CASCADE,
  UNIQUE (group_id, test_id)
);

ALTER TABLE public.lab_test_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_test_group_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lab_test_groups_hospital_isolation"
  ON public.lab_test_groups FOR ALL
  USING (hospital_id IN (
    SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()
  ));

CREATE POLICY "lab_test_group_items_via_group"
  ON public.lab_test_group_items FOR ALL
  USING (group_id IN (
    SELECT id FROM public.lab_test_groups WHERE hospital_id IN (
      SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()
    )
  ));

CREATE INDEX IF NOT EXISTS idx_lab_test_groups_hospital ON public.lab_test_groups(hospital_id);
CREATE INDEX IF NOT EXISTS idx_lab_test_group_items_group ON public.lab_test_group_items(group_id);

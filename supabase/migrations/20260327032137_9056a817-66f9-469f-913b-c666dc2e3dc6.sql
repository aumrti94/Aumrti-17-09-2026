
CREATE TABLE public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  role_name text NOT NULL,
  role_label text NOT NULL,
  is_system_role boolean DEFAULT false,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE(hospital_id, role_name)
);

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own hospital role_permissions"
  ON public.role_permissions FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can manage own hospital role_permissions"
  ON public.role_permissions FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

INSERT INTO public.role_permissions (hospital_id, role_name, role_label, is_system_role, permissions)
SELECT h.id, r.name, r.label, true, r.perms::jsonb
FROM public.hospitals h
CROSS JOIN (VALUES
  ('super_admin','Super Admin','{"all": true}'),
  ('doctor','Doctor','{"opd":"rw","ipd":"rw","lab":"r","radiology":"r","pharmacy":"r","billing":"r","analytics":"r"}'),
  ('nurse','Nurse','{"opd":"r","ipd":"rw","nursing":"rw","pharmacy":"r","lab":"r"}'),
  ('pharmacist','Pharmacist','{"pharmacy":"rw","billing":"r"}'),
  ('lab_technician','Lab Technician','{"lab":"rw","radiology":"r"}'),
  ('billing_executive','Billing Executive','{"billing":"rw","insurance":"rw","pharmacy":"r"}'),
  ('hr_manager','HR Manager','{"hr":"rw","analytics":"r"}'),
  ('receptionist','Receptionist','{"opd":"rw","patients":"rw","billing":"r"}')
) AS r(name, label, perms)
WHERE NOT EXISTS (
  SELECT 1 FROM public.role_permissions rp WHERE rp.hospital_id = h.id
);

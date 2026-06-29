-- Extend staff_attendance with biometric import fields
ALTER TABLE public.staff_attendance
  ADD COLUMN IF NOT EXISTS shift_code TEXT,
  ADD COLUMN IF NOT EXISTS remarks TEXT;

-- payroll_hooks: one row per integration type per hospital
CREATE TABLE IF NOT EXISTS public.payroll_hooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  integration_type TEXT NOT NULL CHECK (integration_type IN ('export_csv', 'tally_payroll', 'third_party_api')),
  label TEXT NOT NULL DEFAULT '',
  config JSONB NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hospital_id, integration_type)
);

ALTER TABLE public.payroll_hooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payroll_hooks_hospital_scoped"
  ON public.payroll_hooks
  USING (hospital_id IN (
    SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()
  ));

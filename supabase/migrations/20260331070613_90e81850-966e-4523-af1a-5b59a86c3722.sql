
-- Lab QC entries table for NABL Westgard monitoring
CREATE TABLE public.lab_qc_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
  test_name TEXT NOT NULL,
  analyzer TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'L1',
  value NUMERIC NOT NULL,
  mean NUMERIC NOT NULL,
  sd NUMERIC NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE public.lab_qc_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lab_qc_entries_hospital_isolation" ON public.lab_qc_entries
  FOR ALL TO authenticated
  USING (hospital_id IN (SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()));

-- Dev permissive policy
CREATE POLICY "lab_qc_entries_dev_anon" ON public.lab_qc_entries
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- Index
CREATE INDEX idx_lab_qc_entries_hospital_test ON public.lab_qc_entries(hospital_id, test_name, analyzer);

CREATE TABLE public.ai_digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  digest_date date NOT NULL DEFAULT current_date,
  digest_text text NOT NULL,
  kpi_snapshot jsonb NOT NULL DEFAULT '{}',
  anomalies jsonb DEFAULT '[]',
  generated_at timestamptz DEFAULT now(),
  delivered_whatsapp boolean DEFAULT false,
  UNIQUE(hospital_id, digest_date)
);

ALTER TABLE public.ai_digests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own hospital digests" ON public.ai_digests
  FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can manage own hospital digests" ON public.ai_digests
  FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());
-- grn_ai_log table for audit trail
CREATE TABLE public.grn_ai_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  grn_id uuid REFERENCES public.grn_records(id),
  invoice_image_url text,
  extraction_confidence numeric(5,2),
  items_extracted integer,
  items_matched integer,
  items_unmatched integer,
  manual_corrections integer DEFAULT 0,
  processing_time_ms integer,
  model_used text DEFAULT 'gemini-2.5-flash',
  created_at timestamptz DEFAULT now()
);

-- Add invoice_image_url to grn_records
ALTER TABLE public.grn_records ADD COLUMN IF NOT EXISTS invoice_image_url text;

-- Storage bucket for invoice images
INSERT INTO storage.buckets (id, name, public)
VALUES ('grn-invoices', 'grn-invoices', true)
ON CONFLICT (id) DO NOTHING;

-- RLS for grn_ai_log
CREATE POLICY "Users can read own hospital grn_ai_log"
  ON public.grn_ai_log FOR SELECT TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Users can insert own hospital grn_ai_log"
  ON public.grn_ai_log FOR INSERT TO authenticated
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- Storage policies for grn-invoices
CREATE POLICY "Auth users can upload grn invoices"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'grn-invoices');

CREATE POLICY "Auth users can read grn invoices"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'grn-invoices');
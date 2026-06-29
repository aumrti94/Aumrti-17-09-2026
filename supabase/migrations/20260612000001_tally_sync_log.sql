-- =============================================================================
-- Tally Integration: export history log
-- Tracks every XML export so accountant has a history and duplicates are prevented
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tally_export_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     uuid        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  export_type     text        NOT NULL DEFAULT 'full_bundle',
    -- 'sales_vouchers' | 'receipt_vouchers' | 'purchase_vouchers' | 'journals' | 'full_bundle'
  date_from       date        NOT NULL,
  date_to         date        NOT NULL,
  voucher_count   integer     NOT NULL DEFAULT 0,
  delivery_method text        NOT NULL DEFAULT 'email',
    -- 'email' | 'download' | 'direct_sync'
  delivery_status text        NOT NULL DEFAULT 'pending',
    -- 'pending' | 'sent' | 'failed'
  xml_size_bytes  integer,
  error_message   text,
  exported_by     uuid        REFERENCES public.users(id),
  exported_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tally_export_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospital isolation" ON public.tally_export_log
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id());

CREATE INDEX IF NOT EXISTS idx_tally_export_log_hospital
  ON public.tally_export_log(hospital_id, exported_at DESC);

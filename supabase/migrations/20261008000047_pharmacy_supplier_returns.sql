-- Pharmacy gap-fill plan, Phase 8 — "Mark for Return" in ExpiryControlTab only ever
-- inserted a to-do-style pharmacy_stock_alerts row (and that insert was broken —
-- it omitted the NOT NULL drug_id column, so it silently failed every time). This
-- adds a real supplier-RMA record: a physical batch marked to go back to the vendor,
-- tracked through pending -> shipped -> credited.

CREATE TABLE IF NOT EXISTS public.pharmacy_supplier_returns (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id   uuid        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  batch_id      uuid        NOT NULL REFERENCES public.drug_batches(id),
  drug_id       uuid        NOT NULL REFERENCES public.drug_master(id),
  drug_name     text        NOT NULL,
  batch_number  text,
  quantity      integer     NOT NULL,
  reason        text        NOT NULL DEFAULT 'expiring',
  supplier_name text,
  rma_number    text,
  status        text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'shipped', 'credited')),
  notes         text,
  created_by    uuid        REFERENCES public.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_supplier_returns_hospital_status
  ON public.pharmacy_supplier_returns (hospital_id, status, created_at DESC);

ALTER TABLE public.pharmacy_supplier_returns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital staff read own supplier returns"
  ON public.pharmacy_supplier_returns
  FOR SELECT
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "hospital staff insert own supplier returns"
  ON public.pharmacy_supplier_returns
  FOR INSERT
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "hospital staff update own supplier returns"
  ON public.pharmacy_supplier_returns
  FOR UPDATE
  USING (hospital_id = public.get_user_hospital_id());

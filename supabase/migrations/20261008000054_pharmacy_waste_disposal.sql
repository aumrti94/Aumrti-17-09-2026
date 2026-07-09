-- Pharmacy gap-fill plan, Phase 15 — "Mark Destroyed" on an expired batch just zeroed
-- stock with no manifest, a real gap under the Bio-Medical Waste Management Rules 2016.
-- Modeled on pharmacy_supplier_returns' shape (per-batch disposal event, same RLS
-- pattern); waste_category vocabulary matches the color-coding already used by
-- bmw_records (Housekeeping's daily ward-level BMW log) for naming consistency.

CREATE TABLE IF NOT EXISTS public.pharmacy_waste_disposal (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id       uuid        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  batch_id          uuid        NOT NULL REFERENCES public.drug_batches(id),
  drug_id           uuid        NOT NULL REFERENCES public.drug_master(id),
  drug_name         text        NOT NULL,
  batch_number      text,
  quantity_disposed integer     NOT NULL,
  waste_category    text        NOT NULL CHECK (waste_category IN ('yellow', 'red', 'blue', 'white', 'black', 'cytotoxic')),
  disposal_agency   text        NOT NULL,
  cpcb_manifest_no  text        NOT NULL,
  disposed_by       uuid        REFERENCES public.users(id),
  disposed_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_waste_disposal_hospital_date
  ON public.pharmacy_waste_disposal (hospital_id, disposed_at DESC);

ALTER TABLE public.pharmacy_waste_disposal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital staff read own waste disposal records"
  ON public.pharmacy_waste_disposal
  FOR SELECT
  USING (hospital_id = public.get_user_hospital_id());

CREATE POLICY "hospital staff insert own waste disposal records"
  ON public.pharmacy_waste_disposal
  FOR INSERT
  WITH CHECK (hospital_id = public.get_user_hospital_id());

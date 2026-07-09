-- Phase 2 (G3): ward/nursing point-of-care consumables deduct central inventory.
-- New table links consumables used on a patient during a nursing procedure to the
-- inventory master; stock_deducted guards double-deduction / enables reversal. OT
-- consumables get the same link (only ot_implants had it before). Additive, nullable.

CREATE TABLE IF NOT EXISTS public.nursing_procedure_consumables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  nursing_procedure_id uuid REFERENCES public.nursing_procedures(id) ON DELETE CASCADE,
  inventory_item_id uuid REFERENCES public.inventory_items(id),
  item_name text,
  quantity numeric(10,2) NOT NULL DEFAULT 1,
  stock_deducted boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nursing_consumables_proc ON public.nursing_procedure_consumables(nursing_procedure_id);

ALTER TABLE public.nursing_procedure_consumables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hospital_isolation" ON public.nursing_procedure_consumables;
CREATE POLICY "hospital_isolation" ON public.nursing_procedure_consumables
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

ALTER TABLE public.ot_consumables
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES public.inventory_items(id),
  ADD COLUMN IF NOT EXISTS stock_deducted boolean DEFAULT false;

ALTER TABLE public.lab_orders ADD COLUMN IF NOT EXISTS billed boolean NOT NULL DEFAULT false;
ALTER TABLE public.radiology_orders ADD COLUMN IF NOT EXISTS billed boolean NOT NULL DEFAULT false;
ALTER TABLE public.pharmacy_dispensing ADD COLUMN IF NOT EXISTS billed boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_lab_orders_admission_billed ON public.lab_orders(admission_id, billed) WHERE admission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_radiology_orders_admission_billed ON public.radiology_orders(admission_id, billed) WHERE admission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pharmacy_dispensing_admission_billed ON public.pharmacy_dispensing(admission_id, billed) WHERE admission_id IS NOT NULL;
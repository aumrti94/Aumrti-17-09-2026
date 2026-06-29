ALTER TABLE public.bill_line_items
  ADD COLUMN IF NOT EXISTS source_dedupe_key text;

CREATE INDEX IF NOT EXISTS idx_bill_line_items_dedupe
  ON public.bill_line_items (bill_id, source_dedupe_key);

UPDATE public.bill_line_items
SET source_dedupe_key = source_module || ':' || source_record_id::text
WHERE source_dedupe_key IS NULL
  AND source_record_id IS NOT NULL
  AND source_module IS NOT NULL;
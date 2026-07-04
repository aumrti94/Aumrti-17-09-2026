-- Phase 3 of Lab/Pathology/LIMS completion plan: canonical specimen identity.
--
-- The analyzer ingest function (lab-analyzer-ingest) has always matched incoming
-- HL7/ASTM results on lab_orders.accession_number — a column that never existed, so
-- no analyzer message could ever match an order. This adds the column, an atomic
-- per-hospital-per-day generator (ACC-YYYYMMDD-0001, reusing the proven
-- generate_bill_number / bill_sequences mechanism from 20260407093348), and
-- backfills history from lab_orders.barcode so pre-existing orders remain matchable.

ALTER TABLE public.lab_orders ADD COLUMN IF NOT EXISTS accession_number text;

-- Per-device shared secret for the ingest endpoint. The X-Device-Secret header was
-- documented since 20260531000002 but never stored nor verified; when set, the edge
-- function now requires it (NULL = legacy device, no check, backward compatible).
ALTER TABLE public.lab_device_connectors ADD COLUMN IF NOT EXISTS device_secret text;

-- Generator: thin wrapper over the existing atomic sequence RPC (prefix 'ACC').
-- SECURITY DEFINER matches generate_bill_number; search_path pinned.
CREATE OR REPLACE FUNCTION public.next_lab_accession(p_hospital_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.generate_bill_number(p_hospital_id, 'ACC');
$$;

GRANT EXECUTE ON FUNCTION public.next_lab_accession(uuid) TO authenticated;

-- Backfill BEFORE creating the unique index. Legacy barcodes are near-unique
-- (LAB-<uhid>-<orderid8> / BC-<ts>-<rand>) but not guaranteed — only the first order
-- per (hospital_id, barcode) gets the backfilled accession to keep the index valid.
UPDATE public.lab_orders lo
SET accession_number = lo.barcode
WHERE lo.barcode IS NOT NULL
  AND lo.accession_number IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.lab_orders lo2
    WHERE lo2.hospital_id = lo.hospital_id
      AND lo2.barcode = lo.barcode
      AND lo2.id < lo.id
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_orders_accession
  ON public.lab_orders (hospital_id, accession_number)
  WHERE accession_number IS NOT NULL;

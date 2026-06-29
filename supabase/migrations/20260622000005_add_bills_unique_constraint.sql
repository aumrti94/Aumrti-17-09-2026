-- Sprint 4A: UNIQUE constraint on bills(hospital_id, bill_number)
-- Pre-flight: run this query first to check for duplicates.
-- If any rows returned, resolve before applying constraint:
--   SELECT hospital_id, bill_number, COUNT(*) FROM public.bills
--   GROUP BY hospital_id, bill_number HAVING COUNT(*) > 1;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bills_hospital_bill_number_key'
      AND conrelid = 'public.bills'::regclass
  ) THEN
    ALTER TABLE public.bills
      ADD CONSTRAINT bills_hospital_bill_number_key
      UNIQUE (hospital_id, bill_number);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_bills_hospital_number
  ON public.bills(hospital_id, bill_number);

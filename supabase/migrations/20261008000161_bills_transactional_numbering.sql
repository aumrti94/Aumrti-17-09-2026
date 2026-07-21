-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: bills_transactional_numbering
-- Purpose  : Stop burning bill numbers on a failed or cancelled save.
--
--            Today the client does this:
--                 1. rpc('generate_bill_number')   → COMMITS, counter moves to N
--                 2. insert into bills             → separate transaction, may FAIL
--            Two round-trips means two transactions, so when step 2 fails (or the user
--            cancels) the counter has already advanced and N is gone forever. Observed
--            live before this migration:
--                 Vamsi Gastro   BILL counter 6, only 4 bills exist  → 2 burned
--                 sriji hospitals BILL counter 4, only 2 bills exist → 2 burned
--            Every retry of a failing save burned another number, which is how a hospital
--            ends up with "more bill numbers than bills".
--
-- Fix      : a BEFORE INSERT trigger allocates the number when the client leaves
--            bill_number blank. The counter increment and the row insert are then in ONE
--            transaction — if the insert fails, the increment rolls back with it and the
--            number is handed to the next bill instead of being lost.
--
--            This also serialises concurrent inserts on the bill_sequences row for that
--            (hospital, prefix), which is what gap-free numbering requires. At hospital
--            volumes the contention is irrelevant; a GST invoice series with holes in it
--            is not.
--
-- Note     : NOT NULL on bills.bill_number is checked AFTER before-triggers fire, so a
--            client omitting the column is fine — the trigger fills it in first.
--
-- Back-compat: callers that still pass an explicit bill_number keep working untouched;
--            the trigger only acts when the value is NULL or blank. That lets the ~30
--            remaining call sites migrate over time instead of in one risky sweep.
-- ─────────────────────────────────────────────────────────────────────────────

-- Mirrors src/lib/admissionBill.ts `admissionBillPrefix` and the prefixes the OPD/ED/lab
-- flows already pass. Keep the two in step.
--
-- Day care deliberately maps to 'BILL', NOT 'DC': 'DC' identifies a day care ADMISSION
-- (DC-20260721-0001, see lib/admissionNumber.ts). If a bill took that prefix too, an
-- admission number and a bill number would be indistinguishable by eye. There is a
-- regression test locking this ("never mints a bill under the 'DC' prefix") — do not
-- "fix" this mapping to DC. The bill's type is carried by bills.bill_type, not its number.
CREATE OR REPLACE FUNCTION public.bill_prefix_for_type(p_bill_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(p_bill_type, ''))
    WHEN 'opd'       THEN 'OPD'
    WHEN 'emergency' THEN 'ER'
    WHEN 'lab'       THEN 'LAB'
    WHEN 'radiology' THEN 'RAD'
    WHEN 'pharmacy'  THEN 'PHARM'
    -- 'ipd' and 'daycare' share the admission-bill series; see the note above.
    ELSE 'BILL'
  END;
$$;

CREATE OR REPLACE FUNCTION public.bills_assign_bill_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.bill_number IS NULL OR btrim(NEW.bill_number) = '' THEN
    NEW.bill_number := public.generate_bill_number(
      NEW.hospital_id,
      public.bill_prefix_for_type(NEW.bill_type)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bills_assign_bill_number ON public.bills;
CREATE TRIGGER trg_bills_assign_bill_number
  BEFORE INSERT ON public.bills
  FOR EACH ROW
  EXECUTE FUNCTION public.bills_assign_bill_number();

GRANT EXECUTE ON FUNCTION public.bill_prefix_for_type(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: registration_bill_prefix
-- Purpose  : Give the new optional patient-registration fee its own bill-number
--            series, REG-YYYYMMDD-####.
--
--            The registration fee is collected at patient registration and posted
--            as a `bills` row with bill_type = 'registration' (reusing the existing
--            bills / bill_line_items / bill_payments path). Bill numbers are minted
--            by the BEFORE INSERT trigger trg_bills_assign_bill_number, which calls
--            bill_prefix_for_type(bill_type). That function had no 'registration'
--            case, so these bills would fall through to the generic 'BILL' prefix and
--            be indistinguishable from IPD/day-care admission bills.
--
-- Fix      : add a single 'registration' -> 'REG' case. Idempotent CREATE OR REPLACE;
--            all other prefixes are unchanged (kept verbatim from migration
--            20261008000161_bills_transactional_numbering).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bill_prefix_for_type(p_bill_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(p_bill_type, ''))
    WHEN 'opd'          THEN 'OPD'
    WHEN 'emergency'    THEN 'ER'
    WHEN 'lab'          THEN 'LAB'
    WHEN 'radiology'    THEN 'RAD'
    WHEN 'pharmacy'     THEN 'PHARM'
    WHEN 'registration' THEN 'REG'
    -- 'ipd' and 'daycare' share the admission-bill series (see migration 161).
    ELSE 'BILL'
  END;
$$;

GRANT EXECUTE ON FUNCTION public.bill_prefix_for_type(text) TO authenticated;

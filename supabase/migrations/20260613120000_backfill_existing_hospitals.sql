-- =============================================================
-- Part C: Backfill all existing hospitals with default master data
-- =============================================================

-- Run seed_hospital_defaults for every existing hospital.
-- ON CONFLICT DO NOTHING inside the function means this is fully idempotent:
-- accounts/rules/tests already present are left untouched.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.hospitals ORDER BY created_at LOOP
    PERFORM public.seed_hospital_defaults(r.id);
  END LOOP;
END$$;

-- Fix payment rules that the old migration (20260327105009) seeded with the
-- wrong credit account (4001 OPD Revenue instead of 1010 AR - Patients).
-- The ensure_billing_posting_rules function already corrected hospitals that
-- had it called explicitly; this UPDATE covers any that were missed.
UPDATE public.auto_posting_rules apr
SET    credit_account_id = coa_ar.id
FROM   public.chart_of_accounts coa_ar
JOIN   public.chart_of_accounts coa_wrong
       ON  coa_wrong.hospital_id = coa_ar.hospital_id
       AND coa_wrong.code        = '4001'
WHERE  coa_ar.hospital_id  = apr.hospital_id
  AND  coa_ar.code         = '1010'
  AND  apr.trigger_event   IN (
         'bill_payment_cash','bill_payment_upi',
         'bill_payment_card','bill_payment_cheque',
         'bill_payment_net_banking'
       )
  AND  apr.credit_account_id = coa_wrong.id;

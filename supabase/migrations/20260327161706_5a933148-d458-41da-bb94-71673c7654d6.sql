
-- Drop old restrictive check constraint and add expanded one
ALTER TABLE auto_posting_rules DROP CONSTRAINT IF EXISTS auto_posting_rules_trigger_event_check;

ALTER TABLE auto_posting_rules ADD CONSTRAINT auto_posting_rules_trigger_event_check
CHECK (trigger_event = ANY (ARRAY[
  'bill_payment_cash','bill_payment_upi','bill_payment_card','bill_payment_insurance',
  'bill_payment_net_banking','bill_payment_cheque','advance_received','grn_received',
  'payroll_processed','pharmacy_retail_sale','expense_recorded',
  'bill_finalized_opd','bill_finalized_ipd','bill_finalized_ot',
  'bill_finalized_lab','bill_finalized_radiology','bill_finalized_pharmacy',
  'bill_finalized_generic','bill_insurance_reclassify'
]));

-- Now seed rules for all hospitals
DO $$
DECLARE h_id uuid;
BEGIN
  FOR h_id IN SELECT id FROM hospitals LOOP
    PERFORM ensure_billing_posting_rules(h_id);
  END LOOP;
END;
$$;

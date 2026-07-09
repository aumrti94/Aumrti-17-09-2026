-- G4: PO payment tracking + vendor payment/return posting rules.
-- Adds a real payment step to purchase_orders (gated in the UI on a passed 3-way match)
-- and the accounting rules to journalise it. GRN already posts Dr Purchase / Cr AP(2001);
-- a payment is Dr AP / Cr Bank, a vendor return is Dr AP / Cr Purchase (reverses GRN).
-- The trigger_event CHECK on auto_posting_rules was dropped earlier, so new events are allowed.

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS paid_amount numeric,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES public.users(id);

DO $$
DECLARE
  h record;
  v_ap uuid; v_bank uuid; v_cash uuid; v_pur uuid; v_misc uuid;
BEGIN
  FOR h IN SELECT id FROM public.hospitals LOOP
    SELECT id INTO v_ap   FROM public.chart_of_accounts WHERE hospital_id = h.id AND code = '2001';
    SELECT id INTO v_bank FROM public.chart_of_accounts WHERE hospital_id = h.id AND code = '1002';
    SELECT id INTO v_cash FROM public.chart_of_accounts WHERE hospital_id = h.id AND code = '1001';
    SELECT id INTO v_pur  FROM public.chart_of_accounts WHERE hospital_id = h.id AND code = '5010';
    SELECT id INTO v_misc FROM public.chart_of_accounts WHERE hospital_id = h.id AND code = '5060';
    IF v_ap IS NOT NULL THEN
      INSERT INTO public.auto_posting_rules
        (hospital_id, rule_name, trigger_event, debit_account_id, credit_account_id, description_template, is_active)
      VALUES
        (h.id, 'Vendor Payment', 'vendor_payment', v_ap, COALESCE(v_bank, v_cash), 'Vendor payment - {description}', true),
        (h.id, 'Vendor Return',  'vendor_return',  v_ap, COALESCE(v_pur, v_misc),  'Vendor return - {description}', true)
      ON CONFLICT ON CONSTRAINT auto_posting_rules_hospital_trigger_unique DO NOTHING;
    END IF;
  END LOOP;
END$$;

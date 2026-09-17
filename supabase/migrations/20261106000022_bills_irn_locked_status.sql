-- gst-irn-generate/index.ts sets bills.bill_status = 'irn_locked' after minting a government
-- e-Invoice IRN (both the sandbox/demo path and the live NIC IRP path) — but
-- bills_bill_status_check has never allowed that value. Every UPDATE this function has ever
-- run has failed the CHECK constraint, and since neither call site checked the returned
-- `error` (both used a bare `await sb.from("bills").update({...}).eq("id", bill_id);`), the
-- failure was completely silent: the API response falsely reports success with a real IRN
-- string, the bill's irn/irn_generated_at/irn_mode columns are never actually written, and
-- bill_status never leaves whatever it was before. A hospital's own billing staff has no way
-- to see a bill was ever e-Invoiced, and nothing stops re-triggering IRN generation for the
-- same bill — minting a SECOND, different IRN with the government for an invoice that already
-- has one, a real GST e-Invoicing compliance problem. Found via Phase 6 edge-function testing.
--
-- Adds 'irn_locked' as a valid bill_status. Does not touch the trigger functions that fire on
-- bill_status changes (auto_post_bill_journal, alert_bill_unposted, emit_api_event) — none of
-- them special-case 'irn_locked' today, so this is purely additive to the CHECK constraint.

BEGIN;

ALTER TABLE public.bills DROP CONSTRAINT IF EXISTS bills_bill_status_check;

ALTER TABLE public.bills ADD CONSTRAINT bills_bill_status_check
  CHECK (bill_status = ANY (ARRAY[
    'draft'::text, 'final'::text, 'partially_paid'::text, 'paid'::text,
    'cancelled'::text, 'refunded'::text, 'insurance_pending'::text,
    'irn_locked'::text
  ]));

COMMIT;

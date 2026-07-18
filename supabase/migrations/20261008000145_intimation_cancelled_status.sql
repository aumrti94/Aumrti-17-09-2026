-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: intimation_cancelled_status
-- Purpose  : Allow insurance_intimations.status = 'cancelled'.
--
--            fn_insurance_auto_intimate() raises a pending intimation the moment an insured
--            day care procedure is BOOKED, anchored to scheduled_at - 2h. If that booking is
--            then cancelled, the intimation is moot — but there was no way to say so:
--            the CHECK allowed only ('pending','sent','failed','acknowledged').
--
--            Left 'pending', monitor_insurance_intimations() Pass A picks it up 5 minutes
--            later, flips it to 'failed' and fires a CRITICAL "TPA auto-intimation failed …
--            Intimate the TPA manually NOW" alert — for a procedure that will never happen.
--
-- Safe     : widening a CHECK cannot invalidate an existing row. Every consumer already
--            filters on status, so 'cancelled' drops out of all of them:
--              · monitor Pass A  → WHERE status = 'pending'
--              · monitor Pass B  → WHERE status = 'sent'
--              · get_insurance_kpis → WHERE status IN ('failed','pending')
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.insurance_intimations
  DROP CONSTRAINT IF EXISTS insurance_intimations_status_check;

ALTER TABLE public.insurance_intimations
  ADD CONSTRAINT insurance_intimations_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text,
    'sent'::text,
    'failed'::text,
    'acknowledged'::text,
    'cancelled'::text     -- the admission it was raised for was cancelled
  ]));

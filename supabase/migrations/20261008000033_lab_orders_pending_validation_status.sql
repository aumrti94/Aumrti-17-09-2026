-- Phase 1 of Lab/Pathology/LIMS completion plan: the dual-validation workflow
-- (LabResultWorkspace.handleSubmitForValidation) sets lab_orders.status =
-- 'pending_validation', but the status CHECK added by
-- 20260517000001_investigation_order_schema_hardening.sql never included that value,
-- so the technician "Submit for validation" step has been rejected by Postgres since
-- that constraint landed. Additive re-list: all 7 existing values + 'pending_validation'.
--
-- Deliberate non-change: lab_order_items.status has never had a CHECK constraint and
-- legacy rows may hold arbitrary values — none is added here.

ALTER TABLE public.lab_orders
  DROP CONSTRAINT IF EXISTS lab_orders_status_check;

ALTER TABLE public.lab_orders
  ADD CONSTRAINT lab_orders_status_check
    CHECK (status IN (
      'ordered',
      'sample_collected',
      'in_process',
      'partial_results',
      'result_entered',
      'pending_validation',
      'completed',
      'cancelled'
    ));

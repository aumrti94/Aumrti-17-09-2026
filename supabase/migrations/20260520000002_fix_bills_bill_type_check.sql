-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: fix_bills_bill_type_check
-- Purpose  : The original bills_bill_type_check constraint only allowed
--            ('opd','ipd','emergency','daycare','package'). The Lab, Radiology,
--            Pharmacy, and Dialysis modules all insert bills with their own
--            bill_type values, causing a check constraint violation.
--            This migration replaces the constraint with the full set of
--            values used across all modules.
-- Idempotent: Yes — DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.bills
  DROP CONSTRAINT IF EXISTS bills_bill_type_check;

ALTER TABLE public.bills
  ADD CONSTRAINT bills_bill_type_check
  CHECK (bill_type IN (
    'opd',
    'ipd',
    'emergency',
    'daycare',
    'package',
    'lab',
    'radiology',
    'pharmacy',
    'dialysis',
    'ot',
    'blood_bank',
    'vaccination',
    'dental',
    'physiotherapy',
    'nursing',
    'telemedicine',
    'ivf',
    'ayush',
    'retail'
  ));

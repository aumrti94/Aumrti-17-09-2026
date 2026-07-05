-- ============================================================
-- HR — Overtime pay in the canonical statutory payroll engine
-- Adds OT columns to payslips and an OT multiplier to salary_structures.
-- ============================================================

ALTER TABLE public.payslips
  ADD COLUMN IF NOT EXISTS overtime_hours  numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overtime_amount numeric NOT NULL DEFAULT 0;

ALTER TABLE public.salary_structures
  ADD COLUMN IF NOT EXISTS ot_multiplier numeric NOT NULL DEFAULT 1.5;

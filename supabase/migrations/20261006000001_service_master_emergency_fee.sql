-- Per-doctor emergency consultation fee.
-- Mirrors the existing follow_up_fee / validity_days columns on service_master; used by the
-- OPD walk-in flow to bill an "emergency" visit at a distinct rate. Optional — when null the
-- walk-in falls back to the doctor's normal consultation fee.

ALTER TABLE public.service_master ADD COLUMN IF NOT EXISTS emergency_fee numeric(10,2);

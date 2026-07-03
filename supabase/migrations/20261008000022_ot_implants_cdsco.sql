-- OT Gap review (Phase 4): CDSCO registration number for implant traceability
ALTER TABLE public.ot_implants
  ADD COLUMN IF NOT EXISTS cdsco_registration_number text;

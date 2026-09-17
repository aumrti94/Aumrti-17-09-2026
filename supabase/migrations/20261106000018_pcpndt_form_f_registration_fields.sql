-- Phase 5 settings sweep — KNOWN-BUG-142. `pcpndt_settings` (Settings → Radiology) captures a
-- hospital's registered ultrasound machine name/registration number and the PCPNDT-registered
-- doctor's registration number — real data the PCPNDT Act's Form F record is supposed to carry
-- for every regulated obstetric scan. `pcpndt_form_f` (the actual Form F register,
-- src/lib/pcpndt.ts's buildFormFRow()) never had columns to receive it, so the settings screen
-- saved real compliance data into a table nothing ever read.
--
-- This is a smaller, more specific gap than "PCPNDT is unenforced" — the Form F creation
-- mechanism itself (requiresPcpndtFormF()) is real and already fixed two prior defects
-- (BUG-P4-002/P4-003: a single inline call site, and a name-substring match that missed
-- "Anomaly Scan"/"TIFFA"/etc.) with clinical (@priya) and regulatory (@suresh) review. What was
-- missing is narrower: the machine/doctor registration numbers a completed Form F is supposed
-- to record were never captured on the row at all.
--
-- CAVEAT: these three columns match what pcpndt_settings already captures — this is not a full
-- audit of the Form F's exact prescribed format under the Act's schedule, which should get the
-- same clinical/regulatory review buildFormFRow's other fields already had before being relied
-- on for a real accreditation or inspection submission.

BEGIN;

ALTER TABLE public.pcpndt_form_f
  ADD COLUMN IF NOT EXISTS machine_name text,
  ADD COLUMN IF NOT EXISTS machine_registration_number text,
  ADD COLUMN IF NOT EXISTS doctor_pcpndt_registration text;

COMMIT;

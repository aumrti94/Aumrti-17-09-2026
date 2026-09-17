-- Phase 5 settings sweep — KNOWN-BUG-145 (part 2 of 2; part 1 is the Consultation Fee field,
-- fixed in the same change by removing it from SettingsDoctorSchedulesPage.tsx — that field
-- was never saved either, and duplicated a fee that SettingsStaffPage.tsx already correctly
-- owns and writes to service_master, scoped by doctor_id; keeping a second, disconnected
-- "Consultation Fee" input here would have recreated the exact two-sources-of-truth collision
-- already fixed for Razorpay/NIC IRP, not resolved it).
--
-- "Advance Booking (days)" had no home to persist to at all — one value per doctor, edited on
-- this per-doctor schedule screen, but doctor_schedules has one row per (doctor, day, session)
-- with no doctor-level column. Repeated identically across every row for that doctor (same
-- shape as max_patients/slot_duration_minutes already varying per session, just uniform here).

BEGIN;

ALTER TABLE public.doctor_schedules
  ADD COLUMN IF NOT EXISTS advance_booking_days integer NOT NULL DEFAULT 30;

COMMIT;

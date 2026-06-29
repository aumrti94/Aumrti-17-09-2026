-- A slot must be re-bookable once its appointment is cancelled / no-show.
-- The old all-status unique constraint kept counting cancelled rows (which are not
-- deleted), so a slot could never be re-used. Replace it with a PARTIAL unique index
-- that only enforces uniqueness for ACTIVE appointments.

ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_unique_slot;

CREATE UNIQUE INDEX IF NOT EXISTS appointments_active_slot_uniq
  ON public.appointments (hospital_id, doctor_id, appointment_date, slot_time)
  WHERE status NOT IN ('cancelled', 'no_show');

-- OT Gap review: block OT room double-booking at the database level (Phase 1)
-- Previously only enforced client-side (check-then-insert race in BookOTModal.tsx)
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.ot_schedules
  ADD CONSTRAINT ot_schedules_no_overlap
  EXCLUDE USING gist (
    hospital_id WITH =,
    ot_room_id WITH =,
    tsrange(
      (scheduled_date + scheduled_start_time)::timestamp,
      (scheduled_date + scheduled_end_time)::timestamp,
      '[)'
    ) WITH &&
  )
  WHERE (status NOT IN ('cancelled', 'postponed'));

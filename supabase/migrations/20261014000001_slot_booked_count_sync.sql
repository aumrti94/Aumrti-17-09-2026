-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: slot_booked_count_sync
-- Purpose  : Make doctor_slots.booked_count a derived, self-correcting value instead of
--            a hand-maintained counter that three call sites increment and one decrements.
--
-- The problem: booked_count is currently maintained by app code in four places, each
--            doing a non-atomic read-then-write:
--              • PublicAppointmentPage.tsx:184   increment (+1)
--              • WalkInModal.tsx:736             increment (+1, best-effort, swallows errors)
--              • SchedulingPage.tsx:636          increment (+1)
--              • SchedulingPage.tsx:750          decrement (-1, on cancel only)
--            Two consequences:
--              1. Marking an appointment 'no_show' (SchedulingPage.tsx:527) never decrements,
--                 so that seat stays counted as occupied forever and the slot can never be
--                 refilled. Cancel is handled; no-show is not.
--              2. Two concurrent bookings both read the same value and both write value+1,
--                 so one increment is lost (classic lost update).
--
-- Approach : recompute rather than adjust. booked_count is set to an actual COUNT of the
--            slot's non-cancelled, non-no_show appointments whenever a relevant change
--            happens. This is idempotent — running it twice yields the same number — so it
--            cannot double-count or go negative, and it corrects any drift already present.
--
--            Crucially this requires NO change to the four existing call sites. Their
--            arithmetic still runs and is simply overwritten with the correct value by the
--            trigger a moment later. Nothing that works today stops working; the counter
--            just stops being wrong. Those call sites can be retired later, at leisure.
--
-- Capacity : deliberately NOT enforced here. Rejecting a booking when booked_count reaches
--            max_patients would be a behaviour change that could refuse bookings reception
--            makes deliberately (overbooking is routine). True double-booking of one
--            doctor+date+time is already prevented by the appointments_active_slot_uniq
--            partial index (20261007000000). Capacity stays advisory.
--
-- Active   : 'cancelled' and 'no_show' are the only statuses that free a seat.
--            validate_appointment() (20260418180322) constrains status to
--            scheduled|confirmed|arrived|in_consultation|completed|cancelled|no_show, so
--            those two are the complete set of inactive values.
--
-- Idempotent: CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- Additive  : no column dropped, no existing function or trigger modified, no app code
--             required to change. Reverting is: drop the trigger and the two functions.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. The recompute primitive ──────────────────────────────────────────────
-- SECURITY DEFINER because the anonymous public booking page (/book/:slug) has no
-- hospital context, so get_user_hospital_id() returns NULL and the doctor_slots
-- "hospital_isolation" policy (20260908000013) would otherwise block the write.

CREATE OR REPLACE FUNCTION public.recompute_slot_booked_count(p_slot_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_slot_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.doctor_slots ds
     SET booked_count = (
           SELECT count(*)
             FROM public.appointments a
            WHERE a.slot_id = ds.id
              AND a.status NOT IN ('cancelled', 'no_show')
         )
   WHERE ds.id = p_slot_id;
END;
$$;

COMMENT ON FUNCTION public.recompute_slot_booked_count(uuid) IS
  'Sets doctor_slots.booked_count to the true count of active appointments on that slot. '
  'Idempotent — safe to call any number of times. Called by trg_sync_slot_booked_count.';

-- ── 2. Trigger: recompute only when something relevant actually changed ──────
-- Narrow on purpose. appointments rows are updated often (arrived, reminder_sent, notes);
-- recomputing on every one of those would write to doctor_slots needlessly and add
-- contention on a hot row. Only a slot move or a status change can alter the count.

CREATE OR REPLACE FUNCTION public.sync_slot_booked_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.recompute_slot_booked_count(NEW.slot_id);

  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_slot_booked_count(OLD.slot_id);

  ELSE -- UPDATE
    IF NEW.slot_id IS DISTINCT FROM OLD.slot_id THEN
      -- Moved between slots (reschedule): both the vacated and the occupied slot change.
      PERFORM public.recompute_slot_booked_count(OLD.slot_id);
      PERFORM public.recompute_slot_booked_count(NEW.slot_id);
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      PERFORM public.recompute_slot_booked_count(NEW.slot_id);
    END IF;
  END IF;

  RETURN NULL; -- AFTER trigger; return value is ignored
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_slot_booked_count ON public.appointments;
CREATE TRIGGER trg_sync_slot_booked_count
  AFTER INSERT OR UPDATE OR DELETE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.sync_slot_booked_count();

-- ── 3. One-time backfill of existing drift ──────────────────────────────────
-- Corrects every slot whose stored count disagrees with reality: seats leaked by
-- no-shows, and increments lost to concurrent booking. Touches only rows that are
-- actually wrong, so on a clean database this updates nothing.

UPDATE public.doctor_slots ds
   SET booked_count = sub.actual
  FROM (
        SELECT s.id,
               (SELECT count(*)
                  FROM public.appointments a
                 WHERE a.slot_id = s.id
                   AND a.status NOT IN ('cancelled', 'no_show')) AS actual
          FROM public.doctor_slots s
       ) sub
 WHERE ds.id = sub.id
   AND COALESCE(ds.booked_count, 0) IS DISTINCT FROM sub.actual;

COMMENT ON COLUMN public.doctor_slots.booked_count IS
  'Derived: count of active (not cancelled / not no_show) appointments on this slot, '
  'maintained by trg_sync_slot_booked_count. App-side increments still present in '
  'PublicAppointmentPage, WalkInModal and SchedulingPage are harmless — the trigger '
  'overwrites them with the correct value.';

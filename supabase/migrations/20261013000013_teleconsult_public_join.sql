-- Aumrti security audit — teleconsult public join flow.
--
-- /join/:sessionId (src/pages/teleconsult/PatientJoinPage.tsx) is a deliberately public,
-- unauthenticated route: a real patient with no Aumrti login clicks a WhatsApp link and joins
-- a video call. But teleconsult_sessions RLS only grants access `TO authenticated`
-- (20260327033127_...sql:26-33) — there is no anon policy. As written, the page's direct
-- `supabase.from("teleconsult_sessions").select(...)` and `.update(...)` calls are silently
-- blocked by RLS for a genuine unauthenticated patient: the join flow does not work today.
--
-- Rather than adding a broad anon SELECT/UPDATE policy on the table (which would let anyone
-- holding the anon key enumerate every session row, including patient_phone), expose two
-- narrow SECURITY DEFINER functions that return/mutate only what the join page needs, scoped
-- to a single session id and a tight time window around the appointment — so a leaked/old
-- link stops working on its own instead of staying valid indefinitely.

CREATE OR REPLACE FUNCTION public.get_teleconsult_join_info(p_session_id uuid)
RETURNS TABLE (
  id uuid,
  room_id text,
  scheduled_at timestamptz,
  duration_minutes integer,
  status text,
  patient_first_name text,
  doctor_name text,
  hospital_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    ts.id,
    ts.room_id,
    ts.scheduled_at,
    ts.duration_minutes,
    ts.status,
    split_part(p.full_name, ' ', 1) AS patient_first_name,
    u.full_name AS doctor_name,
    h.name AS hospital_name
  FROM public.teleconsult_sessions ts
  JOIN public.patients p ON p.id = ts.patient_id
  JOIN public.users u ON u.id = ts.doctor_id
  JOIN public.hospitals h ON h.id = ts.hospital_id
  WHERE ts.id = p_session_id
    -- A leaked or forwarded link should stop working long before or after the appointment.
    AND ts.scheduled_at > now() - interval '24 hours'
    AND ts.scheduled_at < now() + interval '24 hours';
$$;

REVOKE ALL ON FUNCTION public.get_teleconsult_join_info(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_teleconsult_join_info(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.mark_teleconsult_patient_joined(p_session_id uuid)
RETURNS TABLE (status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.teleconsult_sessions ts
  SET status = 'waiting', patient_joined_at = now()
  WHERE ts.id = p_session_id
    AND ts.status IN ('scheduled', 'waiting')
    AND ts.scheduled_at > now() - interval '24 hours'
    AND ts.scheduled_at < now() + interval '24 hours'
  RETURNING ts.status;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_teleconsult_patient_joined(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_teleconsult_patient_joined(uuid) TO anon, authenticated;

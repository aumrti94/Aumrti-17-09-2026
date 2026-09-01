-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: opd_token_sequence
-- Purpose  : Give OPD tokens a real, atomic, per-doctor daily sequence.
--
--            Symptom reported from live use:
--              two patients under the SAME doctor on the SAME day both holding "A-1",
--              and the queue showing A-1 / A-2 / A-1 for three consecutive appointments.
--
-- Root cause: the client calls rpc('generate_token_number', ...) at
--            src/components/opd/WalkInModal.tsx and treats the result as atomic —
--            but that function WAS NEVER CREATED. No migration defines it, and it is
--            absent from the generated Functions: block in types.ts.
--
--            supabase-js RESOLVES an unknown RPC with { data: null, error } instead of
--            throwing, so the surrounding try/catch never fires. `atomicToken` silently
--            keeps the CLIENT-SIDE PREVIEW value, and that preview is the real allocator:
--
--              • useState("A-1")   — written verbatim whenever the preview query has not
--                                    resolved yet. In appointment check-in the modal jumps
--                                    straight to the payment step, so this is the NORMAL
--                                    case, not a rare race.
--              • the preview effect first runs with doctorId === "" → queries
--                doctor_id IS NULL → 0 rows → "A-1"; two queries race and the
--                later-resolving one wins.
--              • "last" token is picked by created_at, not by numeric value.
--              • token_number.split("-")[1] on a kiosk "K5678" or portal "P003" yields
--                undefined → parseInt("0") → 0, which RESETS the whole day's series back
--                to A-1. Both of those paths write into the same prefix='A' bucket.
--
--            And nothing rejected the duplicate: opd_tokens has only non-unique perf
--            indexes (20260904000010_perf_indexes.sql), never a unique constraint.
--
-- Fix      : the same two-part pattern the rest of this codebase already uses for
--            document numbers —
--              1. a per-hospital sequence table + SECURITY DEFINER generator, modelled on
--                 20261008000143_admission_number_sequence.sql (which in turn mirrors
--                 generate_bill_number). One atomic INSERT ... ON CONFLICT DO UPDATE
--                 RETURNING serialises concurrent callers on the sequence row.
--              2. a BEFORE INSERT trigger, modelled on
--                 20261008000161_bills_transactional_numbering.sql, so the number is
--                 allocated INSIDE the insert's transaction. If the insert fails the
--                 allocation rolls back with it.
--
--            NOT NULL on opd_tokens.token_number is checked AFTER before-triggers fire, so
--            a client omitting the column is fine — the trigger fills it in first. This is
--            what lets the kiosk and portal drop their bespoke K####/P### generators and
--            simply stop sending the column.
--
-- Scoping  : per hospital + per doctor + per prefix + per day. That matches how the desk
--            reads a token out loud ("A-3 for Dr Menon"), and it is the scope the old
--            preview query was already trying to use. Emergency visits keep their separate
--            'URG' series.
--
-- Back-compat: callers that still pass an explicit token_number keep working untouched;
--            the trigger only acts when the value is NULL or blank.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- doctor_id on opd_tokens is nullable, but Postgres treats NULLs as distinct in a PRIMARY
-- KEY — two "no doctor" rows would each get their own sequence row and both start at 1.
-- Collapsing NULL to the nil UUID gives every unassigned token one shared counter.
CREATE TABLE IF NOT EXISTS public.opd_token_sequences (
  hospital_id uuid    NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  doctor_key  uuid    NOT NULL,
  prefix      text    NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  last_date   text    NOT NULL DEFAULT ''::text,
  PRIMARY KEY (hospital_id, doctor_key, prefix)
);

ALTER TABLE public.opd_token_sequences ENABLE ROW LEVEL SECURITY;

-- The generator is SECURITY DEFINER, so it does not depend on this policy; it exists so
-- the table behaves sanely for any direct read. Matches admission_sequences.
DROP POLICY IF EXISTS opd_token_sequences_select ON public.opd_token_sequences;
CREATE POLICY opd_token_sequences_select ON public.opd_token_sequences
  FOR SELECT TO authenticated USING (true);

-- Remove every prior signature before creating the canonical one. Two call sites invented
-- two DIFFERENT argument lists for this never-existing function — WalkInModal passes
-- (p_hospital_id, p_prefix, p_doctor_id) and KioskCheckinPage passes
-- (p_hospital_id, p_department_id, p_visit_date). If both signatures existed, PostgREST
-- would have to disambiguate by argument names on every call. One signature only.
DROP FUNCTION IF EXISTS public.generate_token_number(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.generate_token_number(uuid, uuid, date);
DROP FUNCTION IF EXISTS public.generate_token_number(uuid, text);
DROP FUNCTION IF EXISTS public.generate_token_number(uuid);

CREATE OR REPLACE FUNCTION public.generate_token_number(
  p_hospital_id uuid,
  p_prefix      text DEFAULT 'A'::text,
  p_doctor_id   uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- IST day boundary, identical to generate_bill_number / generate_admission_number.
  -- A hospital's "today" must not roll over at 05:30 local time.
  v_today      TEXT := to_char(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD');
  v_prefix     TEXT := coalesce(nullif(btrim(p_prefix), ''), 'A');
  v_doctor_key UUID := coalesce(p_doctor_id, '00000000-0000-0000-0000-000000000000'::uuid);
  v_seq        INTEGER;
BEGIN
  INSERT INTO opd_token_sequences (hospital_id, doctor_key, prefix, last_number, last_date)
  VALUES (p_hospital_id, v_doctor_key, v_prefix, 1, v_today)
  ON CONFLICT (hospital_id, doctor_key, prefix)
  DO UPDATE SET
    last_number = CASE
      WHEN opd_token_sequences.last_date = v_today THEN opd_token_sequences.last_number + 1
      ELSE 1
    END,
    last_date = v_today
  RETURNING last_number INTO v_seq;

  -- Not zero-padded, unlike bills/admissions: this number is read aloud in a waiting room
  -- and printed large on a TV display. "A-3" not "A-0003".
  RETURN v_prefix || '-' || v_seq::TEXT;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.generate_token_number(uuid, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.opd_tokens_assign_token_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.token_prefix IS NULL OR btrim(NEW.token_prefix) = '' THEN
    NEW.token_prefix := 'A';
  END IF;

  IF NEW.token_number IS NULL OR btrim(NEW.token_number) = '' THEN
    NEW.token_number := public.generate_token_number(
      NEW.hospital_id,
      NEW.token_prefix,
      NEW.doctor_id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_opd_tokens_assign_token_number ON public.opd_tokens;
CREATE TRIGGER trg_opd_tokens_assign_token_number
  BEFORE INSERT ON public.opd_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.opd_tokens_assign_token_number();

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- Seed the counter from tokens ALREADY issued today, so the first token after this
-- migration continues the series instead of restarting at 1 and colliding with the
-- patients already sitting in the waiting room.
--
-- Only well-formed 'PREFIX-N' numbers count towards the high-water mark; the malformed
-- K####/P### values are exactly what corrupted the old client-side allocator, and letting
-- them through here would reintroduce the same reset.
INSERT INTO public.opd_token_sequences (hospital_id, doctor_key, prefix, last_number, last_date)
SELECT
  t.hospital_id,
  coalesce(t.doctor_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(nullif(btrim(t.token_prefix), ''), 'A'),
  max((regexp_match(t.token_number, '^[A-Za-z]+-([0-9]+)$'))[1]::int),
  to_char(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD')
FROM public.opd_tokens t
WHERE t.visit_date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
  AND t.token_number ~ '^[A-Za-z]+-[0-9]+$'
GROUP BY 1, 2, 3
ON CONFLICT (hospital_id, doctor_key, prefix) DO UPDATE
  SET last_number = GREATEST(opd_token_sequences.last_number, EXCLUDED.last_number),
      last_date   = EXCLUDED.last_date;

-- ── De-duplicate, then constrain ─────────────────────────────────────────────
-- Existing duplicates must be renumbered BEFORE the unique index is added, or the CREATE
-- fails on live data and the whole migration aborts. Keep the earliest token (created_at,
-- then id for a stable tiebreak) on its number and push every later collision to the end
-- of that doctor's series for the day.
DO $$
DECLARE
  r        record;
  v_next   integer;
BEGIN
  FOR r IN
    SELECT
      id, hospital_id, visit_date,
      coalesce(doctor_id, '00000000-0000-0000-0000-000000000000'::uuid) AS doctor_key,
      coalesce(nullif(btrim(token_prefix), ''), 'A') AS prefix
    FROM (
      SELECT
        id, hospital_id, visit_date, doctor_id, token_prefix,
        row_number() OVER (
          PARTITION BY hospital_id, visit_date,
                       coalesce(doctor_id, '00000000-0000-0000-0000-000000000000'::uuid),
                       token_number
          ORDER BY created_at, id
        ) AS rn
      FROM public.opd_tokens
    ) d
    WHERE d.rn > 1
    ORDER BY id
  LOOP
    SELECT coalesce(max((regexp_match(token_number, '^[A-Za-z]+-([0-9]+)$'))[1]::int), 0) + 1
      INTO v_next
      FROM public.opd_tokens
     WHERE hospital_id = r.hospital_id
       AND visit_date  = r.visit_date
       AND coalesce(doctor_id, '00000000-0000-0000-0000-000000000000'::uuid) = r.doctor_key
       AND coalesce(nullif(btrim(token_prefix), ''), 'A') = r.prefix
       AND token_number ~ '^[A-Za-z]+-[0-9]+$';

    UPDATE public.opd_tokens
       SET token_number = r.prefix || '-' || v_next::text
     WHERE id = r.id;

    RAISE NOTICE 'renumbered duplicate token % -> %-%', r.id, r.prefix, v_next;
  END LOOP;
END;
$$;

-- Keep the backfilled counters ahead of anything the renumbering just handed out.
UPDATE public.opd_token_sequences s
   SET last_number = GREATEST(s.last_number, m.max_number)
  FROM (
    SELECT
      hospital_id,
      coalesce(doctor_id, '00000000-0000-0000-0000-000000000000'::uuid) AS doctor_key,
      coalesce(nullif(btrim(token_prefix), ''), 'A') AS prefix,
      max((regexp_match(token_number, '^[A-Za-z]+-([0-9]+)$'))[1]::int) AS max_number
    FROM public.opd_tokens
    WHERE visit_date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date
      AND token_number ~ '^[A-Za-z]+-[0-9]+$'
    GROUP BY 1, 2, 3
  ) m
 WHERE s.hospital_id = m.hospital_id
   AND s.doctor_key  = m.doctor_key
   AND s.prefix      = m.prefix
   AND s.last_date   = to_char(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD');

-- The guarantee the reported bug needs: one token number per doctor per day. This is what
-- makes a duplicate structurally impossible rather than merely unlikely, and it is the
-- backstop if any future call site reinvents client-side numbering.
CREATE UNIQUE INDEX IF NOT EXISTS opd_tokens_daily_token_uniq
  ON public.opd_tokens (
    hospital_id,
    visit_date,
    (coalesce(doctor_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    token_number
  );

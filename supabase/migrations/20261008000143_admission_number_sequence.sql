-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: admission_number_sequence
-- Purpose  : Give admission numbers a real per-hospital daily sequence, like every other
--            document in the app.
--
--            Today they are not sequences at all:
--              Day care : `DC-${Date.now().toString().slice(-8)}`  → DC-80918818
--              IPD      : IPD-YYYYMMDD-<random 4 digits>           → IPD-20260716-1318
--            Both are effectively random. They cannot be ordered, counted, or reconciled,
--            two admissions in the same millisecond collide, and neither starts at 1.
--            Bills already do this properly via generate_bill_number() →  OPD-20260717-0001.
--
-- Design   : mirrors generate_bill_number() exactly — same PREFIX-YYYYMMDD-NNNN shape, same
--            IST day boundary, same atomic INSERT ... ON CONFLICT DO UPDATE RETURNING (so
--            concurrent admissions cannot take the same number), same daily reset to 1.
--
--            It uses its OWN table rather than bill_sequences. Sharing that table would make
--            admissions and bills draw from one counter per prefix: a day care bill is
--            already 'DC-20260717-0001', so an admission on the same counter would silently
--            interleave with it and the two series would be indistinguishable.
--
-- Prefixes : IPD  → IPD-20260717-0001   (inpatient admission)
--            DC   → DC-20260717-0001    (day care admission)
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE.
-- Additive  : existing admission numbers are left untouched; only new ones are sequenced.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.admission_sequences (
  hospital_id uuid    NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  prefix      text    NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  last_date   text    NOT NULL DEFAULT ''::text,
  PRIMARY KEY (hospital_id, prefix)
);

ALTER TABLE public.admission_sequences ENABLE ROW LEVEL SECURITY;

-- The generator is SECURITY DEFINER, so it does not depend on these policies; they exist so
-- the table behaves sanely for any direct read.
DROP POLICY IF EXISTS admission_sequences_select ON public.admission_sequences;
CREATE POLICY admission_sequences_select ON public.admission_sequences
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.generate_admission_number(
  p_hospital_id uuid,
  p_prefix text DEFAULT 'IPD'::text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_today TEXT := to_char(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD');
  v_seq INTEGER;
BEGIN
  INSERT INTO admission_sequences (hospital_id, prefix, last_number, last_date)
  VALUES (p_hospital_id, p_prefix, 1, v_today)
  ON CONFLICT (hospital_id, prefix)
  DO UPDATE SET
    last_number = CASE
      WHEN admission_sequences.last_date = v_today THEN admission_sequences.last_number + 1
      ELSE 1
    END,
    last_date = v_today
  RETURNING last_number INTO v_seq;

  RETURN p_prefix || '-' || v_today || '-' || lpad(v_seq::TEXT, 4, '0');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.generate_admission_number(uuid, text) TO authenticated;

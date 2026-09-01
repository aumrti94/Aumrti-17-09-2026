-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: no_show_outcome_capture
-- Purpose  : Close the no-show prediction feedback loop. Predictions are written but
--            their outcome never is, so the model can never learn from what happened.
--
-- Two defects in no_show_predictions (20260622000013):
--
--   1. Wrong foreign key. The column is named appointment_id but points at opd_tokens:
--          appointment_id UUID REFERENCES public.opd_tokens(id)
--      That is almost certainly a copy-paste from the token_id line directly above it.
--      A prediction made against a real appointments row therefore has nowhere valid to
--      record which appointment it was about.
--
--   2. outcome is never written. predictNoShow() (src/lib/clinicalPredictions.ts:35-44)
--      opens by reading past outcomes for the patient:
--          .select("outcome").eq("patient_id", ...).not("outcome", "is", null)
--      Nothing anywhere in the codebase ever sets that column, so the query always
--      returns zero rows, pastNoShows is always 0, noShowRate is always 0, and the
--      "Past no-show rate: 0%" fed to the model is fiction for every patient forever.
--
-- Approach : the existing appointment_id column is left exactly as it is — dropping or
--            re-pointing a foreign key is the kind of destructive change that breaks
--            whatever might already read it. A new, correctly-targeted appointment_ref
--            column is added beside it, and outcome is filled in by triggers on the two
--            tables that actually know how a visit ended.
--
--            Outcome vocabulary is fixed by the existing CHECK: 'attended' | 'no_show'.
--
-- Additive : new nullable column, new triggers with new names. No existing column,
--            constraint, trigger or policy is modified. Existing writes from
--            TokenQueue.tsx continue unchanged. Reverting is: drop the two triggers,
--            the two functions, and the column.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. A correctly-targeted appointment reference ───────────────────────────

ALTER TABLE public.no_show_predictions
  ADD COLUMN IF NOT EXISTS appointment_ref uuid REFERENCES public.appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_no_show_predictions_appt_ref
  ON public.no_show_predictions(appointment_ref);

COMMENT ON COLUMN public.no_show_predictions.appointment_ref IS
  'The appointments row this prediction was made about. Supersedes appointment_id, which '
  'is misdeclared as REFERENCES opd_tokens(id) and is retained only so nothing that may '
  'read it breaks.';

COMMENT ON COLUMN public.no_show_predictions.outcome IS
  'What actually happened: attended | no_show. Written by trg_no_show_outcome_from_appointment '
  'and trg_no_show_outcome_from_token. This is the training signal predictNoShow() reads back.';

-- ── 2. Outcome from appointments ────────────────────────────────────────────
-- arrived / in_consultation / completed all mean the patient turned up. Reaching any of
-- them settles the prediction. Only the first settlement counts (outcome IS NULL guard),
-- so a later status change cannot rewrite history.

CREATE OR REPLACE FUNCTION public.record_no_show_outcome_from_appointment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_outcome text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;

  IF NEW.status = 'no_show' THEN
    v_outcome := 'no_show';
  ELSIF NEW.status IN ('arrived', 'in_consultation', 'completed') THEN
    v_outcome := 'attended';
  ELSE
    RETURN NULL; -- scheduled / confirmed / cancelled settle nothing
  END IF;

  UPDATE public.no_show_predictions
     SET outcome = v_outcome
   WHERE appointment_ref = NEW.id
     AND outcome IS NULL;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_no_show_outcome_from_appointment ON public.appointments;
CREATE TRIGGER trg_no_show_outcome_from_appointment
  AFTER UPDATE OF status ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.record_no_show_outcome_from_appointment();

-- ── 3. Outcome from OPD tokens ──────────────────────────────────────────────
-- TokenQueue.tsx writes token-linked predictions, so those need settling too.
-- opd_tokens.status is free text with no CHECK; the values in use are
-- waiting | called | in_consultation | completed | cancelled | no_show.

CREATE OR REPLACE FUNCTION public.record_no_show_outcome_from_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_outcome text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;

  IF NEW.status = 'no_show' THEN
    v_outcome := 'no_show';
  ELSIF NEW.status IN ('in_consultation', 'completed') THEN
    v_outcome := 'attended';
  ELSE
    RETURN NULL; -- waiting / called / cancelled settle nothing
  END IF;

  UPDATE public.no_show_predictions
     SET outcome = v_outcome
   WHERE token_id = NEW.id
     AND outcome IS NULL;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_no_show_outcome_from_token ON public.opd_tokens;
CREATE TRIGGER trg_no_show_outcome_from_token
  AFTER UPDATE OF status ON public.opd_tokens
  FOR EACH ROW EXECUTE FUNCTION public.record_no_show_outcome_from_token();

-- ── 4. Backfill outcomes for predictions already on record ──────────────────
-- Every existing prediction has outcome NULL. Where its token has already reached a
-- settled state we know the answer, so seed it rather than discarding the history.

UPDATE public.no_show_predictions p
   SET outcome = CASE
                   WHEN t.status = 'no_show' THEN 'no_show'
                   ELSE 'attended'
                 END
  FROM public.opd_tokens t
 WHERE p.token_id = t.id
   AND p.outcome IS NULL
   AND t.status IN ('no_show', 'in_consultation', 'completed');

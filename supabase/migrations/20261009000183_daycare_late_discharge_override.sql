-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: daycare_late_discharge_override
-- Purpose  : Give the day care same-day rule an audited escape hatch.
--
--   enforce_daycare_same_day() (20260518000011, NULL-guarded in 20261008000138)
--   is an ABSOLUTE block: once midnight IST passes, an active day care admission
--   can never be discharged. There is no other path in the app that closes an
--   admission, so the patient is stranded 'active' forever — the bill never
--   closes, the advance is never settled, and the board carries a ghost.
--
--   Every real day care unit has late cases: a 9pm procedure that recovers past
--   midnight, or (far more often) a patient who walked out at 8pm and whose
--   discharge was simply never clicked. Neither is a data-integrity violation;
--   both are exceptions that must be RECORDED, not refused.
--
--   The rule therefore stays the default — a cross-midnight discharge is still
--   rejected outright — but passes when the row carries a written justification
--   and the user who gave it. The reason lives ON the admission (not in the
--   statement), so a later edit of the same row re-validates cleanly and the
--   exception survives in the record.
--
--   The correct first response is still to record the ACTUAL discharge time,
--   which usually falls back inside the admission day and needs no override at
--   all. DayCareDischargeModal offers that before it offers the override.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE.
-- Additive  : no column dropped, no row rewritten, no existing discharge affected.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Audit columns for the exception ───────────────────────────────────────

ALTER TABLE public.admissions
  ADD COLUMN IF NOT EXISTS late_discharge_reason text,
  ADD COLUMN IF NOT EXISTS late_discharge_by     uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS late_discharge_at     timestamptz;

COMMENT ON COLUMN public.admissions.late_discharge_reason IS
  'Why this day care stay was discharged on a later IST calendar day than it was admitted. '
  'Required by enforce_daycare_same_day() to permit the discharge; meaningless without '
  'late_discharge_by, which the trigger also requires.';

COMMENT ON COLUMN public.admissions.late_discharge_by IS
  'User who authorised the cross-midnight day care discharge. Set together with '
  'late_discharge_reason — the trigger rejects one without the other.';

-- Finding overnight day care cases is a QI question ("how many ran past midnight
-- last month, and why"), so make the exception cheap to list.
CREATE INDEX IF NOT EXISTS idx_admissions_late_discharge
  ON public.admissions (hospital_id, late_discharge_at)
  WHERE late_discharge_at IS NOT NULL;

-- ── 2. Same-day trigger: reject by default, allow when justified ─────────────
-- The NULL-admitted_at guard from 20261008000138 is unchanged: a booking that was
-- never admitted still cannot be discharged, with or without a reason.

CREATE OR REPLACE FUNCTION public.enforce_daycare_same_day()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.admission_type = 'daycare' AND NEW.discharged_at IS NOT NULL THEN

    IF NEW.admitted_at IS NULL THEN
      RAISE EXCEPTION
        'Day care patient cannot be discharged without being admitted first '
        '(admitted_at is null — the booking was never converted into an admission).';
    END IF;

    IF NEW.discharged_at < NEW.admitted_at THEN
      RAISE EXCEPTION
        'Discharge time cannot be before admission time. Admitted: %. Attempted discharge: %.',
        NEW.admitted_at, NEW.discharged_at;
    END IF;

    IF (NEW.discharged_at AT TIME ZONE 'Asia/Kolkata')::date
       != (NEW.admitted_at  AT TIME ZONE 'Asia/Kolkata')::date
    THEN
      -- Audited exception: an overnight stay, or a discharge recorded the next
      -- morning. Both need a written reason and an owner.
      IF COALESCE(btrim(NEW.late_discharge_reason), '') = ''
         OR NEW.late_discharge_by IS NULL
      THEN
        RAISE EXCEPTION
          'Day care patients are expected to be discharged on the admission day (IST). '
          'Admitted: %. Attempted discharge: %. '
          'Record the actual discharge time, or give a reason for the late discharge to proceed.',
          (NEW.admitted_at   AT TIME ZONE 'Asia/Kolkata')::date,
          (NEW.discharged_at AT TIME ZONE 'Asia/Kolkata')::date;
      END IF;

      -- Stamp the moment the exception was taken, if the caller did not.
      IF NEW.late_discharge_at IS NULL THEN
        NEW.late_discharge_at := now();
      END IF;
    END IF;

  END IF;
  RETURN NEW;
END;$$;

-- trg_enforce_daycare_same_day already exists on admissions (20260518000011);
-- replacing the function is sufficient.

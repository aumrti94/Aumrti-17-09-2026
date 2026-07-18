-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: daycare_scheduled_status
-- Purpose  : Make Day Care bookable. Adds a 'scheduled' state to admissions so a
--            procedure can be booked for a future date and admitted only once the
--            patient actually reports and is financially cleared.
--
--            Today DayCareAdmissionModal hardcodes status='active' and writes the
--            future scheduledTime straight into admitted_at — so booking IS admitting,
--            and a booking days out claims the patient is already in the hospital.
--
-- Key design: booking sets scheduled_at and leaves admitted_at NULL.
--            admitted_at is reserved for real arrival. Reusing it for the booking time
--            would break enforce_daycare_same_day() (which compares discharge against
--            admitted_at in IST — a list slipping a day would make discharge impossible)
--            and the LOS/room day-count maths in ipdBilling.ts.
--
--            NULL admitted_at is safe for existing readers: every analytics/HMIS/forecast
--            query range-filters admitted_at (NULL never matches a range) and every board
--            filters on status, where 'scheduled' is a brand-new value.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE.
-- Additive  : No column is dropped, no existing row is rewritten, no default changes.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Booking + financial clearance columns ─────────────────────────────────

ALTER TABLE public.admissions
  ADD COLUMN IF NOT EXISTS scheduled_at              timestamptz,
  ADD COLUMN IF NOT EXISTS day_care_billed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS financial_clearance_at    timestamptz,
  ADD COLUMN IF NOT EXISTS financial_clearance_by    uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS financial_override_reason text,
  ADD COLUMN IF NOT EXISTS financial_override_by     uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS financial_override_at     timestamptz;

COMMENT ON COLUMN public.admissions.scheduled_at IS
  'Planned procedure datetime for a booked (status=scheduled) day care admission. '
  'admitted_at stays NULL until the patient actually reports, so enforce_daycare_same_day() '
  'always compares discharge against real arrival rather than against the booking date.';

COMMENT ON COLUMN public.admissions.day_care_billed_at IS
  'Set when the day care procedure charge has been posted to the bill. Idempotency flag: '
  'day_care_procedures is a price MASTER, not a per-patient service record, so it cannot be '
  'marked billed the way lab/radiology orders are — that would poison it for every other patient.';

COMMENT ON COLUMN public.admissions.financial_override_reason IS
  'Audited reason a privileged user admitted a day care patient despite the financial '
  'clearance gate. Meaningless without financial_override_by — enforce_daycare_financial_clearance() '
  'requires both.';

-- Supports the Scheduled tab of the day care board, which filters on scheduled_at
-- (bookings have admitted_at NULL, so the board cannot filter on admitted_at).
CREATE INDEX IF NOT EXISTS idx_admissions_scheduled
  ON public.admissions (hospital_id, scheduled_at)
  WHERE scheduled_at IS NOT NULL;

-- ── 2. Same-day trigger: explicit NULL guard ─────────────────────────────────
-- A scheduled row has admitted_at NULL. `(NULL AT TIME ZONE 'Asia/Kolkata')::date != x`
-- evaluates to NULL, an IF on NULL does not fire, and the booking could be discharged
-- straight to 'discharged' without ever having been admitted. Make it explicit.
--
-- The same-day comparison below is byte-identical to 20260518000011; only the NULL
-- guard is new.

CREATE OR REPLACE FUNCTION public.enforce_daycare_same_day()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.admission_type = 'daycare' AND NEW.discharged_at IS NOT NULL THEN

    IF NEW.admitted_at IS NULL THEN
      RAISE EXCEPTION
        'Day care patient cannot be discharged without being admitted first '
        '(admitted_at is null — the booking was never converted into an admission).';
    END IF;

    IF (NEW.discharged_at AT TIME ZONE 'Asia/Kolkata')::date
       != (NEW.admitted_at  AT TIME ZONE 'Asia/Kolkata')::date
    THEN
      RAISE EXCEPTION
        'Day care patients must be discharged on the same calendar day (IST). '
        'Admitted: %. Attempted discharge: %.',
        (NEW.admitted_at AT TIME ZONE 'Asia/Kolkata')::date,
        (NEW.discharged_at AT TIME ZONE 'Asia/Kolkata')::date;
    END IF;

  END IF;
  RETURN NEW;
END;$$;

-- trg_enforce_daycare_same_day already exists; replacing the function is sufficient.

-- ── 3. Intimation deadline for FUTURE bookings ───────────────────────────────
-- trg_insurance_auto_intimate is AFTER INSERT on admissions and fires for EVERY admission.
-- Its daycare branch sets a deadline of now() + 2h. For a booking five days out that
-- deadline is five days early and will fire a false "missed intimation" alert.
--
-- The rule is "2 hours before the PROCEDURE", so anchor to scheduled_at when there is one.
-- The emergency (48h) and default (24h) branches are byte-identical to 20260518000011 —
-- this function is live on every admission path, so nothing outside daycare may change.

CREATE OR REPLACE FUNCTION public.fn_insurance_auto_intimate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_deadline    timestamptz;
  v_payer_type  text;
BEGIN
  -- Skip self-pay admissions
  IF NEW.insurance_type IS NULL OR NEW.insurance_type = 'self_pay' THEN
    RETURN NEW;
  END IF;

  -- Deadline per admission type
  IF NEW.admission_type = 'emergency' THEN
    v_deadline := now() + INTERVAL '48 hours';
  ELSIF NEW.admission_type = 'daycare' THEN
    -- Booked ahead: 2 hours before the planned procedure.
    -- Same-day walk-in (or a booking already inside the 2h window): unchanged now() + 2h.
    IF NEW.scheduled_at IS NOT NULL AND NEW.scheduled_at > now() + INTERVAL '2 hours' THEN
      v_deadline := NEW.scheduled_at - INTERVAL '2 hours';
    ELSE
      v_deadline := now() + INTERVAL '2 hours';   -- same-day; must intimate before procedure
    END IF;
  ELSE
    v_deadline := now() + INTERVAL '24 hours';
  END IF;

  v_payer_type := COALESCE(NEW.insurance_type, 'insurance');

  INSERT INTO public.insurance_intimations (
    hospital_id, admission_id, patient_id,
    payer_type, admission_type,
    status, intimation_deadline
  ) VALUES (
    NEW.hospital_id, NEW.id, NEW.patient_id,
    v_payer_type, NEW.admission_type,
    'pending', v_deadline
  ) ON CONFLICT DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;  -- never block admission creation
END;$$;
-- Note: the trigger trg_insurance_auto_intimate already exists on admissions;
-- replacing the function is sufficient to update its behaviour.

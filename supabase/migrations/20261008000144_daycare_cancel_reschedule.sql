-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: daycare_cancel_reschedule
-- Purpose  : Let a booked day care procedure be cancelled, marked no-show, or moved to
--            another date.
--
--            Since bookings became a real state (20261008000138) there has been no way out
--            of one except admitting the patient. Real day care lists slip constantly, and a
--            booking can already hold money — a deposit collected against a booking that is
--            never going to happen would otherwise sit there forever.
--
-- Prior art: none. OT has an ot_schedules.cancellation_reason column that no code writes and
--            no Cancel button; appointments cancel via a bare confirm() with no reason and no
--            author; package_bookings cannot be cancelled at all. admissions had zero
--            cancellation columns. So this follows the house <x>_reason / <x>_by / <x>_at
--            triplet already used by financial_override_* (20261008000138).
--
-- Statuses : 'cancelled' and 'no_show'. admissions.status is free text with no CHECK, so no
--            constraint change is needed. 'no_show' matches the appointments vocabulary.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT DO NOTHING.
-- Additive  : no column dropped, no existing row rewritten.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Cancellation + reschedule columns ────────────────────────────────────

ALTER TABLE public.admissions
  ADD COLUMN IF NOT EXISTS cancelled_at        timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by        uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancellation_note   text,
  ADD COLUMN IF NOT EXISTS deposit_disposition text,
  ADD COLUMN IF NOT EXISTS retained_fee        numeric(12,2),
  ADD COLUMN IF NOT EXISTS rescheduled_from    timestamptz,
  ADD COLUMN IF NOT EXISTS reschedule_count    integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admissions_deposit_disposition_check'
  ) THEN
    ALTER TABLE public.admissions
      ADD CONSTRAINT admissions_deposit_disposition_check
      CHECK (deposit_disposition IS NULL
             OR deposit_disposition IN ('refund', 'retain_fee', 'carry_forward'));
  END IF;
END $$;

COMMENT ON COLUMN public.admissions.cancellation_reason IS
  'Value from the cancellation_reasons config list. Required (with cancelled_by) by '
  'enforce_daycare_cancellation() — a reason with no author is not an audit trail.';

COMMENT ON COLUMN public.admissions.deposit_disposition IS
  'What was done with a deposit held against a cancelled booking: refund (raised in '
  'refund_payables for approval), retain_fee (a cancellation fee was billed and the '
  'remainder refunded), or carry_forward (the balance is left held on this admission).';

COMMENT ON COLUMN public.admissions.rescheduled_from IS
  'The scheduled_at this booking was last moved off. Reschedule keeps the same admission '
  'row — and therefore the same deposit — rather than cancelling and re-booking.';

-- ── 2. Guard: only a booking can be cancelled, and only with an audited reason ──

CREATE OR REPLACE FUNCTION public.enforce_daycare_cancellation()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF COALESCE(NEW.admission_type, '') <> 'daycare'
     OR NEW.status NOT IN ('cancelled', 'no_show')
     OR COALESCE(OLD.status, '') = COALESCE(NEW.status, '')
  THEN
    RETURN NEW;
  END IF;

  -- A patient who is already in the unit is discharged, not cancelled. Discharge settles
  -- the advance; cancelling here would bypass that entirely.
  IF COALESCE(OLD.status, '') <> 'scheduled' THEN
    RAISE EXCEPTION
      'Only a scheduled booking can be cancelled or marked no-show (this admission is "%"). '
      'An admitted patient must be discharged instead.', OLD.status;
  END IF;

  IF COALESCE(btrim(NEW.cancellation_reason), '') = '' OR NEW.cancelled_by IS NULL THEN
    RAISE EXCEPTION
      'A cancellation needs both a reason and the user recording it.';
  END IF;

  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_enforce_daycare_cancellation ON public.admissions;
CREATE TRIGGER trg_enforce_daycare_cancellation
  BEFORE UPDATE ON public.admissions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_daycare_cancellation();

-- ── 3. Seed the cancellation reason list ────────────────────────────────────
-- System rows (hospital_id NULL, is_system true) are visible to every hospital via the
-- hcv_select policy, and a hospital can add its own without touching these.
-- hospital_config_values was entirely empty before this — useConfigValues() has no
-- hard-coded fallback, so an unseeded category renders an empty dropdown.

INSERT INTO public.hospital_config_values
  (hospital_id, category, value, label, sort_order, is_active, is_system)
VALUES
  (NULL, 'cancellation_reasons', 'patient_request',       'Patient requested cancellation', 1, true, true),
  (NULL, 'cancellation_reasons', 'clinically_unfit',      'Clinically unfit for procedure', 2, true, true),
  (NULL, 'cancellation_reasons', 'doctor_unavailable',    'Doctor / surgeon unavailable',   3, true, true),
  (NULL, 'cancellation_reasons', 'preauth_rejected',      'Insurance pre-auth rejected',    4, true, true),
  (NULL, 'cancellation_reasons', 'financial',             'Financial / unable to pay',      5, true, true),
  (NULL, 'cancellation_reasons', 'patient_no_show',       'Patient did not report',         6, true, true),
  (NULL, 'cancellation_reasons', 'rescheduled_elsewhere', 'Moved to another facility',      7, true, true),
  (NULL, 'cancellation_reasons', 'other',                 'Other',                          8, true, true)
ON CONFLICT DO NOTHING;

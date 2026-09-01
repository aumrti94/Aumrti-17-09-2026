-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: follow_up_visit_cap
-- Purpose  : Let a doctor cap HOW MANY visits get the cheaper follow-up price, and make
--            that cap countable.
--
--            Reported need: "some doctors give the validity days, but if the patient
--            visits 3-4 times the doctor wants to take the follow-up fee only one time.
--            After the second time he needs to ask for a consultation fee."
--
--            Today service_master has follow_up_fee + validity_days but no notion of a
--            COUNT, so a patient inside the validity window gets the follow-up rate an
--            unlimited number of times.
--
-- Design   : episode-anchored, per the agreed pricing rule.
--              • An episode starts at the last FULL-fee consultation with that doctor.
--              • Within validity_days of that anchor, the next follow_up_max_visits
--                visits bill follow_up_fee.
--              • Once the allowance is spent, or the window expires, the next visit bills
--                the full fee and OPENS A NEW EPISODE with a fresh allowance.
--            The window is measured from the anchor consultation, not from the most recent
--            visit, so follow-ups do not silently extend it.
--
-- follow_up_max_visits is NULLABLE and NULL means UNLIMITED. That is deliberate: it is
-- exactly today's behaviour, so every existing row keeps pricing the way it does now and
-- this migration cannot change a live hospital's bills. The Settings form defaults new and
-- edited doctors to 1, which is the case that prompted the request.
ALTER TABLE public.service_master
  ADD COLUMN IF NOT EXISTS follow_up_max_visits integer;

COMMENT ON COLUMN public.service_master.follow_up_max_visits IS
  'How many visits inside one validity window may bill follow_up_fee. NULL = unlimited (legacy behaviour).';

-- Counting the allowance needs to know what each past visit was ACTUALLY CHARGED, which
-- opd_tokens does not record. visit_type is not a substitute: it is free-text intent set
-- in the UI ('new'|'revisit'|'followup'|'emergency'), it is written inconsistently across
-- the walk-in / check-in / kiosk / portal paths, and it says nothing about which rate the
-- fee engine actually landed on after validity and cap checks. Counting it would let a
-- visit marked "followup" but billed at full fee still burn the allowance.
ALTER TABLE public.opd_tokens
  ADD COLUMN IF NOT EXISTS charged_tier text;

COMMENT ON COLUMN public.opd_tokens.charged_tier IS
  'Which consultation rate actually billed: new | follow_up | emergency. Drives episode/allowance counting in src/lib/consultationFee.ts.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'opd_tokens_charged_tier_check'
  ) THEN
    ALTER TABLE public.opd_tokens
      ADD CONSTRAINT opd_tokens_charged_tier_check
      CHECK (charged_tier IS NULL OR charged_tier IN ('new', 'follow_up', 'emergency'));
  END IF;
END;
$$;

-- The episode lookup walks a patient's history with one doctor, newest first, bounded by
-- the validity window. Without this it is a seq scan on every fee calculation — and the
-- fee is calculated on every keystroke-driven re-render of the registration modal.
CREATE INDEX IF NOT EXISTS idx_opd_tokens_patient_doctor_date
  ON public.opd_tokens (patient_id, doctor_id, visit_date DESC);

-- Historical rows predate charged_tier. Leaving them NULL would make every existing
-- patient look like they have no prior full-fee anchor, so the first visit after this
-- migration would price as a fresh consultation. Backfilling from the best signal
-- available (visit_type/visit_purpose) keeps continuity for patients mid-episode.
UPDATE public.opd_tokens
   SET charged_tier = CASE
         WHEN visit_type = 'emergency' OR token_prefix = 'URG' THEN 'emergency'
         WHEN visit_type IN ('followup', 'follow_up')
           OR visit_purpose IN ('follow_up', 'review')          THEN 'follow_up'
         ELSE 'new'
       END
 WHERE charged_tier IS NULL;

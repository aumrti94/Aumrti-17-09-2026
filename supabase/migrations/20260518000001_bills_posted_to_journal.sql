-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: bills_posted_to_journal
-- Purpose  : Add posted_to_journal flag to bills table.
--            Backfill all existing final bills as posted (cannot retroactively
--            verify, so assume clean). Alert trigger fires pg_notify whenever a
--            bill reaches final status without the flag being set — picked up by
--            the reconcile-journal-postings Edge Function or any LISTEN client.
-- Idempotent: Yes — uses IF NOT EXISTS, CREATE OR REPLACE, DROP IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Column ────────────────────────────────────────────────────────────────
ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS posted_to_journal boolean NOT NULL DEFAULT false;

-- ── 2. Backfill ──────────────────────────────────────────────────────────────
-- All bills finalised before this migration are treated as posted. Historical
-- journal entries were created in-session; we cannot retroactively match them
-- here without risking false negatives. The reconciliation Edge Function handles
-- any true gaps found after the column goes live.
UPDATE public.bills
SET posted_to_journal = true
WHERE bill_status = 'final';

-- ── 3. Index — fast lookup for reconciliation queries ────────────────────────
CREATE INDEX IF NOT EXISTS idx_bills_unposted
  ON public.bills (hospital_id, posted_to_journal, bill_status)
  WHERE bill_status = 'final' AND posted_to_journal = false;

-- ── 4. Alert trigger ─────────────────────────────────────────────────────────
-- Fires AFTER INSERT OR UPDATE whenever a bill is final but not posted.
-- Does NOT raise an exception — never blocks billing. Emits pg_notify instead.
-- Supabase Realtime and the reconciliation Edge Function both consume this channel.

CREATE OR REPLACE FUNCTION public.alert_bill_unposted()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.bill_status = 'final' AND NOT NEW.posted_to_journal THEN
    PERFORM pg_notify(
      'bill_unposted_alert',
      json_build_object(
        'bill_id',     NEW.id,
        'hospital_id', NEW.hospital_id,
        'bill_number', NEW.bill_number,
        'amount',      NEW.total_amount,
        'event_time',  now()
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alert_bill_unposted ON public.bills;
CREATE TRIGGER trg_alert_bill_unposted
  AFTER INSERT OR UPDATE OF bill_status, posted_to_journal ON public.bills
  FOR EACH ROW EXECUTE FUNCTION public.alert_bill_unposted();

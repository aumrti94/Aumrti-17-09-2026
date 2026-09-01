-- Phase 1.2 (cont.) — committee_action_items.priority
--
-- supabase/functions/ai-nabh-assistant reads and reports on an action item's `priority`
-- ("capaHighPriority" in the NABH readiness digest). The column has never existed, and the query
-- also targeted a table name that does not exist ("committee_actions"), so the whole read failed
-- and the digest silently reported zero overdue CAPA actions — the opposite of an alert.
--
-- Adding the column rather than dropping the feature: an action item without a priority cannot
-- drive the "high priority overdue" signal NABH readiness reporting depends on.
-- Additive and defaulted, so existing rows remain valid.

BEGIN;

ALTER TABLE public.committee_action_items
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'medium';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.committee_action_items'::regclass
      AND conname  = 'committee_action_items_priority_check'
  ) THEN
    ALTER TABLE public.committee_action_items
      ADD CONSTRAINT committee_action_items_priority_check
      CHECK (priority IN ('low','medium','high','critical'));
  END IF;
END $$;

COMMIT;

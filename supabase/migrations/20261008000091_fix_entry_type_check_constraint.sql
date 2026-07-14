-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: fix_entry_type_check_constraint
-- Purpose  : journal_entries.entry_type has carried a CHECK constraint since its
--            very first migration (20260327104518) allowing only:
--              auto_billing, auto_payment, auto_grn, auto_payroll, auto_pharmacy,
--              manual, opening_balance, adjustment
--            But `autoPostJournalEntry()` / `postMultiLineJournal()` construct
--            entry_type as `auto_${sourceModule}`, and sourceModule across the
--            codebase includes lab, radiology, insurance, fixed_assets,
--            inventory, hr, dialysis, ayush, dental, ivf, blood_bank,
--            vaccination, telemedicine, oncology, packages, nursing, physio,
--            accounts — NONE of which are in the original allow-list (only
--            "pharmacy" and "billing" happen to match). A Postgres CHECK
--            violation on insert is returned as a Postgrest error, which both
--            posting helpers swallow (`if (error || !entry) return null`) —
--            so this has been SILENTLY dropping journal entries for most
--            non-billing modules, including this migration set's own
--            depreciation (auto_depreciation), fixed-asset (auto_fixed_assets),
--            and insurance (auto_insurance) postings.
--
--            Fix: replace the fixed enum with a constraint matching the
--            convention the UI itself already relies on
--            (`entry_type?.startsWith("auto")` — JournalTab, ReportsTab,
--            AccountsDashboardTab) — any `auto_%` value, plus the fixed
--            non-auto values including the new 'reversal' type this migration
--            set introduces.
--
-- Idempotent: dynamically locates and drops whatever the existing check
--             constraint is named (robust to naming across environments),
--             then adds the corrected one with ADD CONSTRAINT IF NOT EXISTS
--             equivalent (checked via pg_constraint first).
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class     rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'journal_entries'
      AND con.contype  = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%entry_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.journal_entries DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'journal_entries' AND con.conname = 'journal_entries_entry_type_check'
  ) THEN
    ALTER TABLE public.journal_entries
      ADD CONSTRAINT journal_entries_entry_type_check
      CHECK (entry_type = ANY (ARRAY['manual','opening_balance','adjustment','reversal'])
             OR entry_type LIKE 'auto_%');
  END IF;
END $$;

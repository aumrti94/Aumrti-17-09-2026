
-- Add missing columns to existing journal_entries table
ALTER TABLE public.journal_entries 
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS entry_type text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS total_debit numeric(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_credit numeric(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_balanced boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS posted_by uuid REFERENCES public.users(id);

-- Copy narration to description where description is null (column may not exist on fresh DB)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='journal_entries' AND column_name='narration') THEN
    UPDATE public.journal_entries SET description = narration WHERE description IS NULL AND narration IS NOT NULL;
  END IF;
END $$;

-- Copy source_ref_id to source_id where source_id is null (column may not exist on fresh DB)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='journal_entries' AND column_name='source_ref_id') THEN
    UPDATE public.journal_entries SET source_id = source_ref_id WHERE source_id IS NULL AND source_ref_id IS NOT NULL;
  END IF;
END $$;

-- Set entry_type based on is_auto (column may not exist on fresh DB)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='journal_entries' AND column_name='is_auto') THEN
    UPDATE public.journal_entries SET entry_type = CASE WHEN is_auto = true THEN 'auto_billing' ELSE 'manual' END WHERE entry_type = 'manual' OR entry_type IS NULL;
  END IF;
END $$;

---
description: Create a safe, idempotent Supabase migration
---

Create a Supabase migration for: $ARGUMENTS

1. Use the `supabase-migration` skill (`.claude/skills/supabase-migration/SKILL.md`) for the
   required file naming and table structure.
2. Read the last 3 migration files in `supabase/migrations/` for context and current conventions.
3. Create the new migration file with a `YYYYMMDDHHMMSS_description.sql` name.
4. Include: table creation, RLS enable, isolation policy, indexes — all four, every time.
5. Test the SQL by pasting it into Supabase Dashboard → SQL Editor before committing.
6. Verify no existing data or RLS policy is broken.
7. This migration goes through the `data` pod's review gate (Meera) before it merges — flag it
   for that review rather than committing it as final.

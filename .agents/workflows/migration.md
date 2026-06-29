# Workflow: Database Migration

Goal: Create a safe, idempotent Supabase migration.

Steps:
1. Read the supabase-migration skill from .agents/skills/supabase-migration.md
2. Read the last 3 migration files in supabase/migrations/ for context.
3. Create the new migration file with timestamp name.
4. Include: table creation, RLS enable, policy, indexes.
5. Test the SQL by pasting into Supabase Dashboard → SQL Editor.
6. Verify no existing data or RLS policies are broken.
7. Commit the migration file to git.

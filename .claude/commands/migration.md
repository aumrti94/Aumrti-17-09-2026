---
description: Create a safe, idempotent Supabase migration
---

Create a Supabase migration for: $ARGUMENTS

1. **Load the `supabase-migration` skill.** It carries the file convention, the mandatory RLS
   isolation policy, the `public.users` vs `auth.users` foreign-key rule, and the audit-trigger
   requirement. Do not restate those rules here — follow the skill.
2. Check `ls supabase/migrations | tail -3` so the new timestamp sorts last, and grep the history
   for the table you are touching — most "new" tables have prior art.
3. Write the migration.
4. Verify with the same gates CI runs:
   `npm run check:rls-coverage && npm run check:user-fk && npm run check:db-contract`
5. If the application calls the new table or RPC, land that code in the same change — otherwise
   `check:db-contract` reports it as pending and `types.ts` stays stale.
6. This migration goes through the `data` pod's review gate (Meera) before it merges — flag it for
   that review rather than committing it as final.

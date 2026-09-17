---
description: Fix a reported bug without breaking existing functionality
---

Fix this bug: $ARGUMENTS

1. Read the error message and identify the affected file(s). Read them completely before changing
   anything.
2. Identify the root cause — do not fix symptoms.
3. **Load the skill that covers the surface** before editing: `react-component` for UI,
   `supabase-migration` for schema, `edge-function` for `supabase/functions/`,
   `multi-tenant-data-access` for anything touching a query, `clinical-compliance` for clinical
   logic.
4. Consider the silent-failure classes first — they account for most bugs here and none of them
   throw:
   - an unchecked `error` from a Supabase call (returns as a value, not an exception)
   - a missing `.eq("hospital_id", …)`, especially under service role in an Edge Function
   - `.single()` where the row may be absent
   - a `.from()`/`.rpc()` name that does not exist
   - a `*_by` column pointing at `auth.users` instead of `public.users`
   - a missing `.eq("is_deleted", false)`
5. Make the minimal change that fixes the root cause.
6. Verify:
   `npx tsc --noEmit && npm run lint && npm run check:db-contract`
   plus `check:rls-coverage` and `check:user-fk` if the fix touched a migration.
7. If the bug is UI-visible, run the dev server and confirm the fix at `localhost:8080`.
8. Report: what was broken, why it broke, what changed. If the same defect class exists elsewhere
   in the codebase, say so — repairing one instance does not close the class.

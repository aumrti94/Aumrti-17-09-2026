---
description: Scaffold a complete new HMS module following Aumrti's existing patterns
---

Scaffold a new HMS module: $ARGUMENTS

1. Read `src/App.tsx` to understand the existing route structure.
2. Read `src/components/opd/` as the reference implementation pattern.
3. Create the page file at `src/pages/[module]/[Module]Page.tsx` with:
   - A lazy import added to `App.tsx`
   - A route added with `RoleGuard`
   - The route added to `ROUTE_ROLES`
   - A sidebar navigation entry
4. Create the main component with tabs if the module has sub-screens.
5. Create the Supabase migration for any new tables needed (use `/migration`).
6. Add RLS policies to all new tables.
7. This is cross-pod work — the `data` pod owns the migration, the `frontend` pod owns the
   page/route, and whichever pod matches the module's domain owns the business logic. Route
   accordingly rather than doing all of it as one undifferentiated block.
8. Ask the `quality` pod (Sunita) to verify the route renders and the DB tables exist before
   calling this done.

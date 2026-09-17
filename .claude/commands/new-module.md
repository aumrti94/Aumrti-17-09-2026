---
description: Scaffold a complete new HMS module following Aumrti's existing patterns
---

Scaffold a new HMS module: $ARGUMENTS

1. **Load the `module-scaffold` skill.** It carries the six registries a module must be registered
   in, in the order they depend on each other, and what silently breaks when one is missed. Follow
   it rather than re-deriving the wiring.
2. Load the supporting skills for the parts you actually write: `react-component` (screens),
   `supabase-migration` (tables), `multi-tenant-data-access` (queries), plus `clinical-compliance`
   if the module touches patient care and `billing-and-gst` if it charges money.
3. Read `src/App.tsx` for the route structure and `src/components/opd/` as the reference
   implementation.
4. Build the module: registries first, then the page shell and tabs, then migrations for any new
   tables.
5. Verify:
   `npm run lint && npm run check:rls-coverage && npm run check:user-fk && npm run check:db-contract`
   then load the route at `localhost:8080` and confirm it renders.
6. This is cross-pod work — the `data` pod owns the migration, `frontend` owns the page/route, and
   whichever pod matches the module's domain owns the business logic. Route accordingly rather than
   doing all of it as one undifferentiated block.
7. Ask the `quality` pod (Sunita) to verify the route renders and the DB tables exist before
   calling this done.

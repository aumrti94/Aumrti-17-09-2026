# Workflow: New HMS Module

Goal: Scaffold a complete new HMS module following the Aumrti HMS patterns.

Steps:
1. Read the current App.tsx to understand the existing route structure.
2. Read src/components/opd/ as the reference implementation pattern.
3. Create the page file at src/pages/[module]/[Module]Page.tsx with:
   - Correct lazy import in App.tsx
   - Route added with RoleGuard
   - Route added to ROUTE_ROLES
   - Sidebar navigation entry added
4. Create the main component with tabs if the module has sub-screens.
5. Create the Supabase migration for any new tables needed.
6. Add RLS policies to all new tables.
7. Ask Sunita to verify the route renders and the DB tables exist.

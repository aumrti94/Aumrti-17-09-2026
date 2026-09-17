-- Phase 4 (multi-tenant isolation) needs real pgTAP, not the ad-hoc psql-assertion style
-- `supabase/tests/booking-engine/` already uses (no plan()/is() there despite the name).
-- `supabase test db --local` runs any .sql file under supabase/tests/ against this database,
-- so pgTAP has to be an installed extension here, not just assumed present.

CREATE EXTENSION IF NOT EXISTS pgtap;

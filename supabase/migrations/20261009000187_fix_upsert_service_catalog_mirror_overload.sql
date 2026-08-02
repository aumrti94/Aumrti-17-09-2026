-- 20261009000186_ward_custom_gst.sql added two trailing DEFAULT params to
-- upsert_service_catalog_mirror via CREATE OR REPLACE. Postgres treats a
-- changed parameter list as a distinct overload rather than replacing the
-- original function, so the old 8-arg signature was left in place alongside
-- the new 10-arg one. Because the two new params both have defaults, any
-- call passing exactly 8 positional args (every mirror trigger except
-- sync_ward_to_catalog: lab tests, lab groups, radiology studies, health
-- packages, service rates, day care procedures) matches both overloads and
-- fails with "function ... is not unique" — surfaced to users as "Bulk
-- update failed" when toggling lab test active/inactive in bulk.
DROP FUNCTION IF EXISTS public.upsert_service_catalog_mirror(
  uuid, text, uuid, text, text, text, numeric, boolean
);

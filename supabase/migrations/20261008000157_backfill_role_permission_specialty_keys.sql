-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: normalize role_permissions blobs after the route→module enforcement rewire
--
-- Before the rewire, routeRoles.ROUTE_TO_MODULE bucketed ~16 specialty routes into a
-- parent module (e.g. /dialysis → ipd, /payments → billing). Now each route resolves to
-- its OWN key. To avoid regressing roles whose access flowed through a bucket, copy each
-- parent's permission entry into the child key wherever the blob grants the parent but has
-- no explicit child entry yet. (The runtime LEGACY_MODULE_PARENT fallback in routeRoles.ts
-- is the belt; this migration is the suspenders — it normalizes stored data so the child
-- keys become independently editable in the expanded role editor.)
--
-- Mirrors LEGACY_MODULE_PARENT in src/lib/moduleRegistry.ts — keep both in sync.
-- Rows with {"all": true} are skipped (they already grant everything).
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  m record;
BEGIN
  FOR m IN SELECT * FROM (VALUES
    ('day_care','ipd'),
    ('telemedicine','opd'),
    ('pharmacy_retail','pharmacy'),
    ('day_closure','billing'),
    ('payments','billing'),
    ('accounts','billing'),
    ('pmjay','insurance'),
    ('blood_bank','ipd'),
    ('cssd','ipd'),
    ('dialysis','ipd'),
    ('oncology','ipd'),
    ('mrd','patients'),
    ('lms','hr'),
    ('crm','analytics'),
    ('ipc','quality'),
    ('fms','quality')
  ) AS t(child, parent)
  LOOP
    UPDATE public.role_permissions rp
    SET permissions = rp.permissions || jsonb_build_object(m.child, rp.permissions -> m.parent)
    WHERE jsonb_exists(rp.permissions, m.parent)
      AND NOT jsonb_exists(rp.permissions, m.child)
      AND (rp.permissions ->> 'all') IS DISTINCT FROM 'true'
      AND jsonb_typeof(rp.permissions -> m.parent) IN ('object', 'string');
  END LOOP;
END $$;

-- ============================================================
-- Per-hospital TAB / ACTION entitlements ("customizable module access")
-- ------------------------------------------------------------
-- hospital_feature_overrides answers "is this MODULE on for this hospital?".
-- This table answers the finer question "WITHIN an enabled module, which TABS
-- and BUTTONS did this hospital pay for?" — the platform-controlled twin of the
-- per-role tab/action toggles hospital admins set in /settings/roles.
--
-- Semantics (mirrors the role-permission convention):
--   • Absence of a key  = ALLOWED (default open). A hospital with no row here
--     keeps full access to every tab/action of its enabled modules.
--   • Explicit `false`   = WITHHELD. The tab/button is hidden for the whole
--     hospital, for EVERY role (including hospital_admin / super_admin) — an
--     entitlement is what the hospital bought, so no local role can exceed it.
--
-- Enforced client-side in src/lib/tabPermissions.ts (entitlement floor checked
-- BEFORE the admin bypass) via the __entitlement blob injected by HospitalContext.
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.hospital_module_entitlements (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  module_key  text        NOT NULL,
  tabs        jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- { tabKey: boolean }; only `false` withholds
  actions     jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- { actionKey: boolean }; only `false` withholds
  updated_by  uuid        REFERENCES auth.users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'hospital_module_entitlements_hospital_id_module_key_key'
    AND   conrelid = 'public.hospital_module_entitlements'::regclass
  ) THEN
    ALTER TABLE public.hospital_module_entitlements
      ADD CONSTRAINT hospital_module_entitlements_hospital_id_module_key_key
      UNIQUE (hospital_id, module_key);
  END IF;
END $$;

ALTER TABLE public.hospital_module_entitlements ENABLE ROW LEVEL SECURITY;

-- ── RLS: hospital reads its own; only platform (aumrti) admins write ──────────
DROP POLICY IF EXISTS "module_entitlement_own_read"   ON public.hospital_module_entitlements;
DROP POLICY IF EXISTS "module_entitlement_aumrti_all" ON public.hospital_module_entitlements;

CREATE POLICY "module_entitlement_own_read"
  ON public.hospital_module_entitlements FOR SELECT TO authenticated
  USING (
    hospital_id = (
      SELECT hospital_id FROM public.users
      WHERE  auth_user_id = auth.uid()
      LIMIT 1
    )
    OR public.is_aumrti_admin()
  );

CREATE POLICY "module_entitlement_aumrti_all"
  ON public.hospital_module_entitlements FOR ALL TO authenticated
  USING    (public.is_aumrti_admin())
  WITH CHECK (public.is_aumrti_admin());

CREATE INDEX IF NOT EXISTS idx_hospital_module_entitlements_hosp_id
  ON public.hospital_module_entitlements (hospital_id);

-- ── Realtime: propagate platform entitlement changes to the live hospital app ──
-- REPLICA IDENTITY FULL so the hospital_id row filter matches (not the PK).
ALTER TABLE public.hospital_module_entitlements REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename = 'hospital_module_entitlements'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.hospital_module_entitlements;
  END IF;
END $$;

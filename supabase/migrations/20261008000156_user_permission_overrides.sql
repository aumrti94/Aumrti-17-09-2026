-- ─────────────────────────────────────────────────────────────────────────────
-- Layer 4 — Per-user permission overrides
--
-- The access cascade is: plan (L1) → per-hospital entitlement (L2) → role (L3) →
-- per-user (L4). Layers 1-3 already existed; this table adds the missing L4.
--
-- Semantics: RESTRICT-ONLY within the user's role. The `permissions` blob has the
-- SAME shape as role_permissions.permissions but is only ever populated with `false`
-- entries (a "withhold map"). It can never grant a permission the role lacks — the
-- resolver (applyUserOverrides in src/lib/moduleRegistry.ts) only flips role
-- true → false onto a per-session clone. One row per user.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_permission_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by  uuid,
  updated_at  timestamptz DEFAULT now(),
  created_at  timestamptz DEFAULT now(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_permission_overrides_hospital
  ON public.user_permission_overrides (hospital_id);

ALTER TABLE public.user_permission_overrides ENABLE ROW LEVEL SECURITY;

-- Mirrors the role_permissions trust model: any authenticated member of the hospital
-- can read (so HospitalContext can load a user's own overlay), and management is
-- hospital-scoped (the Settings ▸ Staff editor is itself admin-gated in the UI).
CREATE POLICY "Users can view own hospital user_permission_overrides"
  ON public.user_permission_overrides FOR SELECT TO authenticated
  USING (hospital_id = get_user_hospital_id());

CREATE POLICY "Users can manage own hospital user_permission_overrides"
  ON public.user_permission_overrides FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());

-- Live-apply overrides to the signed-in user without a reload (mirrors the
-- hospital_module_entitlements realtime channel in HospitalContext).
ALTER TABLE public.user_permission_overrides REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'user_permission_overrides'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_permission_overrides;
  END IF;
END $$;

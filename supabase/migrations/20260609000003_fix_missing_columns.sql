-- Columns present in production DB but added via Studio, never captured in migrations.
-- This migration makes a fresh test project schema match production.

-- users.can_login
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS can_login boolean NOT NULL DEFAULT true;

-- users.auth_user_id (safety net — also added by 20260322111223 now, but idempotent)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_users_auth_user_id ON public.users(auth_user_id);

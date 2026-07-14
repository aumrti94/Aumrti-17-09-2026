-- ============================================================
-- Real video library — replaces CustomerSuccessPage's fake VIDEO_LIBRARY
-- ============================================================
-- The fake version lived on /platform/customer-success, which is
-- aumrti_admin-only (PlatformGuard) — so even the "planned" copy was never
-- visible to the hospital staff it was meant to train. This table is
-- readable by any authenticated user (tenant-facing consumption page),
-- writable only by admins (CRUD stays on/near CustomerSuccessPage).
-- No self-hosted video storage — video_url points at an external
-- YouTube/Loom embed, matching this repo's stated convention
-- (.agents/agents.md: "5-minute YouTube format").
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_training_videos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  description      text,
  video_url        text NOT NULL,
  thumbnail_url    text,
  duration_seconds integer,
  category         text NOT NULL DEFAULT 'general',
  sort_order       integer NOT NULL DEFAULT 0,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_training_videos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_training_videos_read_all" ON public.platform_training_videos;
CREATE POLICY "platform_training_videos_read_all" ON public.platform_training_videos
  FOR SELECT TO authenticated USING (is_active = true);

DROP POLICY IF EXISTS "platform_training_videos_admin_write" ON public.platform_training_videos;
CREATE POLICY "platform_training_videos_admin_write" ON public.platform_training_videos
  FOR ALL TO authenticated USING (public.is_aumrti_admin()) WITH CHECK (public.is_aumrti_admin());

CREATE OR REPLACE FUNCTION public.set_training_videos_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_training_videos_updated_at ON public.platform_training_videos;
CREATE TRIGGER trg_training_videos_updated_at
  BEFORE UPDATE ON public.platform_training_videos
  FOR EACH ROW EXECUTE FUNCTION public.set_training_videos_updated_at();

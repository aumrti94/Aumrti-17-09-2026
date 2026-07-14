-- ============================================================
-- Real onboarding tours (react-joyride) — replaces the fake TOUR_ROLES
-- ============================================================
-- Tours are code/migration-defined, not admin-freeform-authored — writing
-- a tour requires knowing the app's real DOM structure (the CSS selectors
-- below correspond to data-tour attributes added to real components this
-- same session), which is a developer task, not admin content authoring.
-- Mirrors prompt_registry's "one migration seeds the content" convention.
--
-- Scoping note: fewer steps than the original fake copy promised (2 real
-- steps per role here vs. 3-4 fabricated ones there) — real and small
-- beats fake and elaborate. More steps can be added via the same
-- migration-per-tour pattern later without touching this table's shape.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_onboarding_tours (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role        text NOT NULL,
  tour_key    text NOT NULL UNIQUE,
  title       text NOT NULL,
  steps       jsonb NOT NULL, -- [{ target: css-selector, content: string, order: int }]
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_tour_progress (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tour_key      text NOT NULL REFERENCES public.platform_onboarding_tours(tour_key) ON DELETE CASCADE,
  completed_at  timestamptz,
  dismissed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tour_key)
);

ALTER TABLE public.platform_onboarding_tours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_tour_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_onboarding_tours_read_all" ON public.platform_onboarding_tours;
CREATE POLICY "platform_onboarding_tours_read_all" ON public.platform_onboarding_tours
  FOR SELECT TO authenticated USING (is_active = true);

DROP POLICY IF EXISTS "platform_onboarding_tours_admin_write" ON public.platform_onboarding_tours;
CREATE POLICY "platform_onboarding_tours_admin_write" ON public.platform_onboarding_tours
  FOR ALL TO authenticated USING (public.is_aumrti_admin()) WITH CHECK (public.is_aumrti_admin());

-- A user can only see/write their own tour progress. Admins can read
-- everyone's, to compute completion-rate stats on CustomerSuccessPage.
DROP POLICY IF EXISTS "user_tour_progress_own_or_admin_read" ON public.user_tour_progress;
CREATE POLICY "user_tour_progress_own_or_admin_read" ON public.user_tour_progress
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_aumrti_admin());

DROP POLICY IF EXISTS "user_tour_progress_own_write" ON public.user_tour_progress;
CREATE POLICY "user_tour_progress_own_write" ON public.user_tour_progress
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_tour_progress_own_update" ON public.user_tour_progress;
CREATE POLICY "user_tour_progress_own_update" ON public.user_tour_progress
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Seed the 5 role tours, targeting real data-tour attributes added this
-- session to: ConsultationWorkspace.tsx, IPDWardRoundTab.tsx,
-- NursingVitalsTask.tsx, TokenQueue.tsx, BillQueue.tsx, CollectionWorkstation.tsx.
INSERT INTO public.platform_onboarding_tours (role, tour_key, title, steps) VALUES
  -- Split into two single-page tours, not one: Joyride runs within one
  -- mounted page at a time, and these two targets live on different pages
  -- (OPD consultation vs. IPD ward round) that are never mounted together.
  ('doctor', 'doctor_opd_intro', 'Doctor Quick Start — OPD', '[
    {"target": "[data-tour=\"doctor-consult-actions\"]", "content": "Dictate your OPD notes by voice, or use Complete & Bill when you''re done with a consultation.", "order": 1}
  ]'::jsonb),
  ('doctor', 'doctor_ward_round_intro', 'Doctor Quick Start — Ward Rounds', '[
    {"target": "[data-tour=\"doctor-ward-round-notes\"]", "content": "Ward round notes work the same way — dictate or type, then Save Round Note.", "order": 1}
  ]'::jsonb),
  ('nurse', 'nurse_intro', 'Nursing Quick Start', '[
    {"target": "[data-tour=\"nurse-vitals-dictation\"]", "content": "Dictate vitals and nursing notes by voice instead of typing everything out.", "order": 1}
  ]'::jsonb),
  ('receptionist', 'receptionist_intro', 'Front Desk Quick Start', '[
    {"target": "[data-tour=\"receptionist-token-queue\"]", "content": "This is the OPD token queue — see who''s waiting and manage the day''s appointments here.", "order": 1}
  ]'::jsonb),
  ('billing_executive', 'billing_intro', 'Billing Quick Start', '[
    {"target": "[data-tour=\"billing-bill-queue\"]", "content": "All bills for the day live here.", "order": 1},
    {"target": "[data-tour=\"billing-new-bill\"]", "content": "Click New Bill to start billing a patient.", "order": 2}
  ]'::jsonb),
  ('lab_technician', 'lab_intro', 'Lab Quick Start', '[
    {"target": "[data-tour=\"lab-worklist\"]", "content": "Your sample collection worklist — track pending, collected, and completed samples by status.", "order": 1}
  ]'::jsonb)
ON CONFLICT (tour_key) DO NOTHING;

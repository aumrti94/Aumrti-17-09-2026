-- Allow unauthenticated (anon) users to read active plans.
-- Needed so the registration wizard (Step 4 — Choose Plan) can
-- show live plans before the hospital admin has signed in.

DROP POLICY IF EXISTS "plans_anon_read" ON public.subscription_plans;

CREATE POLICY "plans_anon_read"
  ON public.subscription_plans FOR SELECT TO anon
  USING (is_active = true);

DROP POLICY IF EXISTS "plan_features_anon_read" ON public.plan_features;

CREATE POLICY "plan_features_anon_read"
  ON public.plan_features FOR SELECT TO anon
  USING (true);

-- The live hospital_subscriptions_status_check constraint had drifted to
-- ('active','trialing','past_due','cancelled','paused') — a vocabulary that
-- ZERO application code uses (grepped src/ + supabase/ for 'trialing'/'paused':
-- no matches related to hospital_subscriptions). Every caller — the
-- register-hospital edge function, useSubscriptionConfig.ts, and 6 other
-- platform/settings pages — writes/reads 'trial'/'suspended'/'cancelled'.
--
-- Practical effect of the drift: every hospital_subscriptions insert with
-- status:"trial" (i.e. every hospital registration, ever) silently violated
-- this constraint and was dropped, because register-hospital's upsert call
-- doesn't check the result for an error. This is why every hospital on the
-- Platform Overview dashboard shows "no subscription" regardless of when it
-- was created — not just hospitals that predate the subscription system.
--
-- Fix: restore the constraint to match what the app actually uses.
ALTER TABLE public.hospital_subscriptions DROP CONSTRAINT IF EXISTS hospital_subscriptions_status_check;
ALTER TABLE public.hospital_subscriptions
  ADD CONSTRAINT hospital_subscriptions_status_check
  CHECK (status IN ('trial','active','past_due','suspended','cancelled'));

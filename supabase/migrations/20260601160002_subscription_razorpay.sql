-- Add razorpay_plan_id to subscription_plans.
-- CEO enters the Razorpay plan ID (from Razorpay Dashboard) for each plan.
-- Required before the create-razorpay-subscription Edge Function can work.

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS razorpay_plan_id text;

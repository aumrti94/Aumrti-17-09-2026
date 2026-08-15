-- Aumrti security audit — enable RLS on service-role-only webhook tables.
--
-- razorpay_webhook_log (20260622000007) and webhook_dlq (20260622000008) were both created
-- with RLS deliberately left off, reasoning "only accessed via service-role key — no RLS
-- needed." That reasoning has it backwards: service_role bypasses RLS whether it's enabled or
-- not, so enabling it here has zero effect on the edge functions that legitimately use these
-- tables. What RLS actually gates is everyone ELSE — and Supabase's default schema privileges
-- grant `authenticated` (via ALTER DEFAULT PRIVILEGES) full table access unless RLS narrows
-- it. With RLS off, any logged-in user at any hospital can query these tables directly via
-- PostgREST. webhook_dlq.payload stores raw failed Razorpay webhook bodies — potentially
-- other hospitals' payment/subscription data — and razorpay_webhook_log leaks cross-tenant
-- billing event metadata (which hospitals process what, and when).
--
-- No policies are added for authenticated/anon: nothing in the app reads these tables from
-- the browser (grep confirms zero src/ references), so enabling RLS with no permissive
-- policies simply closes the table off from everyone except service_role, which is the
-- intended and only real caller.

ALTER TABLE public.razorpay_webhook_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_dlq          ENABLE ROW LEVEL SECURITY;

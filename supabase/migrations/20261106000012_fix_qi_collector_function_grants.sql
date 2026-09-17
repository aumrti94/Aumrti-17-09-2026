-- Phase 4 (multi-tenant isolation) finding, S1 by the plan's own rule — no waiver.
--
-- THE HOLE. `20261011000030_quality_indicator_collectors.sql`'s header claims: "these run
-- SECURITY DEFINER... so that predicate [hospital_id = p_hospital_id] is the only thing
-- standing between tenants. The security test asserts it." No such test existed, and
-- checking the actual grants against this local database found why that claim was false:
-- every one of these 17 hospital-scoped SECURITY DEFINER functions had EXECUTE granted to
-- `anon` and `authenticated` — Postgres's default for a newly created function, never
-- revoked here the way the two orchestrator functions at the end of that file already are.
--
-- CONCRETE EXPLOIT. `qi_collect_mom` reads `nursing_mar` (medication administration),
-- `safety_events`/`incident_reports`, `high_alert_double_checks`. Every other collector
-- reads similarly sensitive operational and safety data. None of them checks WHO is
-- calling — only WHAT hospital_id the caller supplies as a plain argument. So:
--
--   select * from qi_collect_mom('<any hospital's uuid>', now() - interval '1 year', now());
--
-- run by ANY authenticated session — or, since `anon` also had EXECUTE, potentially by an
-- unauthenticated request — returned that hospital's medication-error rate and MAR
-- compliance, no matter which hospital the caller actually belongs to. The orchestrator,
-- `run_quality_indicator_collection`, DOES check the caller against
-- `get_user_hospital_id()` before running — but nothing stopped a caller from skipping the
-- orchestrator and invoking the collector it wraps directly. A SECURITY DEFINER function
-- that filters by a caller-supplied parameter is not isolation; checking the caller's
-- identity is, and that check lived only in the wrapper, not the functions doing the reads.
--
-- THE FIX. Revoke EXECUTE from PUBLIC, anon and authenticated on every collector and shared
-- helper — they become callable only by their owner, which is what a SECURITY DEFINER
-- function runs as regardless of who invoked the caller, so
-- `run_quality_indicator_collection` (itself SECURITY DEFINER, already correctly gated)
-- continues to work unchanged. `qi_attainment` and `qi_band_status` are excluded: pure
-- calculation helpers taking no hospital_id and touching no table, so they carry no
-- isolation risk.
--
-- Verified by supabase/tests/isolation/10-qi-collector-grants.sql.

REVOKE EXECUTE ON FUNCTION public.qi_active_beds(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qi_active_staff(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qi_safety_source(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qi_patient_days(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.qi_collect_aac(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qi_collect_cop(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qi_collect_lab(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qi_collect_mom(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qi_collect_pre_grievances(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qi_collect_pre_experience(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qi_collect_hic(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qi_collect_hic_device(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qi_collect_rom(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qi_collect_fms(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qi_collect_hrm(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qi_collect_ims(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qi_collect_qps(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qi_collect_qps_falls(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.qi_collect_mom(uuid, timestamptz, timestamptz) IS
  'Internal collector for run_quality_indicator_collection() only. EXECUTE is deliberately '
  'revoked from anon/authenticated (2026-09-12) — this is SECURITY DEFINER and filters by a '
  'caller-supplied hospital_id with no identity check, so granting it directly to client '
  'roles is a cross-tenant read. Call through the orchestrator, which checks the caller '
  'against get_user_hospital_id() first.';

-- Inter-hospital transfer-out / referral: capture the destination facility and reason
-- on the admission so a Transfer / Referral Summary can be generated for continuity of care.
-- Strictly additive + idempotent; admissions already has hospital-scoped RLS.

ALTER TABLE public.admissions ADD COLUMN IF NOT EXISTS referred_to_facility text;
ALTER TABLE public.admissions ADD COLUMN IF NOT EXISTS referral_reason text;

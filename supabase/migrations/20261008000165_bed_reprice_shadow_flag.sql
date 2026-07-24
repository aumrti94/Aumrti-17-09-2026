-- ============================================================
-- Bed-reprice shadow mode — staged rollout switch
-- ------------------------------------------------------------
-- Migration 164 added automatic renewal repricing: on every
-- `subscription.charged`, the webhook recomputes what a hospital should pay
-- against its live bed count and, on drift, PATCHes the live Razorpay mandate
-- to take effect at cycle end.
--
-- That path mutates real payment mandates across the whole customer base and
-- has never executed — there is no local Deno, so edge-function code is only
-- exercised in production. Shipping it hot means the first real test is also
-- the first fleet-wide billing change.
--
-- So it ships OFF. With this flag disabled (the default), the webhook still
-- does all the arithmetic and records exactly what it WOULD have charged as a
-- `bed_reprice_preview` row in subscription_events — but touches neither
-- Razorpay nor hospital_subscriptions. Run one full billing cycle in shadow,
-- read the previews, confirm the numbers, then turn it on.
--
-- Rollout is controlled entirely from /platform → Feature Flags:
--   · is_enabled = false          → shadow for everyone (the default here)
--   · is_enabled + rollout 10%    → live for a deterministic 10% of hospitals
--   · is_enabled + rollout 100%   → live for everyone
--   · platform_feature_flag_overrides → force live (or shadow) for ONE hospital,
--     which is how you pilot on a friendly account before any percentage.
--
-- resolve_feature_flag() returns FALSE for an unknown key, so if this row is
-- ever deleted the system falls back to shadow rather than to live billing.
-- ============================================================

INSERT INTO public.platform_feature_flags (key, description, is_enabled, rollout_percentage)
VALUES (
  'bed_reprice_live',
  'Bed-band renewal repricing: when OFF (default) the subscription webhook only RECORDS what it would rebill (subscription_events.event_type = bed_reprice_preview) and does not touch Razorpay. Turn ON — ideally via a per-hospital override first, then a rollout percentage — once a full cycle of previews has been reviewed and the amounts are correct.',
  false,
  0
)
ON CONFLICT (key) DO NOTHING;

-- Convenience view for reviewing a shadow run: every preview the webhook has
-- recorded, newest first, with the hospital name and the delta it would have
-- applied. Admin-only by construction — it reads subscription_events, whose
-- RLS already restricts to aumrti_admins.
CREATE OR REPLACE VIEW public.bed_reprice_previews AS
SELECT
  se.created_at,
  se.hospital_id,
  h.name AS hospital_name,
  (se.metadata ->> 'previous_amount_inr')::numeric AS current_amount_inr,
  (se.metadata ->> 'new_amount_inr')::numeric      AS would_charge_inr,
  (se.metadata ->> 'new_amount_inr')::numeric
    - (se.metadata ->> 'previous_amount_inr')::numeric AS delta_inr,
  (se.metadata ->> 'active_beds')::int             AS active_beds,
  (se.metadata ->> 'bed_blocks')::int              AS bed_blocks,
  (se.metadata ->> 'bed_fee_inr')::numeric         AS bed_fee_inr,
  se.metadata ->> 'mode'                           AS mode
FROM public.subscription_events se
JOIN public.hospitals h ON h.id = se.hospital_id
WHERE se.event_type IN ('bed_reprice_preview', 'bed_reprice_scheduled')
ORDER BY se.created_at DESC;

COMMENT ON VIEW public.bed_reprice_previews IS
  'Shadow-mode review surface for bed-band renewal repricing. mode=shadow rows were computed but NOT charged; mode=live rows were applied to the Razorpay mandate at cycle end.';
